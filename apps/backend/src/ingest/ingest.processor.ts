import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { CloneService } from './clone.service';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';
import { CancellationService } from './cancellation.service';
import { INGEST_QUEUE } from './constants';

const REQUIRED_ENV_VARS = [
  { name: 'GOOGLE_API_KEY', description: 'Required for embeddings' },
  { name: 'UPSTASH_VECTOR_URL', description: 'Required for vector store' },
  { name: 'UPSTASH_VECTOR_TOKEN', description: 'Required for vector store' },
];

// Ingestion can take several minutes when embedding rate limits kick in.
// lockDuration must exceed the worst-case job runtime so BullMQ doesn't
// consider the job stalled and try to re-queue it.
@Processor(INGEST_QUEUE, { lockDuration: 600_000 })
export class IngestProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestProcessor.name);

  constructor(
    private readonly config: ConfigService,
    private readonly cloneService: CloneService,
    private readonly chunkingService: ChunkingService,
    private readonly embeddingService: EmbeddingService,
    private readonly vectorStoreService: VectorStoreService,
    private readonly cancellationService: CancellationService,
  ) {
    super();
  }

  private throwIfCancelled(repoId: string): void {
    if (this.cancellationService.isCancelled(repoId)) {
      throw new Error('Ingestion cancelled');
    }
  }

  async process(job: Job) {
    const { repoUrl, repoId, includePatterns, branch } = job.data;
    this.logger.log(`Starting ingestion for ${repoUrl}`);

    try {
      // Check required env vars before doing any work
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

      // Step 1: Clone the repo
      this.throwIfCancelled(repoId);
      await job.updateProgress(10);
      await job.log('Cloning repository...');
      this.logger.log(`[${repoId}] Cloning repository...`);
      const repoPath = await this.cloneService.clone(repoUrl, branch);

      // Step 2: Read and chunk files
      this.throwIfCancelled(repoId);
      await job.updateProgress(30);
      await job.log('Chunking files...');
      this.logger.log(`[${repoId}] Chunking files...`);
      const chunks = await this.chunkingService.chunkRepo(repoPath, {
        includePatterns: includePatterns || ['**/*.ts', '**/*.js', '**/*.py', '**/*.md', '**/*.txt'],
        excludePatterns: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
        chunkSize: 1000,
        chunkOverlap: 200,
      });
      await job.log(`Created ${chunks.length} chunks`);
      this.logger.log(`[${repoId}] Created ${chunks.length} chunks`);

      // Step 3: Embed chunks
      this.throwIfCancelled(repoId);
      await job.updateProgress(60);
      await job.log(`Embedding ${chunks.length} chunks...`);
      this.logger.log(`[${repoId}] Embedding ${chunks.length} chunks...`);
      const embeddings = await this.embeddingService.embedChunks(
        chunks,
        async (msg) => { await job.log(msg); },
        () => this.cancellationService.isCancelled(repoId),
      );

      // Step 4: Store in vector DB
      this.throwIfCancelled(repoId);
      await job.updateProgress(85);
      await job.log('Storing in vector DB...');
      this.logger.log(`[${repoId}] Storing in vector DB...`);
      await this.vectorStoreService.upsert(repoId, chunks, embeddings);

      // Step 5: Cleanup cloned files
      await this.cloneService.cleanup(repoPath);

      await job.updateProgress(100);
      await job.log('Ingestion complete');
      this.logger.log(`[${repoId}] Ingestion complete ✓`);
      this.cancellationService.clear(repoId);

      return { repoId, chunksStored: chunks.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'Ingestion cancelled') {
        await job.log('Ingestion cancelled by user');
        this.logger.warn(`[${repoId}] Ingestion cancelled`);
      } else {
        await job.log(`Error: ${message}`);
        this.logger.error(`[${repoId}] Ingestion failed: ${message}`);
      }
      throw error;
    }
  }
}
