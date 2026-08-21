# syntax=docker/dockerfile:1.6

FROM oven/bun:1 AS base
WORKDIR /app

# --- deps (cached until package.json / bun.lock changes) ---
FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --no-save --frozen-lockfile

# --- builder (re-runs when your source changes) ---
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# --- runner ---
FROM oven/bun:1 AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=5000 \
    HOSTNAME="0.0.0.0"

# create user
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --no-log-init -g nodejs nextjs

# copy app output
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# entrypoint (and make /app writable for .env generation if you keep that)
COPY --chown=nextjs:nodejs docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

USER nextjs
EXPOSE 5000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["bun", "./server.js"]