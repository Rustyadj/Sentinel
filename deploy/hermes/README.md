# Lisa messaging through Sentinel

Install `sentinel-channel/` into Lisa's `$HERMES_HOME/plugins/` and enable
`sentinel-channel` in `plugins.enabled`. Restart the gateway after installation.
The plugin requires the gateway's `pre_gateway_dispatch` hook (Hermes 0.21+).

Configure the Sentinel app with `HERMES_CHANNEL_SECRET` (a random transport
credential) and `HERMES_CHANNEL_USERS` (JSON: platform → sender ID → Sentinel user
ID). Only explicitly bound senders can execute work, and their current runtime
workspace permissions are checked on every request. Do not bind a public channel
or an arbitrary sender to an administrator. The credential authenticates this
gateway only; it cannot select another agent or user in the request body.

Set `SYSTEM_ONE_MODE_HERMES_LISA=active` to enable Lisa's existing Jev layer.
The channel entry point awaits the typed Jev decision before starting Lisa and
records both decision and actual execution. Jev does not generate Lisa's prose;
the configured Lisa conversational model still does. Existing Jev timeout and
circuit breaker behavior applies: an unavailable classifier falls back to Lisa
inside Sentinel. A Sentinel outage never starts a separate local chat turn.

Write `$HERMES_HOME/sentinel-channel.json` with permissions `0600`, owned by the
gateway user, containing `url` (the reachable Sentinel `/api/chat/channel`
endpoint) and `secret` (the matching transport credential). Keep this file out
of source control and backups intended for distribution.

Messaging channels keep separate Sentinel rooms by agent, bound user, platform,
sender, chat, and topic. The runtime session, transcript and learning capture
use the existing Sentinel runtime chat path. The plugin handles attachments
using Hermes's existing inbound preprocessing and outbound media delivery.

`/stop`, `/new` and `/reset` address the Sentinel conversation. Native maintenance
commands (`/pause`, `/resume`, `/status`, `/restart`, `/approve`, `/deny`, `/help`)
stay in the gateway. Other messages and skill shortcuts go through Sentinel.
The gateway's authorization, pause and bot-loop checks remain in force.

Redis serializes channel turns and caches completed message replies for 24 hours.
An execution receipt prevents an uncertain delivery retry from running work
twice. A gateway SQLite receipt suppresses duplicate outbound replies. After an
uncertain failure, inspect the Sentinel room before deliberately resubmitting a
new message. The private endpoint does not accept browser session credentials.
