import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import type { Response } from 'express';
import { IngestRepoDto } from './dto/ingest-repo.dto';
import { VectorStoreService } from './vector-store.service';
import { IngestProcessor } from './ingest.processor';
import { ChatHistoryService } from '../generation/chat-history.service';
import { DbService } from '../db/db.service';
import { repos } from '../db/schema';
import { INGEST_QUEUE } from './constants';

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    @InjectQueue(INGEST_QUEUE) private readonly ingestQueue: Queue,
    private readonly chatHistoryService: ChatHistoryService,
    private readonly vectorStoreService: VectorStoreService,
    private readonly processor: IngestProcessor,
    private readonly db: DbService,
  ) {}

  async queueIngest(dto: IngestRepoDto) {
    const repoId = this.repoUrlToId(dto.repoUrl);

    const job = await this.ingestQueue.add(
      'clone-and-embed',
      { ...dto, repoId },
      { attempts: 1, removeOnComplete: false, removeOnFail: false },
    );

    await this.db.db
      .insert(repos)
      .values({ repoId, repoUrl: dto.repoUrl, jobId: job.id as string, status: 'queued' })
      .onConflictDoUpdate({
        target: repos.repoId,
        set: { repoUrl: dto.repoUrl, jobId: job.id as string, status: 'queued', ingestedAt: new Date() },
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
      const fresh = await this.ingestQueue.getJob(jobId);
      if (!fresh) return;
      const state = await fresh.getState();
      const progress = fresh.progress as number;
      const { logs } = await this.ingestQueue.getJobLogs(jobId);

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
    const repoRows = await this.db.db.select().from(repos);
    const results = [];

    for (const repo of repoRows) {
      let status = repo.status;
      if (repo.jobId) {
        try {
          const job = await this.ingestQueue.getJob(repo.jobId);
          if (job) status = await job.getState();
        } catch (err) {
          this.logger.warn(`Could not get job state for ${repo.repoId}: ${err.message}`);
        }
      }
      results.push({
        repoId: repo.repoId,
        repoUrl: repo.repoUrl,
        ingestedAt: repo.ingestedAt.toISOString(),
        jobId: repo.jobId,
        status,
      });
    }

    return results;
  }

  async restartJob(jobId: string) {
    const job = await this.ingestQueue.getJob(jobId);
    if (!job) throw new NotFoundException(`Job ${jobId} not found`);

    const { repoUrl, repoId, includePatterns, branch } = job.data;

    this.processor.killWorker(repoId);
    await this.vectorStoreService.deleteByRepoId(repoId);
    await this.removeJobsForRepo(repoId);

    const newJob = await this.ingestQueue.add(
      'clone-and-embed',
      { repoUrl, repoId, includePatterns, branch },
      { attempts: 1, removeOnComplete: false, removeOnFail: false },
    );

    await this.db.db
      .update(repos)
      .set({ jobId: newJob.id as string, status: 'queued', ingestedAt: new Date() })
      .where(eq(repos.repoId, repoId));

    return newJob;
  }

  async deleteRepo(repoId: string) {
    const existing = await this.db.db.select().from(repos).where(eq(repos.repoId, repoId));
    if (!existing.length) throw new NotFoundException(`Repository ${repoId} not found`);

    this.processor.killWorker(repoId);
    await this.removeJobsForRepo(repoId);

    // Delete repo row (cascades to chat_messages) and vectors in parallel
    await Promise.all([
      this.db.db.delete(repos).where(eq(repos.repoId, repoId)),
      this.vectorStoreService.deleteByRepoId(repoId),
    ]);
  }

  private async removeJobsForRepo(repoId: string): Promise<void> {
    try {
      const jobs = await this.ingestQueue.getJobs(
        ['waiting', 'active', 'completed', 'failed', 'delayed'],
        0,
        1000,
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
