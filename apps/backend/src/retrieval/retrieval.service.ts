import { Injectable } from '@nestjs/common';
import { VectorStoreService, SearchResult } from '../ingest/vector-store.service';
import { EmbeddingService } from '../ingest/embedding.service';

@Injectable()
export class RetrievalService {
  constructor(
    private readonly vectorStore: VectorStoreService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  async retrieve(query: string, repoId?: string, topK = 5): Promise<SearchResult[]> {
    const queryEmbedding = await this.embeddingService.embedQuery(query);
    return this.vectorStore.search(queryEmbedding, repoId, topK);
  }

  formatContext(results: SearchResult[]): string {
    return results
      .map(
        (r, i) =>
          `--- Source ${i + 1}: ${r.metadata.filePath} (score: ${r.score.toFixed(3)}) ---\n${r.content}`,
      )
      .join('\n\n');
  }
}
