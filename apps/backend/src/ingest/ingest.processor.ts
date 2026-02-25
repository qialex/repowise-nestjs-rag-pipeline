import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { CloneService } from './clone.service';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';
import { INGEST_QUEUE } from './constants';

@Processor(INGEST_QUEUE)
export class IngestProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestProcessor.name);

  constructor(
    private readonly cloneService: CloneService,
    private readonly chunkingService: ChunkingService,
    private readonly embeddingService: EmbeddingService,
    private readonly vectorStoreService: VectorStoreService,
  ) {
    super();
  }

  async process(job: Job) {
    const { repoUrl, repoId, includePatterns, branch } = job.data;
    this.logger.log(`Starting ingestion for ${repoUrl}`);

    try {
      // Step 1: Clone the repo
      await job.updateProgress(10);
      this.logger.log(`[${repoId}] Cloning repository...`);
      const repoPath = await this.cloneService.clone(repoUrl, branch);

      // Step 2: Read and chunk files
      await job.updateProgress(30);
      this.logger.log(`[${repoId}] Chunking files...`);
      const chunks = await this.chunkingService.chunkRepo(repoPath, {
        includePatterns: includePatterns || ['**/*.ts', '**/*.js', '**/*.py', '**/*.md', '**/*.txt'],
        excludePatterns: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
        chunkSize: 1000,
        chunkOverlap: 200,
      });
      this.logger.log(`[${repoId}] Created ${chunks.length} chunks`);

      // Step 3: Embed chunks
      await job.updateProgress(60);
      this.logger.log(`[${repoId}] Embedding ${chunks.length} chunks...`);
      const embeddings = await this.embeddingService.embedChunks(chunks);

      // Step 4: Store in vector DB
      await job.updateProgress(85);
      this.logger.log(`[${repoId}] Storing in vector DB...`);
      await this.vectorStoreService.upsert(repoId, chunks, embeddings);

      // Step 5: Cleanup cloned files
      await this.cloneService.cleanup(repoPath);

      await job.updateProgress(100);
      this.logger.log(`[${repoId}] Ingestion complete ✓`);

      return { repoId, chunksStored: chunks.length };
    } catch (error) {
      this.logger.error(`[${repoId}] Ingestion failed: ${error.message}`);
      throw error;
    }
  }
}
