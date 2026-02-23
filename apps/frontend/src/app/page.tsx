'use client';

import { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [repoId, setRepoId] = useState('');
  const [isIngesting, setIsIngesting] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [ingestStatus, setIngestStatus] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  const API_KEY = process.env.NEXT_PUBLIC_API_KEY || '';

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY,
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const ingestRepo = async () => {
    if (!repoUrl) return;
    setIsIngesting(true);
    setIngestStatus('Queuing ingestion...');

    try {
      const res = await fetch(`${API_URL}/ingest/repo`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ repoUrl }),
      });

      const data = await res.json();
      setRepoId(data.repoId || repoUrl.replace('https://github.com/', '').replace('/', '-'));
      setIngestStatus(`✓ Queued! Job ID: ${data.jobId}. Processing in background...`);
    } catch {
      setIngestStatus('✗ Failed to queue ingestion.');
    } finally {
      setIsIngesting(false);
    }
  };

  const ask = async () => {
    if (!input.trim()) return;
    const question = input.trim();
    setInput('');
    setIsAsking(true);

    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    try {
      const res = await fetch(`${API_URL}/ask/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ question, repoId: repoId || undefined }),
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
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;
            try {
              const { text } = JSON.parse(data);
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: 'assistant',
                  content: updated[updated.length - 1].content + text,
                };
                return updated;
              });
            } catch {}
          }
        }
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', content: '✗ Error fetching response.' };
        return updated;
      });
    } finally {
      setIsAsking(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 p-4 flex items-center gap-3">
        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center font-bold text-sm">R</div>
        <div>
          <h1 className="font-semibold text-white">Repowise</h1>
          <p className="text-xs text-gray-500">RAG pipeline over GitHub repos · NestJS + Upstash</p>
        </div>
      </header>

      {/* Ingest bar */}
      <div className="border-b border-gray-800 p-4 bg-gray-900">
        <p className="text-xs text-gray-400 mb-2 uppercase tracking-wider">1. Ingest a repository</p>
        <div className="flex gap-2">
          <input
            type="url"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            onKeyDown={(e) => e.key === 'Enter' && ingestRepo()}
          />
          <button
            onClick={ingestRepo}
            disabled={isIngesting || !repoUrl}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {isIngesting ? 'Queuing...' : 'Ingest'}
          </button>
        </div>
        {ingestStatus && <p className="text-xs text-gray-400 mt-2">{ingestStatus}</p>}
        {repoId && (
          <p className="text-xs text-indigo-400 mt-1">Scoped to: <code>{repoId}</code></p>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-600 mt-16">
            <p className="text-lg mb-2">Ask anything about your repo</p>
            <p className="text-sm">Try: "How is authentication handled?" or "What does the AppModule import?"</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-2xl rounded-xl px-4 py-3 text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-100'
              }`}
            >
              {msg.content || <span className="animate-pulse text-gray-500">▊</span>}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-800 p-4">
        <div className="flex gap-2 max-w-4xl mx-auto">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && ask()}
            placeholder="Ask about the codebase..."
            disabled={isAsking}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50"
          />
          <button
            onClick={ask}
            disabled={isAsking || !input.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-5 py-3 rounded-xl text-sm font-medium transition-colors"
          >
            {isAsking ? '...' : 'Ask'}
          </button>
        </div>
      </div>
    </main>
  );
}
