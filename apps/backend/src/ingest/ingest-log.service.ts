import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { ingestLogs } from '../db/schema';

@Injectable()
export class IngestLogService {
  private readonly emitter = new EventEmitter();

  constructor(private readonly db: DbService) {
    // Prevent memory leak warnings when many SSE clients subscribe
    this.emitter.setMaxListeners(100);
  }

  async addLog(jobId: string, repoId: string, message: string): Promise<void> {
    // Emit synchronously first so SSE clients receive the log before the event loop
    // yields to the next IPC message (which may be the 'done' signal).
    this.emitter.emit(`log:${jobId}`, message);
    await this.db.db.insert(ingestLogs).values({ jobId, repoId, message });
  }

  async getLogs(jobId: string): Promise<string[]> {
    const rows = await this.db.db
      .select()
      .from(ingestLogs)
      .where(eq(ingestLogs.jobId, jobId))
      .orderBy(ingestLogs.createdAt);
    return rows.map((r) => r.message);
  }

  async deleteLogsForRepo(repoId: string): Promise<void> {
    await this.db.db.delete(ingestLogs).where(eq(ingestLogs.repoId, repoId));
  }

  /** Subscribe to new log lines for a job. Returns an unsubscribe function. */
  onLog(jobId: string, callback: (message: string) => void): () => void {
    this.emitter.on(`log:${jobId}`, callback);
    return () => this.emitter.off(`log:${jobId}`, callback);
  }

  /** Emit a progress update (0-100). Called by the processor. */
  emitProgress(jobId: string, value: number): void {
    this.emitter.emit(`progress:${jobId}`, value);
  }

  /** Subscribe to progress updates. Returns an unsubscribe function. */
  onProgress(jobId: string, callback: (value: number) => void): () => void {
    this.emitter.on(`progress:${jobId}`, callback);
    return () => this.emitter.off(`progress:${jobId}`, callback);
  }

  /** Emit job terminal state (completed or failed). Called by the processor. */
  emitDone(jobId: string, state: 'completed' | 'failed'): void {
    this.emitter.emit(`done:${jobId}`, state);
  }

  /** Subscribe to job completion/failure. Returns an unsubscribe function. */
  onDone(jobId: string, callback: (state: 'completed' | 'failed') => void): () => void {
    this.emitter.once(`done:${jobId}`, callback);
    return () => this.emitter.off(`done:${jobId}`, callback);
  }
}
