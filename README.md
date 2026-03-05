# Repowise — GitHub Repo Chat (RAG Pipeline)

> Ask natural-language questions about any GitHub repository and get answers grounded in its actual source code.
> Built with **NestJS**, **Next.js**, **BullMQ**, **Groq**, **Google Gemini**, and **Upstash**.

---

## How it works

```
┌──────────────────────────────────────────────────────────┐
│                    Next.js Frontend                      │
│         Repository list · Ingestion logs · Chat UI       │
└───────────────────────────┬──────────────────────────────┘
                            │ HTTP + SSE
┌───────────────────────────▼──────────────────────────────┐
│                     NestJS Backend                       │
│                                                          │
│  ┌──────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │ IngestModule │  │ RetrievalModule │  │  GenModule  │  │
│  │              │  │                 │  │             │  │
│  │ BullMQ queue │  │  Embed query    │  │  Groq LLM   │  │
│  │ + fork() per │  │  Vector search  │  │  SSE stream │  │
│  │   job        │  └─────────────────┘  └─────────────┘  │
│  └──────┬───────┘                                        │
└─────────┼────────────────────────────────────────────────┘
          │ child_process.fork()
┌─────────▼────────────────────────┐
│         ingest-worker (Node.js)  │
│  clone → chunk → embed → upsert  │
│  Killed instantly via SIGTERM    │
└──────────────────────────────────┘

      Upstash Redis          Upstash Vector
    (BullMQ job queue)    (1536-dim embeddings)
```

### Ingestion pipeline

1. User submits a GitHub URL → `POST /ingest/repo`
2. BullMQ queues a job in Upstash Redis
3. `IngestProcessor` picks up the job and **forks a child process** (`ingest-worker`)
4. The worker: clones the repo → chunks files → embeds with Google Gemini → stores in Upstash Vector
5. Logs are written to Neon Postgres and streamed to the UI via SSE (in-process EventEmitter, zero extra Redis reads)

### Chat pipeline

1. User asks a question → `POST /ask/stream`
2. Backend embeds the query (Gemini), retrieves top-K chunks from Upstash Vector
3. Streams the LLM answer (Groq / Llama 3.3) token-by-token via SSE

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend framework | NestJS 11 |
| Job queue | BullMQ 5 + Upstash Redis |
| Embeddings | Google Gemini (`gemini-embedding-001`, 1536 dims) |
| Vector store | Upstash Vector |
| LLM / chat | Groq (`llama-3.3-70b-versatile`) |
| RAG framework | LangChain.js |
| Database | Neon Postgres (repo metadata + chat history) |
| Frontend | Next.js 14 (App Router) |
| Analytics | Vercel Analytics |
| Styling | Tailwind CSS + Radix UI |
| Dev environment | VS Code Dev Containers |
| Deployment | Railway (backend) + Vercel (frontend) |

---

## Prerequisites

Free-tier accounts required:

