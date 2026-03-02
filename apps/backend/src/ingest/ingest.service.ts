import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Response } from 'express';
import { IngestRepoDto } from './dto/ingest-repo.dto';
import { ChatHistoryService } from '../generation/chat-history.service';
import { VectorStoreService } from './vector-store.service';
import { CancellationService } from './cancellation.service';
import { INGEST_QUEUE } from './constants';

@Injectable()
export class IngestService implements OnModuleInit {
  private readonly ingestedRepos = new Map<string, { repoUrl: string; ingestedAt: Date; status: string; jobId: string }>();

  constructor(
    @InjectQueue(INGEST_QUEUE) private readonly ingestQueue: Queue,
    private readonly chatHistoryService: ChatHistoryService,
    private readonly vectorStoreService: VectorStoreService,
    private readonly cancellationService: CancellationService,
  ) {}

  async onModuleInit() {
    // Rebuild the repo registry from BullMQ jobs persisted in Redis.
    // Jobs are kept because removeOnComplete/removeOnFail are false.
    try {
      const jobs = await this.ingestQueue.getJobs(
        ['waiting', 'active', 'completed', 'failed', 'delayed'],
        0,
        1000,
      );
      // Keep only the most-recent job per repoId
      const latest = new Map<string, (typeof jobs)[number]>();
      for (const job of jobs) {
        const { repoId, repoUrl } = job.data ?? {};
        if (!repoId || !repoUrl) continue;
        const existing = latest.get(repoId);
        if (!existing || job.timestamp > existing.timestamp) {
          latest.set(repoId, job);
        }
      }
      for (const [repoId, job] of latest.entries()) {
        this.ingestedRepos.set(repoId, {
          repoUrl: job.data.repoUrl,
          ingestedAt: new Date(job.timestamp),
          status: 'unknown',
          jobId: job.id as string,
        });
      }
    } catch {}
  }

  async queueIngest(dto: IngestRepoDto) {
    const repoId = this.repoUrlToId(dto.repoUrl);

    const job = await this.ingestQueue.add(
      'clone-and-embed',
      { ...dto, repoId },
      {
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    this.ingestedRepos.set(repoId, {
      repoUrl: dto.repoUrl,
      ingestedAt: new Date(),
      status: 'queued',
      jobId: job.id as string,
    });

    return job;
  }

  async getJobStatus(jobId: string) {
    const job = await this.ingestQueue.getJob(jobId);
    if (!job) throw new NotFoundException(`Job ${jobId} not found`);

    const state = await job.getState();
    const progress = job.progress;
    const { logs } = await this.ingestQueue.getJobLogs(jobId);

    return { jobId, state, progress, data: job.data, logs };
  }

  async streamLogs(jobId: string, res: Response) {
    const job = await this.ingestQueue.getJob(jobId);
    if (!job) throw new NotFoundException(`Job ${jobId} not found`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let sentCount = 0;

    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    const poll = setInterval(async () => {
      // Re-fetch the job on every tick so progress reflects the latest value from Redis
      const fresh = await this.ingestQueue.getJob(jobId);
      if (!fresh) return;
      const state = await fresh.getState();
      const progress = fresh.progress as number;
      const { logs } = await this.ingestQueue.getJobLogs(jobId);

      // Send any new log lines
      for (let i = sentCount; i < logs.length; i++) {
        send({ log: logs[i], progress });
      }
      sentCount = logs.length;

      if (state === 'completed' || state === 'failed') {
        send({ state, progress });
        res.write('data: [DONE]\n\n');
        res.end();
        clearInterval(poll);
      }
    }, 500);

    res.on('close', () => clearInterval(poll));
  }

  async listIngested() {
    const results = [];
    for (const [id, meta] of this.ingestedRepos.entries()) {
      let status = meta.status;
      try {
        const job = await this.ingestQueue.getJob(meta.jobId);
        if (job) status = await job.getState();
      } catch {}
      results.push({ repoId: id, ...meta, status });
    }
    return results;
  }

  async restartJob(jobId: string) {
    const job = await this.ingestQueue.getJob(jobId);
    if (!job) throw new NotFoundException(`Job ${jobId} not found`);

    const { repoUrl, repoId, includePatterns, branch } = job.data;

    // Signal any active processor to stop before we delete its data
    this.cancellationService.cancel(repoId);

    // Delete existing vectors and old jobs so re-ingestion starts fresh
    await this.vectorStoreService.deleteByRepoId(repoId);
    await this.removeJobsForRepo(repoId);

    const newJob = await this.ingestQueue.add(
      'clone-and-embed',
      { repoUrl, repoId, includePatterns, branch },
      {
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    this.ingestedRepos.set(repoId, {
      repoUrl,
      ingestedAt: new Date(),
      status: 'queued',
      jobId: newJob.id as string,
    });

    return newJob;
  }

  async deleteRepo(repoId: string) {
    if (!this.ingestedRepos.has(repoId)) {
      throw new NotFoundException(`Repository ${repoId} not found`);
    }
    this.ingestedRepos.delete(repoId);

    // Signal any active processor to stop as soon as it checks
    this.cancellationService.cancel(repoId);

    // Remove all BullMQ jobs for this repo from Redis.
    // Promise.allSettled so active (locked) jobs that can't be removed don't abort the rest.
    await this.removeJobsForRepo(repoId);

    await Promise.all([
      this.chatHistoryService.clearHistory(repoId),
      this.vectorStoreService.deleteByRepoId(repoId),
    ]);
  }

  private async removeJobsForRepo(repoId: string): Promise<void> {
    try {
      const jobs = await this.ingestQueue.getJobs(
        ['waiting', 'active', 'completed', 'failed', 'delayed'],
        0, 1000,
      );
      await Promise.allSettled(
        jobs.filter((j) => j.data?.repoId === repoId).map((j) => j.remove()),
      );
    } catch {}
  }

  private repoUrlToId(url: string): string {
    return url.replace('https://github.com/', '').replace('/', '-');
  }
}
