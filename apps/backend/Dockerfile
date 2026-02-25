# ---- Base ----
FROM node:20-alpine AS base
WORKDIR /app
# Install git, bash and common utilities required by devcontainer features
RUN apk add --no-cache git bash curl wget
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# ---- Deps ----
FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install

# ---- Dev stage (used by devcontainer) ----
FROM deps AS dev
COPY . .
EXPOSE 3001
CMD ["pnpm", "run", "start:dev"]

# ---- Build ----
FROM deps AS builder
COPY . .
RUN pnpm run build

# ---- Production ----
FROM node:20-alpine AS prod
WORKDIR /app
# Install git, bash and common utilities for prod image consistency
RUN apk add --no-cache git bash curl wget
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

ENV NODE_ENV=production
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "dist/main"]
