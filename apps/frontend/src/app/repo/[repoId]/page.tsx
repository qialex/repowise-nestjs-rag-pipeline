'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { ArrowLeft, Send, Terminal, RotateCcw, Trash2, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import type { ChatMessage, IngestState } from '@repowise/shared';

type Message = ChatMessage;

const STATUS_LABEL: Record<IngestState, string> = {
  waiting: 'queued',
  active: 'ingesting',
  completed: 'ingested',
  failed: 'failed',
  unknown: 'unknown',
};

// Dev flag: set to true to keep all message log panels open by default
const DEV_LOGS_ALWAYS_OPEN = false;

export default function RepoPage() {
  const { repoId } = useParams<{ repoId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const jobId = searchParams.get('jobId');

  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [ingestState, setIngestState] = useState<IngestState>('waiting');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Set<number>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [restartDialogOpen, setRestartDialogOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const logsBottomRef = useRef<HTMLDivElement>(null);

  const headers = { 'Content-Type': 'application/json' };

  // Load existing logs if job is already done, or stream if active
  useEffect(() => {
    if (!jobId) return;

    let cancelled = false;

    const stream = async () => {
      // First check current state
      const statusRes = await fetch(`/api/ingest/status/${jobId}`, { headers });
      const status = await statusRes.json();

      if (status.state === 'completed' || status.state === 'failed') {
        setLogs(status.logs ?? []);
        setProgress(status.state === 'completed' ? 100 : (status.progress ?? 0));
        setIngestState(status.state);
        return;
      }

      setIngestState(status.state === 'active' ? 'active' : 'waiting');

      // Stream live logs via SSE
      const res = await fetch(`/api/ingest/logs/${jobId}`, { headers });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (reader && !cancelled) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6);
          if (raw === '[DONE]') break;
          try {
            const { log, progress: p, state } = JSON.parse(raw);
            if (log) setLogs((prev) => [...prev, log]);
            if (p !== undefined) setProgress(p);
            if (state === 'completed') { setProgress(100); setIngestState('completed'); }
            if (state === 'failed') setIngestState('failed');
          } catch {}
        }
      }
    };

    stream().catch(async () => {
      try {
        const statusRes = await fetch(`/api/ingest/status/${jobId}`, { headers });
        const status = await statusRes.json();
        setIngestState(status.state ?? 'failed');
        if (status.logs) setLogs(status.logs);
        if (status.progress !== undefined) setProgress(status.progress);
      } catch {
        setIngestState('failed');
      }
    });
    return () => { cancelled = true; };
  }, [jobId]);

  // Load chat history on mount
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/ask/history/${repoId}`, { headers });
        const history: Array<{ role: 'user' | 'assistant'; content: string; logs?: string[] }> = await res.json();
        if (history.length > 0) {
          setMessages(history.map((m) => ({ role: m.role, content: m.content, logs: m.logs })));
        }
      } catch {}
    };
    load();
  }, [repoId]);

  useEffect(() => {
    logsBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const ask = async () => {
    if (!input.trim() || isAsking) return;
    const question = input.trim();
    setInput('');
    setIsAsking(true);
    setMessages((prev) => [...prev, { role: 'user', content: question }, { role: 'assistant', content: '', logs: [] }]);

    try {
      const res = await fetch(`/api/ask/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ question, repoId }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6);
          if (raw === '[DONE]') break;
          try {
            const { text, log } = JSON.parse(raw);
            if (log) {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                updated[updated.length - 1] = { ...last, logs: [...(last.logs ?? []), log] };
                return updated;
              });
            }
            if (text) {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                updated[updated.length - 1] = { ...last, content: last.content + text };
                return updated;
              });
            }
          } catch {}
        }
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', content: 'Error fetching response.' };
        return updated;
      });
    } finally {
      setIsAsking(false);
    }
  };

  const deleteRepo = async () => {
    try {
      await fetch(`/api/ingest/repo/${repoId}`, { method: 'DELETE', headers });
      setDeleteDialogOpen(false);
      router.push('/');
    } catch {}
  };

  const restart = async () => {
    if (!jobId) return;
    setRestartDialogOpen(false);
    try {
      await fetch(`/api/ask/history/${repoId}`, { method: 'DELETE', headers });
      const res = await fetch(`/api/ingest/restart/${jobId}`, { method: 'POST', headers });
      const { jobId: newJobId } = await res.json();
      setLogs([]);
      setProgress(0);
      setIngestState('active');
      setMessages([]);
      const params = new URLSearchParams(searchParams.toString());
      params.set('jobId', newJobId);
      router.replace(`?${params.toString()}`);
    } catch {
      setIngestState('failed');
    }
  };

  const stateVariant: Record<IngestState, 'success' | 'destructive' | 'warning' | 'secondary'> = {
    waiting: 'secondary',
    active: 'warning',
    completed: 'success',
    failed: 'destructive',
    unknown: 'secondary',
  };

  return (
    <main className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b border-border px-6 py-4 flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="icon" onClick={() => router.push('/')}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-foreground truncate">
            {decodeURIComponent(repoId).replace('-', '/')}
          </h1>
          <p className="text-xs text-muted-foreground">github.com/{decodeURIComponent(repoId).replace('-', '/')}</p>
        </div>
        <Badge variant={stateVariant[ingestState]}>{STATUS_LABEL[ingestState]}</Badge>
        <Button variant="outline" size="icon" onClick={() => setRestartDialogOpen(true)} title="Restart ingestion">
          <RotateCcw className="w-4 h-4" />
        </Button>
        <Button variant="outline" size="icon" title="Remove repository" className="text-destructive hover:text-destructive" onClick={() => setDeleteDialogOpen(true)}>
          <Trash2 className="w-4 h-4" />
        </Button>
        <Dialog open={restartDialogOpen} onOpenChange={setRestartDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Restart ingestion?</DialogTitle>
              <DialogDescription>
                This will re-ingest <span className="font-medium text-foreground">{decodeURIComponent(repoId)}</span> and clear the chat history.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRestartDialogOpen(false)}>Cancel</Button>
              <Button onClick={restart}>Restart</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove repository?</DialogTitle>
              <DialogDescription>
                This will remove <span className="font-medium text-foreground">{decodeURIComponent(repoId)}</span> from the list. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
              <Button onClick={deleteRepo} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>

      {/* Ingestion logs — sticky below header */}
      <div className="shrink-0 max-w-3xl w-full mx-auto px-6 pt-6 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Terminal className="w-3.5 h-3.5" />
          <span>Ingestion logs</span>
          <span className="text-xs ml-auto">{progress}%</span>
        </div>
        <Progress value={progress} />
        {logs.length > 0 && (
          <ScrollArea className="h-32 rounded-md border border-border bg-muted/30 p-3">
            <div className="font-mono space-y-0.5">
              {logs.map((log, i) => (
                <p key={i} className="text-xs text-muted-foreground">
                  <span className="text-primary/60 mr-2">›</span>{log}
                </p>
              ))}
              <div ref={logsBottomRef} />
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Chat — full-width ScrollArea so scrollbar sits at page edge */}
      <ScrollArea className="flex-1 mt-6">
        <div className="max-w-3xl w-full mx-auto px-6 pb-2 space-y-4">
          {messages.length === 0 && (
            <p className="text-center text-muted-foreground text-sm py-12">
              Ask anything about <span className="text-foreground font-medium">{decodeURIComponent(repoId)}</span>
            </p>
          )}
          {messages.map((msg, i) => {
            const logsOpen = DEV_LOGS_ALWAYS_OPEN || expandedLogs.has(i) || (isAsking && i === messages.length - 1);
            return (
              <div key={i} className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                {msg.role === 'assistant' && msg.logs && msg.logs.length > 0 && (
                  <div className="w-full max-w-xl">
                    <button
                      onClick={() => setExpandedLogs((prev) => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i); else next.add(i);
                        return next;
                      })}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1 font-mono select-none"
                    >
                      <ChevronRight className={`w-3 h-3 transition-transform duration-200 ${logsOpen ? 'rotate-90' : ''}`} />
                      logs ({msg.logs.length})
                    </button>
                    <div className={`overflow-hidden transition-all duration-200 ${logsOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
                      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs space-y-0.5">
                        {msg.logs.map((log, j) => (
                          <p key={j} className="text-muted-foreground">
                            <span className="text-primary/60 mr-2">›</span>{log}
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                <div
                  className={`max-w-xl rounded-xl px-4 py-3 text-sm whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card border border-border text-foreground'
                  }`}
                >
                  {msg.content || <span className="animate-pulse text-muted-foreground">▊</span>}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input — sticky at bottom */}
      <div className="shrink-0 max-w-3xl w-full mx-auto px-6 py-4">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && ask()}
            placeholder="Ask about the codebase..."
            disabled={isAsking}
          />
          <Button onClick={ask} disabled={isAsking || !input.trim()} size="icon">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </main>
  );
}
