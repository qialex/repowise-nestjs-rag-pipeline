import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Index } from '@upstash/vector';
import { CodeChunk } from './chunking.service';

export interface SearchResult {
  content: string;
  metadata: CodeChunk['metadata'];
  score: number;
}

@Injectable()
export class VectorStoreService {
  private readonly logger = new Logger(VectorStoreService.name);
  private index: Index | null = null;

  constructor(private readonly config: ConfigService) {
    this.initIndex();
  }

  private initIndex(): void {
    const url = this.config.get<string>('UPSTASH_VECTOR_URL');
    const token = this.config.get<string>('UPSTASH_VECTOR_TOKEN');

    if (!url || !token || url.includes('your-') || token.includes('your-')) {
      this.logger.warn(
        'UPSTASH_VECTOR_URL or UPSTASH_VECTOR_TOKEN is not configured. ' +
        'Vector store features will be unavailable until they are set.',
      );
      return;
    }

    try {
      this.index = new Index({ url, token });
    } catch (error) {
      this.logger.error('Failed to initialize Upstash Vector index', error);
    }
  }

  private getIndex(): Index {
    if (!this.index) {
      this.initIndex();
    }
    if (!this.index) {
      throw new ServiceUnavailableException(
        'Vector store is unavailable. UPSTASH_VECTOR_URL and UPSTASH_VECTOR_TOKEN are not configured or invalid. ' +
        'Set valid environment variables and restart the server.',
      );
    }
    return this.index;
  }

  async upsert(repoId: string, chunks: CodeChunk[], embeddings: number[][]): Promise<void> {
    const index = this.getIndex();
    const vectors = chunks.map((chunk, i) => ({
      id: `${repoId}-chunk-${i}`,
      vector: embeddings[i],
      metadata: {
        repoId,
        content: chunk.content,
        ...chunk.metadata,
      },
    }));

    // Upsert in batches of 100
    const batchSize = 100;
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);
      await index.upsert(batch);
      this.logger.log(`Upserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(vectors.length / batchSize)}`);
    }
  }

  async search(queryEmbedding: number[], repoId?: string, topK = 5): Promise<SearchResult[]> {
    const index = this.getIndex();
    const filter = repoId ? `repoId = '${repoId}'` : undefined;

    const results = await index.query({
      vector: queryEmbedding,
      topK,
      filter,
      includeMetadata: true,
    });

    return results.map((r) => ({
      content: r.metadata?.content as string,
      metadata: {
        filePath: r.metadata?.filePath as string,
        fileExtension: r.metadata?.fileExtension as string,
        chunkIndex: r.metadata?.chunkIndex as number,
      },
      score: r.score,
    }));
  }

  async deleteByRepoId(repoId: string): Promise<void> {
    // Upstash Vector supports delete by filter in paid plans
    // For free tier, this is a no-op placeholder
    this.logger.warn(`Delete by repoId not supported on free tier — vectors for ${repoId} remain`);
  }
}
