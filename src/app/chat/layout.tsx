import { AppShell } from "@/components/layout/AppShell";

// RightPanel is enabled here (unlike most full-canvas screens) so its Graph
// tab — compact search/filters/selected-node detail, shared via
// useGraphStore with the NeuralLens canvas — is reachable while chatting.
// Users can still dock it away entirely (RightPanel's close button, or the
// chat panel's "expand graph to fullscreen" action) for the immersive view.
export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return <AppShell rightPanel>{children}</AppShell>;
}
