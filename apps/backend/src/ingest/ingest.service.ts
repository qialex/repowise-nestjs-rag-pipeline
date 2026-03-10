import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import type { Response } from 'express';
import { IngestRepoDto } from './dto/ingest-repo.dto';
import { VectorStoreService } from './vector-store.service';
import { IngestProcessor } from './ingest.processor';
import { IngestLogService } from './ingest-log.service';
import { DbService } from '../db/db.service';
import { repos } from '../db/schema';
import { INGEST_QUEUE } from './constants';

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    @InjectQueue(INGEST_QUEUE) private readonly ingestQueue: Queue,
    private readonly vectorStoreService: VectorStoreService,
    private readonly processor: IngestProcessor,
    private readonly ingestLogService: IngestLogService,
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

    this.ingestLogService.emitReposChanged();
    return job;
  }

  async getJobStatus(jobId: string) {
    const job = await this.ingestQueue.getJob(jobId);
    if (!job) throw new NotFoundException(`Job ${jobId} not found`);

    const state = await job.getState();
    const progress = job.progress;
    const logs = await this.ingestLogService.getLogs(jobId);

    return { jobId, state, progress, data: job.data, logs };
  }

  async streamLogs(jobId: string, res: Response) {
    const job = await this.ingestQueue.getJob(jobId);
    if (!job) throw new NotFoundException(`Job ${jobId} not found`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    const close = () => {
      res.write('data: [DONE]\n\n');
      res.end();
    };

    // Send all existing logs immediately (catch-up for late joiners / page refreshes)
    const existingLogs = await this.ingestLogService.getLogs(jobId);
    for (const message of existingLogs) {
      send({ log: message });
    }

    // If the job is already terminal, close immediately
    const state = await job.getState();
    if (state === 'completed' || state === 'failed') {
      send({ state });
      close();
      return;
    }

    // Stream new logs, progress and state as they arrive — zero Redis reads
    const unsubLog      = this.ingestLogService.onLog(jobId, (message) => send({ log: message }));
    const unsubProgress = this.ingestLogService.onProgress(jobId, (value) => send({ progress: value }));
    const unsubDone     = this.ingestLogService.onDone(jobId, (finalState) => {
      send({ state: finalState });
      cleanup();
    });

    const cleanup = () => {
      unsubLog();
      unsubProgress();
      unsubDone();
      close();
    };

    res.on('close', () => {
      unsubLog();
      unsubProgress();
      unsubDone();
    });
  }

  async streamRepos(res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = async () => {
      const data = await this.listIngested();
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    await send();

    const unsub = this.ingestLogService.onReposChanged(async () => {
      await send();
    });

    res.on('close', () => unsub());
  }

  async listIngested() {
    const repoRows = await this.db.db.select().from(repos);
    return repoRows.map((repo) => ({
      repoId: repo.repoId,
      repoUrl: repo.repoUrl,
      ingestedAt: repo.ingestedAt.toISOString(),
      jobId: repo.jobId,
      status: repo.status,
    }));
  }

  async restartJob(jobId: string) {
    const job = await this.ingestQueue.getJob(jobId);
    if (!job) throw new NotFoundException(`Job ${jobId} not found`);

    const { repoUrl, repoId, includePatterns, branch } = job.data;

    this.processor.killWorker(repoId);
    await this.vectorStoreService.deleteByRepoId(repoId);
    await this.removeJobsForRepo(repoId);
    await this.ingestLogService.deleteLogsForRepo(repoId);

    const newJob = await this.ingestQueue.add(
      'clone-and-embed',
      { repoUrl, repoId, includePatterns, branch },
      { attempts: 1, removeOnComplete: false, removeOnFail: false },
    );

    await this.db.db
      .update(repos)
      .set({ jobId: newJob.id as string, status: 'queued', ingestedAt: new Date() })
      .where(eq(repos.repoId, repoId));

    this.ingestLogService.emitReposChanged();
    return newJob;
  }

  async deleteRepo(repoId: string) {
    const existing = await this.db.db.select().from(repos).where(eq(repos.repoId, repoId));
    if (!existing.length) throw new NotFoundException(`Repository ${repoId} not found`);

    this.processor.killWorker(repoId);
    await this.removeJobsForRepo(repoId);

    await Promise.all([
      this.db.db.delete(repos).where(eq(repos.repoId, repoId)),
      this.vectorStoreService.deleteByRepoId(repoId),
      this.ingestLogService.deleteLogsForRepo(repoId),
    ]);

    this.ingestLogService.emitReposChanged();
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
