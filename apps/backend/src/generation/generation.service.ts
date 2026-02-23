import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { RetrievalService } from '../retrieval/retrieval.service';
import { Response } from 'express';

@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);
  private llm: ChatOpenAI | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly retrievalService: RetrievalService,
  ) {
    this.initLlm();
  }

  private initLlm(): void {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey || apiKey.includes('your-') || apiKey === 'sk-...') {
      this.logger.warn(
        'OPENAI_API_KEY is not configured. Generation features will be unavailable until it is set.',
      );
      return;
    }
    try {
      this.llm = new ChatOpenAI({
        openAIApiKey: apiKey,
        modelName: this.config.get('LLM_MODEL', 'gpt-4o-mini'),
        temperature: 0.2,
        streaming: true,
      });
    } catch (error) {
      this.logger.error('Failed to initialize ChatOpenAI client', error);
    }
  }

  private getLlm(): ChatOpenAI {
    if (!this.llm) {
      this.initLlm();
    }
    if (!this.llm) {
      throw new ServiceUnavailableException(
        'Generation service is unavailable. OPENAI_API_KEY is not configured or invalid. ' +
        'Set a valid OPENAI_API_KEY environment variable and restart the server.',
      );
    }
    return this.llm;
  }

  async ask(question: string, repoId?: string): Promise<string> {
    const llm = this.getLlm();
    const context = await this.buildContext(question, repoId);

    const response = await llm.invoke([
      new SystemMessage(this.systemPrompt()),
      new HumanMessage(`Context:\n${context}\n\nQuestion: ${question}`),
    ]);

    return response.content as string;
  }

  async askStream(question: string, repoId: string | undefined, res: Response): Promise<void> {
    const llm = this.getLlm();
    const context = await this.buildContext(question, repoId);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = await llm.stream([
      new SystemMessage(this.systemPrompt()),
      new HumanMessage(`Context:\n${context}\n\nQuestion: ${question}`),
    ]);

    for await (const chunk of stream) {
      const text = chunk.content as string;
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  }

  private async buildContext(question: string, repoId?: string): Promise<string> {
    const results = await this.retrievalService.retrieve(question, repoId, 6);
    return this.retrievalService.formatContext(results);
  }

  private systemPrompt(): string {
    return `You are Repowise, an expert code assistant. You answer questions about codebases using the provided context.

Rules:
- Answer based only on the provided context
- Reference specific file paths when relevant (e.g. "In src/app.module.ts...")  
- If the context doesn't contain enough info, say so clearly
- Keep answers concise and technically precise
- Format code snippets with markdown code blocks`;
  }
}
