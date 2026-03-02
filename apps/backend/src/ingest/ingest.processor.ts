import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { fork, ChildProcess } from 'child_process';
import * as path from 'path';
import { INGEST_QUEUE } from './constants';

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
@Processor(INGEST_QUEUE, { lockDuration: 600_000 })
export class IngestProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestProcessor.name);

  /** repoId → active child process */
  private readonly activeWorkers = new Map<string, ChildProcess>();

  constructor(private readonly config: ConfigService) {
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
        await job.log(`Missing env var: ${name} — ${description}`);
      }
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
            await job.log(msg.msg);
            break;
          case 'progress':
            await job.updateProgress(msg.value);
            break;
          case 'done':
            this.activeWorkers.delete(repoId);
            resolve(msg.result);
            break;
          case 'error':
            this.activeWorkers.delete(repoId);
            reject(new Error(msg.message));
            break;
        }
      });

      child.on('exit', (code, signal) => {
        this.activeWorkers.delete(repoId);
        if (signal === 'SIGTERM' || signal === 'SIGKILL') {
          reject(new Error('Ingestion cancelled'));
        } else if (code !== null && code !== 0) {
          // Worker exited with error before sending an 'error' message
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
