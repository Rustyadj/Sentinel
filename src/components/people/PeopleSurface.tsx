"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { EmptyState } from "@/components/shell/primitives";
import { ROLE_COPY, type OrgRole } from "@/lib/people/roles";
import type { Me } from "@/lib/people/useMe";
import { cn } from "@/lib/utils";
import { InviteForm } from "./InviteForm";
import { Initial, Notice, QuietButton, fieldClass, formatDate, readError } from "./ui";

interface Member { userId: string; name: string | null; email: string | null; role: OrgRole; joinedAt: string }
interface Invitation {
  id: string; scope: "organization" | "project"; role: string; email: string | null; state: "pending" | "accepted" | "revoked" | "expired";
  project: { id: string; name: string } | null; createdAt: string; expiresAt: string; invitedBy: string; acceptedBy: string | null;
}
interface People { me: Me; organization: { id: string; name: string } | null; members: Member[]; invitations: Invitation[] }

const STATE_COPY: Record<Invitation["state"], string> = { pending: "Waiting", accepted: "Accepted", revoked: "Withdrawn", expired: "Expired" };

/** Who is on the team, what each person can do, and the invitations that are out. */
export function PeopleSurface() {
  const [data, setData] = useState<People | null>(null);
  const [allProjects, setAllProjects] = useState<Array<{ id: string; name: string; userId: string }>>([]);
  const [error, setError] = useState("");
  const [working, setWorking] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/people", { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res, "The team could not be loaded."));
      setData((await res.json()) as People);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The team could not be loaded.");
    }
  }, []);

  useEffect(() => {
    // Loading on mount: every setState in here runs after an await, never during the effect itself.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    fetch("/api/projects", { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as { projects: Array<{ id: string; name: string; userId: string }> }).projects : []))
      .then((rows) => setAllProjects(rows.map((p) => ({ id: p.id, name: p.name, userId: p.userId }))))
      .catch(() => undefined);
  }, [load]);

  async function act(key: string, request: () => Promise<Response>, failure: string) {
    setWorking(key); setError("");
    try {
      const res = await request();
      if (!res.ok) throw new Error(await readError(res, failure));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : failure);
    } finally {
      setWorking(null);
    }
  }

  const me = data?.me;
  // Projects this person may share: any of them for a people manager, otherwise only their own.
  const projects = allProjects.filter((p) => me?.canManage || p.userId === me?.id);
  const pending = data?.invitations.filter((i) => i.state === "pending") ?? [];
  const settled = data?.invitations.filter((i) => i.state !== "pending") ?? [];

  return (
    <AppShell title="People">
      <div className="h-full overflow-y-auto">
        <div className="mx-auto grid w-full max-w-[1180px] gap-8 px-4 py-6 sm:px-8 sm:py-8 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="min-w-0 space-y-10">
            <header>
              <h2 className="font-display text-[30px] font-semibold leading-tight tracking-tight">{data?.organization?.name ?? "Your team"}</h2>
              <p className="mt-2 max-w-[60ch] text-[14px] leading-relaxed text-(--muted-foreground)">
                People on the team share its workspaces. People invited to a single project see that project and nothing else.
              </p>
            </header>

            {error ? <Notice>{error}</Notice> : null}

            <section aria-labelledby="members-heading">
              <h3 id="members-heading" className="mb-3 font-display text-[18px] font-semibold tracking-tight">
                On the team{data ? <span className="ml-2 font-sans text-[13px] font-normal text-(--muted-foreground)">{data.members.length}</span> : null}
              </h3>
              {!data ? (
                <div className="space-y-2" aria-label="Loading the team">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-(--radius-md) bg-(--panel) motion-reduce:animate-none" />)}</div>
              ) : (
                <ul className="divide-y divide-(--border) overflow-hidden rounded-(--radius-lg) border border-(--border) bg-(--panel)">
                  {data.members.map((member) => {
                    const self = member.userId === me?.id;
                    const editable = Boolean(me?.canManage) && !self && member.role !== "owner";
                    return (
                      <li key={member.userId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
                        <Initial name={member.name ?? member.email} />
                        <div className="min-w-0 flex-1 basis-40">
                          <p className="truncate text-[14.5px] font-semibold">{member.name ?? member.email ?? "Member"}{self ? <span className="ml-2 text-[12px] font-normal text-(--muted-foreground)">you</span> : null}</p>
                          <p className="truncate text-[12.5px] text-(--muted-foreground)">{member.email ?? `Joined ${formatDate(member.joinedAt)}`}</p>
                        </div>
                        {editable ? (
                          <>
                            <select
                              aria-label={`Role for ${member.name ?? member.email ?? "member"}`}
                              value={member.role}
                              disabled={working === member.userId}
                              onChange={(e) => void act(member.userId, () => fetch(`/api/people/${member.userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: e.target.value }) }), "The role was not changed.")}
                              className={cn(fieldClass, "h-9 w-[8.5rem]")}
                            >
                              {(["member", "operator", "admin"] as const).map((r) => <option key={r} value={r}>{ROLE_COPY[r].label}</option>)}
                            </select>
                            <QuietButton
                              danger
                              disabled={working === member.userId}
                              onClick={() => { if (window.confirm(`Remove ${member.name ?? member.email ?? "this person"} from the team? They keep any projects they were added to.`)) void act(member.userId, () => fetch(`/api/people/${member.userId}`, { method: "DELETE" }), "They were not removed."); }}
                            >
                              Remove
                            </QuietButton>
                          </>
                        ) : (
                          <span className="rounded-full border border-(--border) px-3 py-1 text-[12.5px] text-(--muted-foreground)" title={ROLE_COPY[member.role].grants}>{ROLE_COPY[member.role].label}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section aria-labelledby="invites-heading">
              <h3 id="invites-heading" className="mb-3 font-display text-[18px] font-semibold tracking-tight">Invitations</h3>
              {data && data.invitations.length === 0 ? (
                <div className="rounded-(--radius-lg) border border-dashed border-(--border-strong)">
                  <EmptyState title="No invitations yet" hint="Make a link and send it to someone. It appears here until they use it." />
                </div>
              ) : (
                <ul className="divide-y divide-(--border) overflow-hidden rounded-(--radius-lg) border border-(--border) bg-(--panel)">
                  {[...pending, ...settled.slice(0, 12)].map((invite) => (
                    <li key={invite.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3">
                      <div className="min-w-0 flex-1 basis-56">
                        <p className="truncate text-[14px] font-medium">
                          {ROLE_COPY[invite.role as keyof typeof ROLE_COPY]?.label ?? invite.role}
                          <span className="font-normal text-(--muted-foreground)"> on {invite.scope === "project" ? invite.project?.name ?? "a project" : "the team"}</span>
                        </p>
                        <p className="truncate text-[12.5px] text-(--muted-foreground)">
                          {invite.state === "accepted" ? `Used by ${invite.acceptedBy ?? "someone"}` : invite.email ? `For ${invite.email}` : "Anyone with the link"}
                          {`, from ${invite.invitedBy}`}
                        </p>
                      </div>
                      <span className={cn("text-[12.5px]", invite.state === "pending" ? "text-(--primary)" : invite.state === "accepted" ? "text-(--status-online)" : "text-(--text-faint)")}>
                        {STATE_COPY[invite.state]}{invite.state === "pending" ? ` until ${formatDate(invite.expiresAt)}` : ""}
                      </span>
                      {invite.state === "pending" ? (
                        <QuietButton disabled={working === invite.id} onClick={() => void act(invite.id, () => fetch(`/api/invitations/${invite.id}`, { method: "DELETE" }), "The invitation was not withdrawn.")}>Withdraw</QuietButton>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <aside aria-labelledby="invite-heading" className="h-fit rounded-(--radius-lg) border border-(--border) bg-(--panel) p-5 xl:sticky xl:top-6">
            <h3 id="invite-heading" className="mb-4 font-display text-[19px] font-semibold tracking-tight">Invite someone</h3>
            {!me ? <div className="h-40 animate-pulse rounded-(--radius-md) bg-(--muted) motion-reduce:animate-none" /> : (
              <InviteForm scopes={me.canManage ? ["organization", "project"] : ["project"]} projects={projects} onCreated={() => void load()} />
            )}
            {me && !me.canManage ? <p className="mt-4 text-[12.5px] leading-snug text-(--muted-foreground)">You can invite people to your own projects. Owners and admins invite people to the team.</p> : null}
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
