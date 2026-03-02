export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  logs?: string[];
}

export interface Repo {
  repoId: string;
  repoUrl: string;
  ingestedAt: string;
  status: string;
  jobId: string;
}

export type IngestState = 'waiting' | 'active' | 'completed' | 'failed' | 'unknown';

export interface AskRequest {
  question: string;
  repoId?: string;
}

export interface IngestRequest {
  repoUrl: string;
  includePatterns?: string[];
  branch?: string;
}

export const MAX_CHUNKS = 500;
