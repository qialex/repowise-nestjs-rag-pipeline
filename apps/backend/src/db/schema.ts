import { pgTable, serial, varchar, text, timestamp, json } from 'drizzle-orm/pg-core';

export const repos = pgTable('repos', {
  repoId: varchar('repo_id', { length: 255 }).primaryKey(),
  repoUrl: text('repo_url').notNull(),
  ingestedAt: timestamp('ingested_at').defaultNow().notNull(),
  jobId: varchar('job_id', { length: 255 }),
  status: varchar('status', { length: 50 }).default('queued').notNull(),
});

export const chatMessages = pgTable('chat_messages', {
  id: serial('id').primaryKey(),
  repoId: varchar('repo_id', { length: 255 })
    .notNull()
    .references(() => repos.repoId, { onDelete: 'cascade' }),
  role: varchar('role', { length: 20 }).notNull(),
  content: text('content').notNull(),
  logs: json('logs').$type<string[]>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
