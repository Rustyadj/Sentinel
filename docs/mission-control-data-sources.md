# Mission Control data sources

Mission Control is designed as a read-oriented operational aggregation layer. It uses existing APIs when they are available and fills unsupported surfaces through the typed `MissionControlService` adapter.

## Existing live sources

| Surface | API | Current use |
| --- | --- | --- |
| Agents | `/api/agents` | Names, roles, model, and base status |
| Projects | `/api/projects` | Recent project resume rows |
| Conversations | `/api/rooms` | Recent conversation resume rows |
| Tasks | `/api/tasks` | Blocked and failed work in the activity layer |
| Core health | `/api/health` | PostgreSQL reachability and freshness |
| Knowledge graph | `/api/graph` | Context-filtered Neural Space preview |
| Knowledge events | `/api/knowledge/events` | Operational feed events |
| Voice conversations | `/api/rooms`, `/api/chat` | Voice Orb routes completed transcripts through the same room and agent engine as Chat |

## Missing or incomplete sources

- Unified approvals and attention queue API with owner, severity, source, timestamps, and action permissions.
- Deployment/build job API covering CI failures, releases, containers, and rollback state.
- VPS telemetry API for CPU, memory, disk, network, PostgreSQL, Redis, and container utilization.
- Agent run telemetry for current task, progress, voice state, CPU/memory, runtime, and daily cost.
- Organization-wide operational event stream normalized across agents, projects, workspaces, system, and organization.
- Knowledge-candidate listing API. The existing candidate route supports accept/reject mutations but not a queue read.
- Durable Mission Control action API for approve/reject/open workflows. Current unsupported actions are optimistic UI interactions only.
- Files/recent-artifacts API for the Continue Work file tab.
- Token and API usage aggregation with budget and model/provider breakdown.
- Persisted context selection for organization, workspace, project, agent team, and knowledge scope. The contextual strip currently maintains client-side selection state.
- Production speech-to-text and text-to-speech credentials. The Voice Orb is provider-abstracted and falls back to the local mock provider when no configured browser-capable provider is available.

## Replacement path

`src/lib/mission-control/service.ts` is the only UI-facing integration boundary. Replace individual fallback mappers as live endpoints become available; presentation components consume only the types in `src/lib/mission-control/types.ts`.
