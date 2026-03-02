import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { CodeChunk } from './chunking.service';

// Upstash free tier maximum is 1536 dimensions
const OUTPUT_DIMENSIONALITY = 1536;
// Smaller batches are less likely to timeout or trigger rate limits
const BATCH_SIZE = 25;
// Delay between batches to stay well under the 100 RPM free-tier limit
const INTER_BATCH_DELAY_MS = 3000;
// Per-batch network timeout
const BATCH_TIMEOUT_MS = 60_000;

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private model: GenerativeModel | null = null;

  constructor(private readonly config: ConfigService) {
    this.initEmbeddings();
  }

  private initEmbeddings(): void {
    const apiKey = this.config.get<string>('GOOGLE_API_KEY');
    if (!apiKey || apiKey.includes('your-')) {
      this.logger.warn(
        'GOOGLE_API_KEY is not configured. Embedding features will be unavailable until it is set.',
      );
      return;
    }
    try {
      this.model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: 'gemini-embedding-001' });
    } catch (error) {
      this.logger.error('Failed to initialize Google embedding model', error);
    }
  }

  private getModel(): GenerativeModel {
    if (!this.model) {
      this.initEmbeddings();
    }
    if (!this.model) {
      throw new ServiceUnavailableException(
        'Embedding service is unavailable. GOOGLE_API_KEY is not configured or invalid. ' +
        'Set a valid GOOGLE_API_KEY environment variable and restart the server.',
      );
    }
    return this.model;
  }

  private async withRateLimitRetry<T>(
    fn: () => Promise<T>,
    logFn?: (msg: string) => Promise<void>,
    maxRetries = 5,
  ): Promise<T> {
    let attempts = 0;
    while (true) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);
      try {
        const result = await fn();
        clearTimeout(timeout);
        return result;
      } catch (error) {
        clearTimeout(timeout);
        if (controller.signal.aborted) {
          throw new Error(`Embedding batch timed out after ${BATCH_TIMEOUT_MS / 1000}s — the API may be overloaded. Try again.`);
        }
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('429')) throw error;

        attempts++;
        if (attempts >= maxRetries) {
          throw new Error(
            `Embedding API rate limit hit ${maxRetries} times in a row. ` +
            'Your free-tier daily quota (1500 req/day) may be exhausted. Try again tomorrow.',
          );
        }

        const match = message.match(/retry in ([\d.]+)s/i);
        const waitMs = match ? Math.ceil(parseFloat(match[1])) * 1000 + 2000 : 62000;
        const waitSec = Math.round(waitMs / 1000);
        const msg = `Rate limit hit (attempt ${attempts}/${maxRetries}) — retrying in ${waitSec}s...`;
        this.logger.warn(msg);
        if (logFn) await logFn(msg);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }

  async embedChunks(
    chunks: CodeChunk[],
    logFn?: (msg: string) => Promise<void>,
    cancelFn?: () => boolean,
  ): Promise<number[][]> {
    const model = this.getModel();
    const texts = chunks.map((c) => c.content);
    const allEmbeddings: number[][] = [];
    const totalBatches = Math.ceil(texts.length / BATCH_SIZE);

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const batch = texts.slice(i, i + BATCH_SIZE);
      const msg = `Embedding batch ${batchNum}/${totalBatches} (${batch.length} chunks)...`;
      this.logger.log(msg);
      if (logFn) await logFn(msg);

      const result = await this.withRateLimitRetry(() =>
        model.batchEmbedContents({
          requests: batch.map((text) => ({
            content: { role: 'user', parts: [{ text }] },
            outputDimensionality: OUTPUT_DIMENSIONALITY,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any)),
        }),
        logFn ? (msg) => logFn(msg) : undefined,
      );

      const vectors = result.embeddings.map((e) => e.values ?? []);
      if (!vectors.length || vectors[0].length === 0) {
        throw new Error(
          `Embedding API returned empty vectors for batch ${batchNum}. ` +
          'Check that GOOGLE_API_KEY is valid.',
        );
      }

      allEmbeddings.push(...vectors);

      // Pause between batches to avoid saturating the free-tier rate limit
      if (i + BATCH_SIZE < texts.length) {
        if (cancelFn?.()) throw new Error('Ingestion cancelled');
        await new Promise((r) => setTimeout(r, INTER_BATCH_DELAY_MS));
        if (cancelFn?.()) throw new Error('Ingestion cancelled');
      }
    }

    return allEmbeddings;
  }

  async embedQuery(query: string): Promise<number[]> {
    const model = this.getModel();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await model.embedContent({
      content: { role: 'user', parts: [{ text: query }] },
      outputDimensionality: OUTPUT_DIMENSIONALITY,
    } as any);
    return result.embedding.values ?? [];
  }
}
