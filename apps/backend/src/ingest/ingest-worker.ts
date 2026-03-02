/**
 * Standalone child-process worker for repository ingestion.
 *
 * Spawned by IngestProcessor via child_process.fork().
 * Receives one message with job data, runs the full ingestion pipeline,
 * then exits. The parent process can kill it at any time with SIGTERM.
 *
 * Messages sent to the parent:
 *   { type: 'progress', value: number }
 *   { type: 'log',      msg: string }
 *   { type: 'done',     result: { repoId, chunksStored } }
 *   { type: 'error',    message: string }
 */

// reflect-metadata must be the very first import so NestJS decorators on the
// service classes (run at import time) find Reflect.metadata already patched.
import 'reflect-metadata';

import { CloneService } from './clone.service';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';

// Minimal shim so services that depend on ConfigService can read from env.
// Child processes inherit process.env from the parent automatically.
const configShim = {
  get: <T>(key: string): T => process.env[key] as unknown as T,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cloneService   = new CloneService() as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const chunkingService = new ChunkingService() as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const embeddingService  = new EmbeddingService(configShim as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vectorStoreService = new VectorStoreService(configShim as any);

const send = (msg: object) => process.send!(msg);
const log  = async (msg: string) => { send({ type: 'log', msg }); };

process.on('message', async (data: {
  repoUrl: string;
  repoId: string;
  includePatterns?: string[];
  branch?: string;
}) => {
  const { repoUrl, repoId, includePatterns, branch } = data;

  try {
    // Step 1: Clone
    send({ type: 'progress', value: 10 });
    await log('Cloning repository...');
    const repoPath = await cloneService.clone(repoUrl, branch);

    // Step 2: Chunk
    send({ type: 'progress', value: 30 });
    await log('Chunking files...');
    const chunks = await chunkingService.chunkRepo(repoPath, {
      includePatterns: includePatterns ?? ['**/*.ts', '**/*.js', '**/*.py', '**/*.md', '**/*.txt'],
      excludePatterns: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    await log(`Created ${chunks.length} chunks`);

    // Step 3: Embed
    send({ type: 'progress', value: 60 });
    await log(`Embedding ${chunks.length} chunks...`);
    const embeddings = await embeddingService.embedChunks(chunks, log);

    // Step 4: Store
    send({ type: 'progress', value: 85 });
    await log('Storing in vector DB...');
    await vectorStoreService.upsert(repoId, chunks, embeddings);

    // Step 5: Cleanup
    await cloneService.cleanup(repoPath);

    send({ type: 'progress', value: 100 });
    await log('Ingestion complete');
    send({ type: 'done', result: { repoId, chunksStored: chunks.length } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send({ type: 'error', message });
  } finally {
    process.exit(0);
  }
});
