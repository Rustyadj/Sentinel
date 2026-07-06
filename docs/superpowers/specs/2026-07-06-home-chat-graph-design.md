# Home Page Redesign — Chat + Live Knowledge Graph

**Date:** 2026-07-06
**Status:** Implemented (autonomous session; revise on request)

## Goal

Replace the "Mission Control" stat dashboard at `/` with the product's core loop:
converse with an agent while the knowledge graph grows live beside the
conversation. Clean, minimalist, professional. The old dashboard remains at
`/dashboard`; the full multi-room chat remains at `/chat`.

## Direction

- **Subject:** Sentinel OS is an agent operating system whose memory is a
  graph. The home page's single job: talk to the system and watch it think.
- **Signature element:** the live graph pane. While a response streams,
  particles flow along edges and the graph refetches when the stream ends —
  the graph visibly "thinks" with the chat. New nodes pulse for a few seconds.
- **Restraint everywhere else:** one accent (indigo `#6366f1`), existing
  graphite token system, no stat cards, no gradients on content surfaces.
  Micro-labels in uppercase mono carry structure.

## Layout

```
┌ Rail ┬──────────────────────────────┬────────────────────────┐
│      │ TopBar                                                │
│      ├──────────────────────────────┬────────────────────────┤
│      │  Chat column (flex-1)        │  Live graph (~44%)     │
│      │  centered, max-w-2xl         │  full-height canvas    │
│      │  greeting / messages         │  status chip · legend  │
│      │  composer pinned bottom      │  node card on click    │
└──────┴──────────────────────────────┴────────────────────────┘
```

Below `lg` the panes become a Chat/Graph tab switcher.

## Components

- `src/components/home/HomeChat.tsx` — sessionless chat against `/api/chat`
  (SSE), agent selector from `AGENT_TEMPLATES`, markdown rendering, suggestion
  chips on empty state. Emits `onStreamingChange` / `onStreamEnd`.
- `src/components/home/LiveKnowledgeGraph.tsx` — ForceGraph2D over
  `/api/graph`: muted per-type palette, hover dims non-neighbors, click opens
  a compact node card, link particles while streaming, new-node pulse,
  zoom-to-fit on first load, 8s poll + refetch after each stream. Respects
  `prefers-reduced-motion` (no particles/pulse).
- `src/app/page.tsx` — composes both inside `AppShell`, owns the
  streaming/refresh wiring and the mobile tab state.

## Alternatives considered

1. Graph as full-bleed background with floating glass chat — rejected:
   legibility suffers, reads as demo-ware, not professional.
2. Reuse `KnowledgeGraphPanel` as-is — rejected: it's built as a closable
   side panel with filter chrome; home needs a quieter, self-standing pane
   with different interaction (hover neighborhoods, pulse, particles).

## Error handling

- `/api/graph` failures → keep last data; empty DB → calm empty state.
- Chat stream errors render inline in the failed message, composer stays live.
