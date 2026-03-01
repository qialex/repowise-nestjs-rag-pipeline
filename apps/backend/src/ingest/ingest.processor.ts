import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { CloneService } from './clone.service';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';
import { INGEST_QUEUE } from './constants';

const REQUIRED_ENV_VARS = [
  { name: 'OPENAI_API_KEY', description: 'Required for embeddings' },
  { name: 'UPSTASH_VECTOR_URL', description: 'Required for vector store' },
  { name: 'UPSTASH_VECTOR_TOKEN', description: 'Required for vector store' },
];

@Processor(INGEST_QUEUE)
export class IngestProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestProcessor.name);

  constructor(
    private readonly config: ConfigService,
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
      await job.updateProgress(10);
      await job.log('Cloning repository...');
      this.logger.log(`[${repoId}] Cloning repository...`);
      const repoPath = await this.cloneService.clone(repoUrl, branch);

      // Step 2: Read and chunk files
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
      await job.updateProgress(60);
      await job.log(`Embedding ${chunks.length} chunks...`);
      this.logger.log(`[${repoId}] Embedding ${chunks.length} chunks...`);
      const embeddings = await this.embeddingService.embedChunks(chunks);

      // Step 4: Store in vector DB
      await job.updateProgress(85);
      await job.log('Storing in vector DB...');
      this.logger.log(`[${repoId}] Storing in vector DB...`);
      await this.vectorStoreService.upsert(repoId, chunks, embeddings);

      // Step 5: Cleanup cloned files
      await this.cloneService.cleanup(repoPath);

      await job.updateProgress(100);
      await job.log('Ingestion complete');
      this.logger.log(`[${repoId}] Ingestion complete ✓`);

      return { repoId, chunksStored: chunks.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await job.log(`Error: ${message}`);
      this.logger.error(`[${repoId}] Ingestion failed: ${message}`);
      throw error;
    }
  }
}
