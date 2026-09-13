import { Suspense } from "react";
import { ChatSurface } from "@/modules/chat/components/surface/ChatSurface";

/**
 * Sentinel opens into a conversation. Mission Control is no longer the
 * landing experience — it remains reachable at /dashboard until its
 * remaining pieces are folded into Activity and Agents.
 */
export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <ChatSurface />
    </Suspense>
  );
}
