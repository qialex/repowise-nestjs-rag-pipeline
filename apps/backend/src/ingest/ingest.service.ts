import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { IngestRepoDto } from './dto/ingest-repo.dto';
import { INGEST_QUEUE } from './constants';

@Injectable()
export class IngestService {
  // In-memory registry of ingested repos (swap for DB in production)
  private readonly ingestedRepos = new Map<string, { repoUrl: string; ingestedAt: Date; status: string }>();

  constructor(@InjectQueue(INGEST_QUEUE) private readonly ingestQueue: Queue) {}

  async queueIngest(dto: IngestRepoDto) {
    const repoId = this.repoUrlToId(dto.repoUrl);

    const job = await this.ingestQueue.add(
      'clone-and-embed',
      { ...dto, repoId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    this.ingestedRepos.set(repoId, {
      repoUrl: dto.repoUrl,
      ingestedAt: new Date(),
      status: 'queued',
    });

    return job;
  }

  async getJobStatus(jobId: string) {
    const job = await this.ingestQueue.getJob(jobId);
    if (!job) throw new NotFoundException(`Job ${jobId} not found`);

    const state = await job.getState();
    const progress = job.progress;

    return { jobId, state, progress, data: job.data };
  }

  async listIngested() {
    return Array.from(this.ingestedRepos.entries()).map(([id, meta]) => ({
      repoId: id,
      ...meta,
    }));
  }

  async deleteRepo(repoId: string) {
    if (!this.ingestedRepos.has(repoId)) {
      throw new NotFoundException(`Repository ${repoId} not found`);
    }
    this.ingestedRepos.delete(repoId);
    // TODO: also delete vectors from vector store by repoId metadata filter
  }

  private repoUrlToId(url: string): string {
    return url.replace('https://github.com/', '').replace('/', '-');
  }
}
