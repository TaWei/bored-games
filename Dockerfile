FROM oven/bun:1.1-alpine AS base
WORKDIR /app

# Install dependencies stage
FROM base AS deps
COPY package.json bun.lockb ./
COPY packages/shared/package.json ./packages/shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN bun install --frozen-lockfile

# Build shared types
FROM deps AS shared-builder
COPY packages/shared ./packages/shared/
RUN bun run --cwd packages/shared build

# Build client
FROM deps AS client-builder
COPY client ./client/
RUN bun run --cwd client build

# Server stage
FROM base AS server-builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=shared-builder /app/packages/shared/dist ./packages/shared/dist
COPY server ./server/
RUN bun run --cwd server build

# Production
FROM base AS production
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=shared-builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=client-builder /app/client/dist ./client/dist
COPY --from=server-builder /app/server/dist ./server/dist
COPY --from=server-builder /app/server/package.json ./

EXPOSE 3000
CMD ["bun", "run", "server/dist/index.js"]