| Service | Used for | Sign-up |
|---|---|---|
| [Neon](https://neon.tech) | Postgres database | Free |
| [Upstash](https://upstash.com) | Redis (job queue) + Vector DB | Free |
| [Groq](https://console.groq.com) | LLM chat (very fast, free tier) | Free |
| [Google AI Studio](https://aistudio.google.com) | Gemini embeddings (1500 req/day free) | Free |

---

## Quick start

### 1. Clone and configure

```bash
git clone https://github.com/yourusername/repowise
cd repowise

cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
```

Edit `apps/backend/.env`:

```env
# Groq — free LLM (https://console.groq.com)
GROQ_API_KEY=gsk_...
LLM_MODEL=llama-3.3-70b-versatile

# Google Gemini — free embeddings (https://aistudio.google.com)
GOOGLE_API_KEY=AIza...

# Neon Postgres (https://neon.tech)
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require

# Upstash Redis — job queue (https://console.upstash.com)
REDIS_HOST=your-host.upstash.io
REDIS_PORT=6379
REDIS_PASSWORD=your-password
REDIS_TLS=true

# Upstash Vector — vector store (https://console.upstash.com)
UPSTASH_VECTOR_URL=https://your-index.upstash.io
UPSTASH_VECTOR_TOKEN=your-token

# Shared API key between frontend and backend
API_KEY=any-secret-string

PORT=3001
FRONTEND_URL=http://localhost:3000
```

Edit `apps/frontend/.env`:

```env
BACKEND_URL=http://localhost:3001
API_KEY=any-secret-string   # same as API_KEY above
```

### 2. Run (Dev Container — recommended)

Open the repo in VS Code and select **"Reopen in Container"**.
NestJS, Next.js, and a local Redis instance start automatically with hot reload.

### 3. Run (Docker Compose)

```bash
docker-compose -f docker-compose.dev.yml up
```

### 4. Run (bare Node.js)

```bash
pnpm install
pnpm dev          # starts backend (3001) + frontend (3000) in parallel
```

| URL | Description |
|---|---|
| http://localhost:3000 | Chat UI |
| http://localhost:3001/docs | Swagger / OpenAPI |

---

## API

All endpoints require `x-api-key: <API_KEY>` header.
Full interactive docs at `http://localhost:3001/docs`.

### Ingest

```bash
# Queue a repository
curl -X POST http://localhost:3001/ingest/repo \
  -H "x-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"repoUrl": "https://github.com/nestjs/nest"}'

# Stream ingestion logs (SSE)
curl http://localhost:3001/ingest/logs/{jobId} -H "x-api-key: your-key"

# List ingested repos
curl http://localhost:3001/ingest/repos -H "x-api-key: your-key"

# Delete a repo (stops active ingestion immediately)
curl -X DELETE http://localhost:3001/ingest/repo/{repoId} -H "x-api-key: your-key"
```

### Chat

```bash
# Streaming answer (SSE)
curl -X POST http://localhost:3001/ask/stream \
  -H "x-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"question": "How does the DI container work?", "repoId": "nestjs-nest"}'

# Clear chat history
curl -X DELETE http://localhost:3001/ask/history/{repoId} -H "x-api-key: your-key"
```

---

## Project structure

```
repowise/
├── apps/
│   ├── backend/src/
│   │   ├── ingest/
│   │   │   ├── ingest.controller.ts      # REST endpoints
│   │   │   ├── ingest.service.ts         # Job management, SSE log streaming
│   │   │   ├── ingest.processor.ts       # BullMQ worker — forks child per job
│   │   │   ├── ingest-log.service.ts     # Logs → Postgres + EventEmitter SSE push
│   │   │   ├── ingest-worker.ts          # Child process: clone→chunk→embed→store
│   │   │   ├── clone.service.ts
│   │   │   ├── chunking.service.ts
│   │   │   ├── embedding.service.ts      # Gemini, batched, rate-limit retry
│   │   │   └── vector-store.service.ts   # Upstash Vector upsert + search
│   │   ├── retrieval/                    # Semantic search endpoint
│   │   ├── generation/                   # Groq LLM + chat history
│   │   ├── health/                       # Health check endpoint
│   │   └── common/guards/               # API key auth guard
│   └── frontend/src/app/
│       ├── page.tsx                      # Repository list + ingest form
│       └── repo/[repoId]/page.tsx        # Chat + live ingestion logs
├── packages/shared/                      # Shared TypeScript types
├── docker-compose.yml                    # Production
├── docker-compose.dev.yml                # Development (hot reload)
└── nginx.conf                            # Reverse proxy (prod)
```

---

## Deployment

### Railway (backend)

Set all backend environment variables in the Railway dashboard. The `railway.toml` is pre-configured:

- **Build:** `pnpm --filter @repowise/shared build && pnpm --filter @repowise/backend build`
- **Start:** `node apps/backend/dist/main`
- **Health check:** `GET /health`

### Vercel (frontend)

Set `BACKEND_URL` and `API_KEY` in the Vercel dashboard. The `vercel.json` is pre-configured.

### Docker Compose (self-hosted)

```bash
# On your server
git clone https://github.com/yourusername/repowise
cd repowise
cp apps/backend/.env.example apps/backend/.env
# fill in production values

docker-compose up -d
```

---

## Notes

- **Gemini free tier** — 1500 embedding requests/day. With the default batch size of 25 chunks, a ~375-chunk repo uses the full daily quota. If ingestion fails with a rate-limit error after 5 retries, wait until midnight (Pacific) for the quota to reset.
- **Job cancellation** — Deleting or restarting a repo sends `SIGTERM` to the worker child process, stopping ingestion instantly regardless of what it's doing.
- **Chat history** — Stored in Neon Postgres per repo; cleared automatically on restart or delete.

---

## License

MIT
