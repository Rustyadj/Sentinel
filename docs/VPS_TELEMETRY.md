# VPS telemetry collector

Mission Control never treats application-container process metrics as VPS metrics. Run the read-only collector on the Docker host and connect to it over the private host gateway.

## Contract

`GET /metrics` requires `Authorization: Bearer <SENTINEL_TELEMETRY_TOKEN>`. It returns an observation timestamp, host CPU/memory/disk/network totals, Docker container state and utilization, PostgreSQL/Redis readiness, and any configured agent runtime telemetry. Mission Control marks observations older than two minutes as `stale` and request/configuration failures as `unavailable`.

Agent telemetry endpoints may provide `status`, `currentTask`, `progress`, `runtimeSeconds`, `costToday`, `cpuPercent`, `memoryBytes`, `voiceState`, and `apiUsage` (`requests`, `inputTokens`, `outputTokens`). Missing fields remain unavailable. Configure endpoints as a JSON array in `SENTINEL_AGENT_TELEMETRY`, for example `[ { "id": "agent-id", "url": "http://127.0.0.1:4860/metrics", "token": "..." } ]`.

## Host service

Use a dedicated unprivileged account with permission to run `docker stats` and `docker ps`. Keep port 9464 private to the VPS and require a long random token.

```ini
[Unit]
Description=Sentinel VPS telemetry
After=docker.service network-online.target

[Service]
Type=simple
User=sentinel
WorkingDirectory=/opt/sentinel-os
EnvironmentFile=/etc/sentinel/telemetry.env
ExecStart=/usr/bin/node scripts/vps-telemetry.mjs
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Set the application environment to:

```dotenv
SENTINEL_TELEMETRY_URL=http://host.docker.internal:9464/metrics
SENTINEL_TELEMETRY_TOKEN=<same random token>
```

Verify from inside the app container, then confirm the System Health and AI Workforce cards change from `unavailable` to `live`. Do not expose the endpoint through Traefik or public DNS.
