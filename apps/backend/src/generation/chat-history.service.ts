import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { chatMessages } from '../db/schema';
import { ChatMessage } from '@repowise/shared';

export type { ChatMessage };

const MAX_MESSAGES = 20;

@Injectable()
export class ChatHistoryService {
  constructor(private readonly db: DbService) {}

  async getHistory(repoId: string): Promise<ChatMessage[]> {
    const rows = await this.db.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.repoId, repoId))
      .orderBy(chatMessages.createdAt);

    return rows.map((row) => ({
      role: row.role as 'user' | 'assistant',
      content: row.content,
      ...(row.logs ? { logs: row.logs as string[] } : {}),
    }));
  }

  async saveHistory(repoId: string, messages: ChatMessage[]): Promise<void> {
    const trimmed = messages.slice(-MAX_MESSAGES);
    await this.db.db.delete(chatMessages).where(eq(chatMessages.repoId, repoId));
    if (trimmed.length > 0) {
      await this.db.db.insert(chatMessages).values(
        trimmed.map((msg) => ({
          repoId,
          role: msg.role,
          content: msg.content,
          logs: msg.logs ?? null,
        })),
      );
    }
  }

  async clearHistory(repoId: string): Promise<void> {
    await this.db.db.delete(chatMessages).where(eq(chatMessages.repoId, repoId));
  }
}
