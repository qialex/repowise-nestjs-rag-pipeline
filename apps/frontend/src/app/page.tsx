'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { GitFork, Plus, ChevronRight, Clock, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { buttonVariants } from '@/components/ui/button';
import type { Repo } from '@repowise/shared';

const STATUS_LABEL: Record<string, string> = {
  waiting: 'queued',
  active: 'ingesting',
  completed: 'ingested',
  failed: 'failed',
  unknown: 'unknown',
};

export default function Home() {
  const router = useRouter();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [repoUrl, setRepoUrl] = useState('');
  const [isIngesting, setIsIngesting] = useState(false);
  const [restarting, setRestarting] = useState<string | null>(null);
  const [deletingRepoId, setDeletingRepoId] = useState<string | null>(null);
  const [restartingDialogRepoId, setRestartingDialogRepoId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const headers = { 'Content-Type': 'application/json' };

  const fetchRepos = () => {
    fetch(`/api/ingest/repos`, { headers })
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setRepos(data); })
      .catch(() => {});
  };

  useEffect(() => {
    fetchRepos();
    const interval = setInterval(fetchRepos, 3000);
    return () => clearInterval(interval);
  }, []);

  const deleteRepo = async (repo: Repo) => {
    try {
      await fetch(`/api/ingest/repo/${repo.repoId}`, { method: 'DELETE', headers });
      setDeletingRepoId(null);
      setRepos((prev) => prev.filter((r) => r.repoId !== repo.repoId));
    } catch {
      fetchRepos();
    }
  };

  const restartRepo = async (repo: Repo) => {
    setRestartingDialogRepoId(null);
    setRestarting(repo.repoId);
    try {
      await fetch(`/api/ask/history/${repo.repoId}`, { method: 'DELETE', headers });
      const res = await fetch(`/api/ingest/restart/${repo.jobId}`, { method: 'POST', headers });
      const data = await res.json();
      setRepos((prev) => prev.map((r) => r.repoId === repo.repoId ? { ...r, jobId: data.jobId, status: 'waiting' } : r));
    } catch {
      fetchRepos();
    } finally {
      setRestarting(null);
    }
  };

  const isValidGithubUrl = (url: string) =>
    /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(url);

  const ingestRepo = async () => {
    if (!isValidGithubUrl(repoUrl)) {
      setError('Please enter a valid GitHub URL (https://github.com/owner/repo)');
      return;
    }
    setError('');
    setIsIngesting(true);

    try {
      const res = await fetch(`/api/ingest/repo`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ repoUrl }),
      });
      const data = await res.json();
      const newRepo: Repo = {
        repoId: data.repoId || repoUrl.replace('https://github.com/', '').replace('/', '-'),
        repoUrl,
        ingestedAt: new Date().toISOString(),
        status: 'queued',
        jobId: data.jobId,
      };
      setRepos((prev) => [newRepo, ...prev.filter((r) => r.repoId !== newRepo.repoId)]);
      setRepoUrl('');
      router.push(`/repo/${newRepo.repoId}?jobId=${data.jobId}`);
    } catch {
      setError('Failed to queue ingestion. Is the backend running?');
    } finally {
      setIsIngesting(false);
    }
  };

  const deletingRepo = repos.find((r) => r.repoId === deletingRepoId) ?? null;

  return (
    <main className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Sticky header */}
      <header className="border-b border-border px-6 py-4 flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center font-bold text-sm text-primary-foreground">
          R
        </div>
        <div>
          <h1 className="font-semibold text-foreground">Repowise</h1>
          <p className="text-xs text-muted-foreground">RAG pipeline over GitHub repos</p>
        </div>
      </header>

      {/* Sticky ingest form */}
      <div className="shrink-0">
        <div className="max-w-2xl mx-auto px-6 pt-6 pb-2 space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Ingest a repository
          </h2>
          <div className="flex gap-2 pt-3">
            <Input
              type="url"
              value={repoUrl}
              onChange={(e) => { setRepoUrl(e.target.value); setError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && ingestRepo()}
              placeholder="https://github.com/owner/repo"
            />
            <Button onClick={ingestRepo} disabled={isIngesting || !repoUrl}>
              <Plus className="w-4 h-4" />
              {isIngesting ? 'Queuing...' : 'Ingest'}
            </Button>
          </div>
          <p className={`text-xs min-h-[1rem] ${error ? 'text-destructive' : 'invisible'}`}>{error || ' '}</p>
        </div>
      </div>

      {/* Sticky repos heading */}
      <div className="shrink-0">
        <div className="max-w-2xl mx-auto px-6 py-4 pt-1">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Ingested repositories
          </h2>
        </div>
      </div>

      {/* Scrollable repo list */}
      <ScrollArea className="flex-1">
        <div className="max-w-2xl mx-auto px-6 py-4 space-y-2">
          {repos.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No repositories ingested yet.
            </p>
          ) : (
            repos.map((repo) => (
              <Card
                key={repo.repoId}
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => deletingRepoId === null && router.push(`/repo/${repo.repoId}?jobId=${repo.jobId}`)}
              >
                <CardContent className="p-4 flex items-center gap-3">
                  <GitFork className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {repo.repoUrl.replace('https://github.com/', '')}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3" />
                      {new Date(repo.ingestedAt).toLocaleString()}
                    </p>
                  </div>
                  <Badge variant={
                    repo.status === 'completed' ? 'success' :
                    repo.status === 'failed' ? 'destructive' :
                    repo.status === 'active' ? 'warning' :
                    'secondary'
                  }>
                    {STATUS_LABEL[repo.status] ?? repo.status}
                  </Badge>
                  <Button
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    disabled={restarting === repo.repoId}
                    onClick={(e) => { e.stopPropagation(); setRestartingDialogRepoId(repo.repoId); }}
                    title="Restart ingestion"
                  >
                    <RotateCcw className={`w-4 h-4 ${restarting === repo.repoId ? 'animate-spin' : ''}`} />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="shrink-0 text-destructive hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); setDeletingRepoId(repo.repoId); }}
                    title="Remove repository"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Restart confirmation dialog */}
      {(() => {
        const restartingRepo = repos.find((r) => r.repoId === restartingDialogRepoId) ?? null;
        return (
          <Dialog open={restartingDialogRepoId !== null} onOpenChange={(open) => !open && setRestartingDialogRepoId(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Restart ingestion?</DialogTitle>
                <DialogDescription>
                  This will re-ingest{' '}
                  <span className="font-medium text-foreground">
                    {restartingRepo?.repoUrl.replace('https://github.com/', '')}
                  </span>{' '}
                  and clear the chat history.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <button className={buttonVariants({ variant: 'outline' })} onClick={() => setRestartingDialogRepoId(null)}>
                  Cancel
                </button>
                <button
                  className={buttonVariants()}
                  onClick={() => restartingRepo && restartRepo(restartingRepo)}
                >
                  Restart
                </button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* Delete confirmation dialog */}
      <Dialog open={deletingRepoId !== null} onOpenChange={(open) => !open && setDeletingRepoId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove repository?</DialogTitle>
            <DialogDescription>
              This will remove{' '}
              <span className="font-medium text-foreground">
                {deletingRepo?.repoUrl.replace('https://github.com/', '')}
              </span>{' '}
              from the list. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button className={buttonVariants({ variant: 'outline' })} onClick={() => setDeletingRepoId(null)}>
              Cancel
            </button>
            <button
              className={buttonVariants({ variant: 'destructive' })}
              onClick={() => deletingRepo && deleteRepo(deletingRepo)}
            >
              Remove
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
