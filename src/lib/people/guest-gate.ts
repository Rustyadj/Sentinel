// What a project guest's session may reach at all. This is a second fence,
// not the first: every route still does its own permission check, and a guest
// holds no workspace role for those checks to pass. The fence exists because
// Sentinel has many routes written when every account was a trusted member,
// and one that scopes by "is signed in" alone should not become a guest's view
// into the team.
//
// Deliberately free of imports so the proxy can load it anywhere.

const GUEST_PAGES = ["/projects", "/chat", "/roundtable", "/auth"];

/** [path prefix, methods]. "*" allows every method; the route's own checks decide the rest. */
const GUEST_API: Array<[string, readonly string[] | "*"]> = [
  ["/api/projects", "*"],
  ["/api/discussions", "*"],
  ["/api/invitations/accept", ["POST"]],
  ["/api/people", ["GET"]],
  ["/api/collaboration", "*"],
  ["/api/tasks", "*"],
  ["/api/documents", "*"],
  ["/api/graph/scoped", ["GET"]],
  ["/api/orrery", ["GET"]],
  ["/api/notifications", ["GET"]],
  ["/api/workspaces", ["GET"]],
];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

export function guestMayReach(pathname: string, method: string): boolean {
  if (pathname === "/") return true; // redirects to chat
  if (!pathname.startsWith("/api/")) return GUEST_PAGES.some((prefix) => under(pathname, prefix));
  const verb = method.toUpperCase();
  return GUEST_API.some(([prefix, methods]) => under(pathname, prefix) && (methods === "*" || methods.includes(verb)));
}

/** Where a guest is sent when they follow a link to somewhere they cannot go. */
export const GUEST_HOME = "/projects";
