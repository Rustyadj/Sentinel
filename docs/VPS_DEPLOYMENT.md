# VPS Deployment Guide

Sentinel OS runs on the VPS as the default web UI. Hermes Lisa and Hermes Nathan2 are managed backend agent services accessible from Sentinel's Agent Registry; Claude Code and Codex run as process-transport coding runtimes.

## Architecture

```
Internet (443)
    │
    ▼
Nginx / Caddy (TLS termination)
    ├── /                 →  Sentinel OS (port 3000, Docker)
    ├── /api/mcp          →  MCP control plane for external clients
    └── /legacy/hermes    →  Hermes Lisa legacy UI (port 4862)

Sentinel OS (Next.js, Docker)
    ├── /api/health         →  DB liveness check
    ├── /api/ready          →  DB + Redis + agent endpoint checks
    ├── /api/vps/agents     →  VPS agent registry list
    ├── /api/agents/:id/health    →  live health ping
    ├── /api/agents/:id/logs      →  docker logs (server-side)
    ├── /api/agents/:id/restart   →  docker restart (owner/admin only)
    ├── /api/agents/:id/reload    →  SIGHUP or restart (owner/admin only)
    └── /api/agents/:id/config-files/[fileId]  →  read/write config (owner/admin)
```

## Quick Start

### 1. Clone and configure

```bash
cd /opt/sentinel-os
cp .env.example .env.local
nano .env.local   # fill in AUTH_SECRET, AUTH_URL, CONTROL_PLANE_OWNERS
```

### 2. Create agent config directories

```bash
mkdir -p /opt/sentinel-os/agents/hermes-lisa
mkdir -p /opt/sentinel-os/agents/hermes-clint
mkdir -p /opt/sentinel-os/logs

# Seed initial CLAUDE.md configs
cp /root/.claude/CLAUDE.md /opt/sentinel-os/agents/hermes-lisa/CLAUDE.md
```

### 3. Build and start

```bash
# Verify compose config
docker compose config

# Build and start all services
docker compose up --build -d

# Check status
docker compose ps
docker compose logs app --tail 50
```

### 4. Verify health

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/ready
```

### 5. Set up reverse proxy

**Nginx:**
```bash
cp docs/proxy/nginx.conf /etc/nginx/sites-available/sentinel
ln -s /etc/nginx/sites-available/sentinel /etc/nginx/sites-enabled/
certbot --nginx -d srv1427612.hstgr.cloud
nginx -t && systemctl reload nginx
```

**Caddy:**
```bash
cp docs/proxy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
```

## Environment Variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | PostgreSQL + pgvector |
| `AUTH_SECRET` | ✅ | — | NextAuth session secret |
| `AUTH_URL` | ✅ | `http://localhost:3000` | Public URL |
| `REDIS_URL` | — | — | Redis for caching (optional) |
| `SENTINEL_DEFAULT_UI` | — | `true` | Self-identification flag |
| `CONTROL_PLANE_OWNERS` | — | `""` | Comma-separated owner emails |
| `HERMES_ENDPOINT` | — | `http://127.0.0.1:4862` | Hermes Lisa health check |
| `HERMES_NATHAN2_ENDPOINT` | — | `http://127.0.0.1:4864` | Hermes Nathan2 health check |
| `AGENT_CONFIG_DIR` | — | `/opt/sentinel-os/agents` | Root for agent config files |
| `AGENT_LOG_DIR` | — | `/opt/sentinel-os/logs` | Root for agent log files |

## npm Scripts

```bash
npm run build       # Production build
npm run typecheck   # TypeScript type check (no emit)
npm run check       # Typecheck + lint
npm run lint        # ESLint
npm run dev         # Development server
```

## Permission Model

| Action | Owner | Admin | Member | Viewer |
|---|---|---|---|---|
| View agent registry | ✅ | ✅ | ✅ | ✅ |
| Health check | ✅ | ✅ | ✅ | ✅ |
| View logs | ✅ | ✅ | ✅ | ✅ |
| Read config files | ✅ | ✅ | ✅ | ✅ |
| Edit config files | ✅ | ✅ | ❌ | ❌ |
| Restart agents | ✅ | ✅ | ❌ | ❌ |
| Reload agents | ✅ | ✅ | ❌ | ❌ |

Owner emails are set via `CONTROL_PLANE_OWNERS` in `.env.local`.

## Security Notes

- Restart/reload routes use a hardcoded agent ID allowlist — arbitrary container names cannot be passed.
- Config write paths are validated against `AGENT_CONFIG_DIR` to prevent path traversal.
- Only `.md`, `.json`, `.yaml`, `.yml`, `.txt` extensions are readable/writable.
- Backups are created in `.backups/` before every overwrite.
- No API keys or secrets are ever sent to the client.
- The `CONTROL_PLANE_OWNERS` env var determines who can perform destructive actions.
