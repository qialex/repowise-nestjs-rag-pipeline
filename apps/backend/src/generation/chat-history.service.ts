import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  logs?: string[];
}

const HISTORY_KEY = (repoId: string) => `chat:history:${repoId}`;
const MAX_MESSAGES = 20;

@Injectable()
export class ChatHistoryService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(private readonly config: ConfigService) {
    this.redis = new Redis({
      host: config.get('REDIS_HOST', '127.0.0.1'),
      port: config.get<number>('REDIS_PORT', 6379),
      password: config.get('REDIS_PASSWORD'),
      tls: config.get('REDIS_TLS') === 'true' ? {} : undefined,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
  }

  async getHistory(repoId: string): Promise<ChatMessage[]> {
    try {
      const data = await this.redis.get(HISTORY_KEY(repoId));
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  async saveHistory(repoId: string, messages: ChatMessage[]): Promise<void> {
    try {
      await this.redis.set(HISTORY_KEY(repoId), JSON.stringify(messages.slice(-MAX_MESSAGES)));
    } catch {}
  }

  async clearHistory(repoId: string): Promise<void> {
    try {
      await this.redis.del(HISTORY_KEY(repoId));
    } catch {}
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }
}
