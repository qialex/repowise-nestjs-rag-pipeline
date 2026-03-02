import { Injectable } from '@nestjs/common';

/**
 * Tracks repos whose ingestion jobs have been cancelled (e.g. on delete or restart).
 * Both IngestService and IngestProcessor share this singleton so the processor can
 * detect mid-job cancellation requests and abort early.
 */
@Injectable()
export class CancellationService {
  private readonly cancelled = new Set<string>();

  cancel(repoId: string): void {
    this.cancelled.add(repoId);
    // Auto-cleanup so the set doesn't grow unboundedly
    setTimeout(() => this.cancelled.delete(repoId), 30 * 60 * 1000);
  }

  isCancelled(repoId: string): boolean {
    return this.cancelled.has(repoId);
  }

  clear(repoId: string): void {
    this.cancelled.delete(repoId);
  }
}
