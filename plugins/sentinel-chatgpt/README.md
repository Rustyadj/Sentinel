# Sentinel ChatGPT integration

Sentinel exposes its authenticated Streamable HTTP MCP endpoint at:

`https://<sentinel-domain>/api/mcp`

Before connecting it, create a public OAuth client in Sentinel while signed in:

`POST /api/integrations/clients`

with a unique `clientId`, the redirect URI supplied by the ChatGPT connection flow, and the minimum required scopes. The authorization server metadata is at `/.well-known/oauth-authorization-server`; protected-resource metadata is at `/.well-known/oauth-protected-resource/mcp`.

The server exposes only curated orchestration tools. It never exposes shell commands, database access, credentials, raw configuration files, or container controls.
