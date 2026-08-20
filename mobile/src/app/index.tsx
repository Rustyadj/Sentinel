import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth-context";

/** Always-registered entry point — decides where launch lands. The actual
 * gate against an unauthenticated deep link into `/rooms/*` is the
 * Stack.Protected setup in _layout.tsx; this is just the initial routing. */
export default function Index() {
  const { session } = useAuth();
  return <Redirect href={session ? "/rooms" : "/login"} />;
}
