# ── Stage 1: Install all dependencies ────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# openssl required by Prisma; libc6-compat for Alpine glibc compatibility
RUN apk add --no-cache libc6-compat openssl

COPY package.json package-lock.json ./
RUN npm ci


# ── Stage 2: Build the application ───────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

ARG SENTINEL_COMMIT=unknown
ARG SENTINEL_BUILT_AT=unknown

RUN apk add --no-cache libc6-compat openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client with Alpine-compatible binary
# Pin version to match @prisma/client in package.json
RUN npx prisma@6 generate

ENV NEXT_TELEMETRY_DISABLED=1
ENV SENTINEL_COMMIT=$SENTINEL_COMMIT
ENV SENTINEL_BUILT_AT=$SENTINEL_BUILT_AT

# Placeholder values satisfy next-auth and Prisma at build time.
# These are NOT used at runtime — supply real values via .env or docker-compose.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"

RUN npm run build


# ── Stage 3: Production runner ────────────────────────────────────────────────
# Debian slim (real glibc), not Alpine, specifically so the bind-mounted
# `claude` CLI binary (glibc-linked, embedded-V8 — see docker-compose.yml's
# runtime-bin mount) can execute. Confirmed on Alpine: gcompat's shim can't
# handle its TLS relocations ("unsupported relocation type 37" /
# __pthread_key_create missing), and the usual sgerrand/alpine-pkg-glibc
# workaround no longer has its key file hosted anywhere. Debian slim sidesteps
# the whole problem — deps/builder stay on Alpine; only this stage changed.
# prisma/schema.prisma's binaryTargets includes debian-openssl-3.0.x to match.
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ARG SENTINEL_COMMIT=unknown
ARG SENTINEL_BUILT_AT=unknown

# wget: the container healthcheck below uses it (Alpine ships it in busybox
# by default; Debian slim doesn't include it at all).
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates wget && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV SENTINEL_COMMIT=$SENTINEL_COMMIT
ENV SENTINEL_BUILT_AT=$SENTINEL_BUILT_AT

# Non-root user for security
RUN groupadd --system --gid 1001 nodejs \
 && useradd  --system --uid 1001 --gid nodejs nextjs

# Bare-name PATH resolution for the bind-mounted CLI runtimes (see
# docker-compose.yml's runtime-agents/bin mount at /opt/runtime-bin). The
# app itself calls these via the absolute-path *_EXECUTABLE env vars, but
# `command -v claude`/`command -v codex` — used by ops tooling and the VPS
# acceptance script — need them resolvable by bare name too. Dangling at
# build time is fine; the mount exists by the time the container runs.
# codex gets a wrapper, not a symlink: its launcher does
# `dirname "$0"` to find its sibling codex-lib directory, which resolves to
# the symlink's own location (/usr/local/bin) rather than following the
# link — an exec wrapper keeps $0 as the real absolute path instead.
RUN ln -s /opt/runtime-bin/claude /usr/local/bin/claude \
 && printf '#!/bin/sh\nexec /opt/runtime-bin/codex "$@"\n' > /usr/local/bin/codex \
 && chmod +x /usr/local/bin/codex

# Standalone output — only what's needed to run
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static     ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public           ./public

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
