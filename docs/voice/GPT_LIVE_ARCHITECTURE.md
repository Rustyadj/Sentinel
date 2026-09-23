# GPT-Live-1 voice — the live layer is a mouth, not a mind

Sentinel runs two separate voice paths. This one is the OpenAI live path used
by Hermes Lisa and Hermes Nathan2. The LiveKit path is a different transport
with its own worker — see [LIVEKIT_ARCHITECTURE.md](LIVEKIT_ARCHITECTURE.md).

## The split

GPT-Live-1 carries audio. It does not think.

```
user speaks
  → GPT-Live-1        transcribe, detect turn, acknowledge
  → sentinel_reasoning tool call
      → POST /api/voice/reasoning
          → routeRuntimeChat()      ← the same call a typed message makes
              → agent's own runtime, memory, MCP tools, permissions, audit
      ← answer
  → GPT-Live-1        speaks the answer
```

The live model is given exactly one tool, `sentinel_reasoning`, and
instructions saying it is "the live voice of this agent, not its mind."
Everything substantive leaves it. That is what makes a spoken turn and a typed
turn the *same* agent: one conversation, one memory, one permission model, one
tool path. No voice-specific memory or tool system exists, by design.

This is a deliberate reversal of the previous design, which had the live model
answer directly and "escalate" to a larger realtime model for hard turns. That
gave two different minds behind one identity, neither of which was the agent's
configured brain, and neither of which could reach its memory or tools.

## Per-agent configuration

`src/lib/voice/agent-voice-config.ts` is the single source of truth. Fields are
the shape an `Agent` row will eventually hold.

| Agent | Voice layer | Voice | Reasoning model |
|---|---|---|---|
| `hermes-lisa` | `gpt-live-1` | `sol` | `deepseek/deepseek-v4.1-flash` (openrouter) |
| `hermes-nathan2` | `gpt-live-1` | `spruce` | `gpt-5.6-luna` (openai) |

Overrides are namespaced per agent — `SENTINEL_VOICE_HERMES_LISA_VOICE` and so
on. There is deliberately **no** global override: one shared variable is what
made every agent speak in the same voice regardless of identity.

## Identity is never inferred

Four places used to silently substitute Lisa when no agent was named. Each is
now a refusal:

- `resolveAgentVoiceConfig(undefined)` → `null`, not Lisa.
- `POST /api/voice/openai/session` with no `agentId` → 400.
- `resolveVoiceWorkerTurn()` on a room with no agents → no turn granted.
- `VoiceControls`' `agentId` prop is **required**, so a surface that forgets is
  a compile error rather than a runtime identity swap.

Both the session and reasoning endpoints also check that the room belongs to
this user **and** to this agent. Ownership alone allowed a session opened as
one agent to read and append to the other's conversation, which is the path by
which their private memory would bleed together.

## No automatic model swapping

`/api/voice/reasoning` takes an agent id and nothing else about models. The
agent's configuration decides which model thinks; a caller cannot request one
agent's voice with another's brain. `fallbackModel` exists for availability
only, never for quality escalation.

## Telemetry

One `voice_session_telemetry` row per session. Live audio minutes and reasoning
tokens are kept apart because they are billed by different vendors at different
rates, and a blended number answers neither "why was voice expensive" nor
"which agent is expensive".

Latency is stored as a sum plus a count plus a separate maximum, so an average
survives incremental updates while the worst turn stays visible — a mean alone
hides the turn that made the conversation feel broken.

`estimatedCostUsd` is **null** when the reasoning model has no rate card entry,
which is currently the case for both agents' models. Reporting `0.0` would read
as "this was free", which is a more damaging answer than "unknown".

## What is not proven

Everything above is covered by unit and route tests (`npx vitest run
src/lib/voice src/app/api/voice`), including both agents' voice/brain pairings
and the cross-agent isolation refusals.

What no test here can establish is behaviour against the live provider: audio
quality, real barge-in timing, and whether `gpt-live-1` and the voice names
`sol` / `spruce` match the provider's current catalogue. `OPENAI_API_KEY` must
be set, and the model and voice ids should be confirmed against the provider
before trusting them in production — voice model catalogues move quickly, and
the ids here are configuration, not verified fact.
