import { redirect } from "next/navigation";
import { ShieldCheck, Plug, AlertTriangle } from "lucide-react";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { OAuthError } from "@/lib/mcp/errors";
import { resolveAuthorizeRequest } from "@/lib/mcp/oauth";
import { PRE_TICKED_SCOPES, SCOPE_DESCRIPTIONS, formatScopeString, type McpScope } from "@/lib/mcp/scopes";
import { prismaStore } from "@/lib/mcp/store";

/**
 * The consent screen — the single point where a human decides what an external
 * connector may do inside Sentinel.
 *
 * Two deliberate choices. Write scopes are never pre-ticked: read access is
 * the default and creating tasks is an explicit act. And the workspace picker
 * is required, because a grant with no workspace reads nothing — there is no
 * "all workspaces" option to click past.
 */
export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[--background]">
      <div className="absolute inset-0 bg-grid opacity-25" />
      <div className="absolute left-[-10%] top-[-16%] h-[28rem] w-[28rem] rounded-full bg-[rgba(108,124,255,0.18)] blur-3xl" />
      <div className="relative flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-lg">{children}</div>
      </div>
    </div>
  );
}

function Problem({ title, detail }: { title: string; detail: string }) {
  return (
    <Shell>
      <div className="surface-panel rounded-[24px] p-8">
        <div className="flex items-center gap-3 text-amber-400">
          <AlertTriangle className="h-5 w-5" aria-hidden />
          <h1 className="text-lg font-semibold text-[--foreground]">{title}</h1>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-[--muted-foreground]">{detail}</p>
      </div>
    </Shell>
  );
}

export default async function McpAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  };

  const session = await auth();
  if (!session?.user?.id) {
    // Bounce through sign-in and come back to the identical authorize URL, so
    // the client's PKCE challenge and state survive the detour.
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string") query.set(key, value);
    }
    redirect(`/auth/signin?callbackUrl=${encodeURIComponent(`/mcp/authorize?${query.toString()}`)}`);
  }

  const clientId = one("client_id");
  const redirectUri = one("redirect_uri");
  if (!clientId || !redirectUri) {
    return <Problem title="Incomplete authorization request" detail="client_id and redirect_uri are both required." />;
  }

  let resolved;
  try {
    resolved = await resolveAuthorizeRequest(prismaStore(db), {
      clientId,
      redirectUri,
      scope: one("scope"),
      codeChallenge: one("code_challenge"),
      codeChallengeMethod: one("code_challenge_method"),
      state: one("state"),
      resource: one("resource"),
    });
  } catch (error) {
    // Never redirect on these — an invalid client or redirect_uri is exactly
    // when the redirect target must not be trusted.
    return (
      <Problem
        title="This connector can't be authorized"
        detail={error instanceof OAuthError ? error.message : "The authorization request was rejected."}
      />
    );
  }

  const user = await requireUser();
  const workspaces = await db.workspace.findMany({
    where: { OR: [{ ownerId: user.id }, { roleAssignments: { some: { userId: user.id } } }] },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <Shell>
      <form action="/api/mcp/oauth/consent" method="post" className="surface-panel rounded-[24px] p-8">
        <input type="hidden" name="client_id" value={resolved.client.clientId} />
        <input type="hidden" name="redirect_uri" value={resolved.redirectUri} />
        <input type="hidden" name="scope" value={formatScopeString(resolved.scopes)} />
        <input type="hidden" name="code_challenge" value={resolved.codeChallenge} />
        <input type="hidden" name="code_challenge_method" value={resolved.codeChallengeMethod} />
        {resolved.state ? <input type="hidden" name="state" value={resolved.state} /> : null}
        <input type="hidden" name="resource" value={resolved.resource} />

        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgba(108,124,255,0.15)] text-[#8b95ff]">
            <Plug className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-[--foreground]">{resolved.client.name}</h1>
            <p className="text-xs text-[--muted-foreground]">wants to connect to your Sentinel account</p>
          </div>
        </div>

        <fieldset className="mt-7">
          <legend className="text-xs font-medium uppercase tracking-wide text-[--muted-foreground]">Workspace</legend>
          {workspaces.length === 0 ? (
            <p className="mt-2 text-sm text-amber-400">
              You have no workspaces yet. Create one before connecting an external client.
            </p>
          ) : (
            // No pre-selected workspace. This used to default to
            // workspaces[0], which is whatever sorts first alphabetically —
            // a meaningless choice that reads as a recommendation. Every
            // grant ever issued here landed on that first entry because the
            // human clicked Allow without touching the dropdown, and since a
            // grant is bound to its workspace for life, the connector then
            // silently could not see any of the others. An empty default
            // plus `required` makes the browser refuse the form until a
            // workspace is actually chosen.
            <select
              name="workspace_id"
              required
              defaultValue=""
              className="mt-2 w-full rounded-lg border border-[--border] bg-[--card] px-3 py-2 text-sm text-[--foreground]"
            >
              <option value="" disabled>
                Choose a workspace…
              </option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          )}
          <p className="mt-2 text-xs text-[--muted-foreground]">
            This connector will only ever see data in the workspace you pick.
          </p>
        </fieldset>

        <fieldset className="mt-7">
          <legend className="text-xs font-medium uppercase tracking-wide text-[--muted-foreground]">
            Permissions requested
          </legend>
          <ul className="mt-3 space-y-2">
            {resolved.scopes.map((scope: McpScope) => (
              <li key={scope}>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[--border] bg-[--card] px-3 py-2.5 transition-colors hover:border-[#6c7cff]">
                  <input
                    type="checkbox"
                    name="approved_scope"
                    value={scope}
                    defaultChecked={PRE_TICKED_SCOPES.includes(scope)}
                    className="mt-0.5 h-4 w-4 accent-[#6c7cff]"
                  />
                  <span>
                    <span className="block text-sm text-[--foreground]">{SCOPE_DESCRIPTIONS[scope]}</span>
                    <span className="block font-mono text-[11px] text-[--muted-foreground]">{scope}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-[--muted-foreground]">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
          Signed in as {user.email}. You can revoke this connector at any time; revoking takes effect immediately.
        </p>

        <div className="mt-6 flex gap-3">
          <button
            type="submit"
            name="decision"
            value="deny"
            className="flex-1 rounded-lg border border-[--border] px-4 py-2.5 text-sm font-medium text-[--muted-foreground] transition-colors hover:text-[--foreground]"
          >
            Deny
          </button>
          <button
            type="submit"
            name="decision"
            value="approve"
            disabled={workspaces.length === 0}
            className="flex-1 rounded-lg bg-[#6c7cff] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Allow
          </button>
        </div>
      </form>
    </Shell>
  );
}
