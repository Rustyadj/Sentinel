# Sentinel Mobile

A React Native (Expo) companion app for [Sentinel OS](../README.md). This is a
**v1, chat-only** client: it talks to the same backend the web app does, but
only covers the chat surface — rooms, agents, and streamed replies. Nothing
else (the neural graph, workflows, security console, etc.) has a mobile
screen yet.

## How it fits together

This is a separate app with its own toolchain, dependencies, and
`tsconfig.json` — it is **not** part of the Next.js project's build,
typecheck, lint, or test runs (see the root `tsconfig.json` `exclude`,
`eslint.config.mjs` `globalIgnores`, and `vitest.config.ts` `exclude` — all
three explicitly carve out `mobile/`). It talks to the backend purely over
HTTP, the same API routes the web app calls:

- `POST /api/auth/mobile/login` — email/password → a 30-day bearer token
- `GET/POST /api/rooms` — list/create chat rooms
- `GET /api/rooms/:id/messages` — a room's message history
- `POST /api/chat` — send a turn, streamed back as SSE

The web app authenticates with a session cookie; this app can't carry one
the same way, so it authenticates with a bearer token instead (see
`src/lib/mobile-auth.ts` and `requireApiUser` in the backend). Every other
piece of business logic — retrieval, memory, agent routing, persistence — is
the exact same code path the web client hits. There is no parallel mobile
backend.

## Setup

```bash
cd mobile
npm install
cp .env.example .env.local   # sets a default Server URL on the login screen
npx expo start
```

Then press `i` for the iOS Simulator, `a` for an Android emulator, `w` for
web, or scan the QR code with Expo Go on a physical device. The Server URL
on the login screen is editable at runtime regardless of what's in `.env`,
so switching between a local backend and a deployed one doesn't need a
rebuild.

**Pointing at a local Sentinel backend**, from `npm run dev` in the repo
root:

| Where the app runs      | Server URL                       |
| ------------------------ | --------------------------------- |
| iOS Simulator             | `http://localhost:3000`           |
| Android Emulator          | `http://10.0.2.2:3000` (the emulator's alias for the host machine — `localhost` there means the emulator itself) |
| Physical device           | `http://<your-machine's-LAN-IP>:3000` |
| A deployed instance        | `https://sentinel.example.com`     |

## Signing in

Email/password only — the same `Credentials` provider the web app's
sign-in form uses, so an account works identically on both surfaces.
**Google and GitHub accounts can't sign in here yet**: they have no
password hash to check against, and there's no mobile OAuth flow. Set a
password for the account on the web app first (or register directly) if
you only have an OAuth login today.

## What's here

```
src/
  app/
    _layout.tsx        Root Stack + auth gating (Stack.Protected)
    index.tsx           Routes to /login or /rooms depending on session
    login.tsx            Server URL + email/password
    rooms/
      index.tsx           Room list, pull-to-refresh, new-room modal
      [id].tsx             Chat: history, agent picker, streamed send
  lib/
    api.ts               All network calls; SSE reading for chat replies
    auth-context.tsx      Session state, persisted via secure-storage
    secure-storage.ts      expo-secure-store wrapper (Keychain/Keystore)
    agents.ts              Mirrors AGENT_TEMPLATES' display fields from the web app
    types.ts                Wire types shared with the API contract
    theme.ts                 Sentinel's dark palette (see the repo's DESIGN.md) — no light mode; Sentinel is dark-first by design
```

Streaming a reply needs a body the client can read incrementally.
React Native's built-in `fetch` doesn't expose that; `expo/fetch` (native
networking under the hood) does, so it's used for that one call — see the
comment at the top of `src/lib/api.ts`.

## Known gaps (v1)

- **Credentials login only** — no Google/GitHub sign-in.
- **No token refresh** — the 30-day token expires and the app just prompts
  for sign-in again; there's no silent-refresh flow.
- **No push notifications** — a reply only shows up while the app is open on
  that room.
- **No offline queue** — a send while offline fails; it isn't queued and
  retried.
- **Chat only** — everything else in Sentinel OS (the graph, workflows,
  cybersecurity console, memory, learning) has no mobile screen.
- **App icon/splash are still Expo's defaults** — no Sentinel-branded asset
  has been generated yet.

None of these are silent — each is either a visible limit (a screen you'd
notice is missing) or called out here explicitly.
