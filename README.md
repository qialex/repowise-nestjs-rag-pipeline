# Repowise — NestJS RAG Pipeline

> Ask questions about any GitHub repository using natural language.  
> Built with **NestJS**, **LangChain.js**, **BullMQ**, **Upstash Vector**, and **Next.js**.

![CI](https://github.com/yourusername/repowise-nestjs-rag-pipeline/actions/workflows/ci.yml/badge.svg)

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Next.js Frontend                  │
│              (Streaming chat UI)                    │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP / SSE
┌──────────────────────▼──────────────────────────────┐
│                  NestJS Backend                     │
│                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ IngestModule│  │RetrievalMod. │  │  GenModule │ │
│  │             │  │              │  │            │ │
│  │ • CloneSvc  │  │ • Embed query│  │ • LLM call │ │
│  │ • ChunkSvc  │  │ • Vector     │  │ • Streaming│ │
│  │ • EmbedSvc  │  │   search     │  │   SSE      │ │
│  │ • VectorSvc │  └──────────────┘  └────────────┘ │
│  │ • BullMQ    │                                    │
│  │   Processor │                                    │
│  └──────┬──────┘                                    │
└─────────┼───────────────────────────────────────────┘
          │
  ┌───────▼────────┐    ┌─────────────────┐
  │  Upstash Redis │    │  Upstash Vector │
  │  (BullMQ queue)│    │  (embeddings)   │
  └────────────────┘    └─────────────────┘
```

### RAG Pipeline Flow

1. **POST /ingest/repo** — queues a BullMQ job with the GitHub URL  
2. **IngestProcessor** (BullMQ worker) — clones the repo → chunks files → embeds with OpenAI → stores in Upstash Vector  
3. **POST /ask/stream** — embeds the question → retrieves top-K chunks → streams LLM answer via SSE  

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend framework | NestJS 10 |
| Queue | BullMQ + Upstash Redis |
| Embeddings | OpenAI `text-embedding-3-small` |
| Vector store | Upstash Vector |
| LLM | OpenAI GPT-4o-mini (swappable) |
| RAG framework | LangChain.js |
| Frontend | Next.js 14 (App Router) |
| Deployment | Oracle Cloud Free Tier + Docker Compose |
| Dev environment | VS Code Dev Containers |
| CI | GitHub Actions |

---

## Getting Started

### Prerequisites

- Docker & Docker Compose
- VS Code with Dev Containers extension (recommended)
- Accounts: [Upstash](https://upstash.com) (free), [OpenAI](https://platform.openai.com)

### Local Development (Dev Container)

```bash
# 1. Clone the repo
git clone https://github.com/yourusername/repowise-nestjs-rag-pipeline
cd repowise-nestjs-rag-pipeline

# 2. Copy env files
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
# Fill in your API keys

# 3. Open in VS Code → "Reopen in Container"
# Dev container starts NestJS + Next.js + Redis automatically
```

### Manual Docker Dev

```bash
docker-compose -f docker-compose.dev.yml up
```

- NestJS API: http://localhost:3001  
- Swagger docs: http://localhost:3001/docs  
- Next.js UI: http://localhost:3000  

---

## API Reference

Full interactive docs available at `/docs` (Swagger UI).

### Ingest a repository
```bash
curl -X POST http://localhost:3001/ingest/repo \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-key" \
  -d '{ "repoUrl": "https://github.com/nestjs/nest" }'
```

### Check job status
```bash
curl http://localhost:3001/ingest/status/{jobId} \
  -H "x-api-key: your-key"
```

### Ask a question
```bash
curl -X POST http://localhost:3001/ask \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-key" \
  -d '{ "question": "How is the DI container set up?", "repoId": "nestjs-nest" }'
```

---

## Deployment (Oracle Cloud Free Tier)

Oracle Always Free gives you a 4-core ARM VM with 24GB RAM — more than enough.

```bash
# 1. SSH into your Oracle Cloud VM
ssh ubuntu@your-vm-ip

# 2. Install Docker
curl -fsSL https://get.docker.com | sh

# 3. Clone and configure
git clone https://github.com/yourusername/repowise-nestjs-rag-pipeline
cd repowise-nestjs-rag-pipeline
cp apps/backend/.env.example apps/backend/.env
# Edit .env with production values

# 4. Start
docker-compose up -d

# 5. Keep alive (add to cron-job.org)
# Ping: GET https://your-vm-ip/api/health every 10 minutes
```

> **Tip:** Point a free domain at your VM IP and add HTTPS with Certbot + Nginx for a polished demo URL.

---

## Project Structure

```
repowise-nestjs-rag-pipeline/
├── .devcontainer/
│   └── devcontainer.json         # VS Code dev container config
├── .github/workflows/
│   └── ci.yml                    # GitHub Actions CI
├── apps/
│   ├── backend/                  # NestJS application
│   │   └── src/
│   │       ├── ingest/           # Clone → chunk → embed → store
│   │       │   ├── ingest.processor.ts   # BullMQ worker
│   │       │   ├── clone.service.ts
│   │       │   ├── chunking.service.ts
│   │       │   ├── embedding.service.ts
│   │       │   └── vector-store.service.ts
│   │       ├── retrieval/        # Semantic search
│   │       ├── generation/       # LLM + streaming
│   │       ├── health/           # Keep-alive endpoint
│   │       └── common/guards/    # API key auth
│   └── frontend/                 # Next.js chat UI
├── docker-compose.yml            # Production
├── docker-compose.dev.yml        # Development (hot reload)
└── nginx.conf                    # Reverse proxy
```

---

## License

MIT
