import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import { CodeChunk } from './chunking.service';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private embeddings: OpenAIEmbeddings | null = null;

  constructor(private readonly config: ConfigService) {
    this.initEmbeddings();
  }

  private initEmbeddings(): void {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey || apiKey.includes('your-') || apiKey === 'sk-...') {
      this.logger.warn(
        'OPENAI_API_KEY is not configured. Embedding features will be unavailable until it is set.',
      );
      return;
    }
    try {
      this.embeddings = new OpenAIEmbeddings({
        openAIApiKey: apiKey,
        modelName: 'text-embedding-3-small',
        batchSize: 512,
      });
    } catch (error) {
      this.logger.error('Failed to initialize OpenAI Embeddings client', error);
    }
  }

  private getEmbeddings(): OpenAIEmbeddings {
    if (!this.embeddings) {
      // Try to re-initialize in case env was updated at runtime
      this.initEmbeddings();
    }
    if (!this.embeddings) {
      throw new ServiceUnavailableException(
        'Embedding service is unavailable. OPENAI_API_KEY is not configured or invalid. ' +
        'Set a valid OPENAI_API_KEY environment variable and restart the server.',
      );
    }
    return this.embeddings;
  }

  async embedChunks(chunks: CodeChunk[]): Promise<number[][]> {
    const embeddings = this.getEmbeddings();
    const texts = chunks.map((c) => c.content);

    // Process in batches to avoid rate limits
    const batchSize = 100;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      this.logger.log(`Embedding batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)}`);
      const batchEmbeddings = await embeddings.embedDocuments(batch);
      allEmbeddings.push(...batchEmbeddings);
    }

    return allEmbeddings;
  }

  async embedQuery(query: string): Promise<number[]> {
    return this.getEmbeddings().embedQuery(query);
  }
}
