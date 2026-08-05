import { redirect } from "next/navigation";

// The Knowledge module lives at /memory now — it mounts the canonical
// Neural Lens graph (Knowledge lens) with a real notes panel over it,
// replacing this route's old React Flow-based implementation
// (src/modules/knowledge/components/KnowledgePage.tsx), which was a second,
// disconnected graph system and is retired rather than kept as a duplicate.
export default function ObsidianRedirect() {
  redirect("/memory");
}
