import { Suspense } from "react";
import { ChatSurface } from "@/modules/chat/components/surface/ChatSurface";

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatSurface />
    </Suspense>
  );
}
