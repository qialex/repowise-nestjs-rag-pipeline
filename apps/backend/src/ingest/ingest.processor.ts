import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { fork, ChildProcess } from 'child_process';
import { eq } from 'drizzle-orm';
import * as path from 'path';
import { INGEST_QUEUE } from './constants';
import { IngestLogService } from './ingest-log.service';
import { DbService } from '../db/db.service';
import { repos } from '../db/schema';

const REQUIRED_ENV_VARS = [
  { name: 'GOOGLE_API_KEY',        description: 'Required for embeddings' },
  { name: 'UPSTASH_VECTOR_URL',    description: 'Required for vector store' },
  { name: 'UPSTASH_VECTOR_TOKEN',  description: 'Required for vector store' },
];

type WorkerMessage =
  | { type: 'progress'; value: number }
  | { type: 'log';      msg: string }
  | { type: 'done';     result: { repoId: string; chunksStored: number } }
  | { type: 'error';    message: string };

// Lock duration must exceed the worst-case job runtime (embedding + rate-limit retries).
// drainDelay: idle poll interval in seconds (default 5). Only affects empty-queue polling;
//   jobs still start immediately because BullMQ signals the marker key on enqueue.
//   30 s → ~16 commands/min idle vs ~96/min at the default of 5 s.
// stalledInterval: ms between stalled-job sweeps (default 30 000). 5 min is fine given
//   the 10-min lockDuration above.
@Processor(INGEST_QUEUE, { lockDuration: 600_000, drainDelay: 300, stalledInterval: 300_000 })
export class IngestProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestProcessor.name);

  /** repoId → active child process */
  private readonly activeWorkers = new Map<string, ChildProcess>();

  constructor(
    private readonly config: ConfigService,
    private readonly ingestLogService: IngestLogService,
    private readonly db: DbService,
  ) {
    super();
  }

  async process(job: Job): Promise<{ repoId: string; chunksStored: number }> {
    const { repoUrl, repoId, includePatterns, branch } = job.data;
    this.logger.log(`Starting ingestion for ${repoUrl}`);

    // Fast-fail before spawning if env vars are missing
    const missing = REQUIRED_ENV_VARS.filter(({ name }) => {
      const v = this.config.get<string>(name);
      return !v || v.includes('your-') || v === 'sk-...';
    });
    if (missing.length > 0) {
      for (const { name, description } of missing) {
        await this.ingestLogService.addLog(job.id as string, repoId, `Missing env var: ${name} — ${description}`);
      }
      this.ingestLogService.emitDone(job.id as string, 'failed');
      throw new Error(
        `Cannot start ingestion — missing environment variables: ${missing.map((m) => m.name).join(', ')}`,
      );
    }

    return new Promise((resolve, reject) => {
      // __dirname is dist/ingest/ at runtime (NestJS CLI compiles to dist/).
      // execArgv is forwarded so ts-node hooks are inherited when running in dev
      // mode without a compiled dist (e.g. plain `ts-node` invocation).
      const child = fork(path.join(__dirname, 'ingest-worker'), [], {
        execArgv: process.execArgv,
      });

      this.activeWorkers.set(repoId, child);

      child.on('message', async (msg: WorkerMessage) => {
        switch (msg.type) {
          case 'log':
            this.logger.log(`[${repoId}] ${msg.msg}`);
            await this.ingestLogService.addLog(job.id as string, repoId, msg.msg);
            break;
          case 'progress':
            await job.updateProgress(msg.value);
            this.ingestLogService.emitProgress(job.id as string, msg.value);
            break;
          case 'done':
            this.activeWorkers.delete(repoId);
            await this.db.db.update(repos).set({ status: 'completed' }).where(eq(repos.repoId, repoId));
            this.ingestLogService.emitReposChanged();
            this.ingestLogService.emitDone(job.id as string, 'completed');
            resolve(msg.result);
            break;
          case 'error':
            this.activeWorkers.delete(repoId);
            this.logger.error(`[${repoId}] ${msg.message}`);
            await this.ingestLogService.addLog(job.id as string, repoId, `Error: ${msg.message}`);
            await this.db.db.update(repos).set({ status: 'failed' }).where(eq(repos.repoId, repoId));
            this.ingestLogService.emitReposChanged();
            this.ingestLogService.emitDone(job.id as string, 'failed');
            reject(new Error(msg.message));
            break;
        }
      });

      child.on('exit', (code, signal) => {
        this.activeWorkers.delete(repoId);
        if (signal === 'SIGTERM' || signal === 'SIGKILL') {
          this.ingestLogService.emitDone(job.id as string, 'failed');
          reject(new Error('Ingestion cancelled'));
        } else if (code !== null && code !== 0) {
          this.db.db.update(repos).set({ status: 'failed' }).where(eq(repos.repoId, repoId)).catch(() => {});
          this.ingestLogService.emitReposChanged();
          this.ingestLogService.emitDone(job.id as string, 'failed');
          reject(new Error(`Worker process exited with code ${code}`));
        }
        // code 0 is handled via the 'done' message above
      });

      child.on('error', (err) => {
        this.activeWorkers.delete(repoId);
        reject(err);
      });

      // Send job data to the worker — env vars are inherited via process.env
      child.send({ repoUrl, repoId, includePatterns, branch });
    });
  }

  /**
   * Kill the active worker for a repo. Called by IngestService on delete/restart.
   * Returns true if a worker was found and killed, false if none was running.
   */
  killWorker(repoId: string): boolean {
    const child = this.activeWorkers.get(repoId);
    if (!child) return false;
    child.kill('SIGTERM');
    this.activeWorkers.delete(repoId);
    this.logger.warn(`[${repoId}] Worker process killed`);
    return true;
  }
}
