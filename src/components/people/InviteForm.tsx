"use client";

import { useState } from "react";
import { Link2 } from "lucide-react";
import { ROLE_COPY } from "@/lib/people/roles";
import { ChoiceCard, CopyField, Field, Notice, PrimaryButton, QuietButton, fieldClass, formatDate, readError } from "./ui";

type Scope = "organization" | "project";

const TEAM_ROLES = ["member", "operator", "admin"] as const;
const PROJECT_ROLES = ["editor", "viewer"] as const;

/**
 * Makes an invitation link. The link is the invitation: there is no email
 * sent from Sentinel, so the person who makes it passes it on themselves.
 * `project` fixes the form to one project; without it the caller picks.
 */
export function InviteForm({ scopes, project, projects = [], onCreated }: {
  scopes: Scope[];
  project?: { id: string; name: string };
  projects?: Array<{ id: string; name: string }>;
  onCreated?: () => void;
}) {
  const [scope, setScope] = useState<Scope>(project ? "project" : scopes[0]);
  const [role, setRole] = useState<string>(project || scopes[0] === "project" ? "editor" : "member");
  const [projectId, setProjectId] = useState(project?.id ?? projects[0]?.id ?? "");
  const [email, setEmail] = useState("");
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);

  const roles = scope === "organization" ? TEAM_ROLES : PROJECT_ROLES;
  const pickScope = (next: Scope) => { setScope(next); setRole(next === "organization" ? "member" : "editor"); };

  async function create() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/invitations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, role, projectId: scope === "project" ? projectId : undefined, email: email.trim() || undefined, expiresInDays: days }),
      });
      if (!res.ok) throw new Error(await readError(res, "The invitation was not created."));
      setLink((await res.json()) as { url: string; expiresAt: string });
      setEmail("");
      onCreated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The invitation was not created.");
    } finally {
      setBusy(false);
    }
  }

  if (link) {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="font-display text-[19px] font-semibold tracking-tight">Invitation link ready</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-(--muted-foreground)">
            Send this to the person yourself. It works once, until {formatDate(link.expiresAt)}. Sentinel keeps no copy of it, so it cannot be shown again after you leave this panel.
          </p>
        </div>
        <CopyField value={link.url} label="Invitation link" icon={Link2} />
        {error ? <Notice>{error}</Notice> : null}
        <QuietButton onClick={() => setLink(null)}>Invite someone else</QuietButton>
      </div>
    );
  }

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void create(); }}>
      {!project && scopes.length > 1 ? (
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium">Invite to</legend>
          <div className="grid grid-cols-2 gap-2">
            <ChoiceCard name="scope" value="organization" checked={scope === "organization"} onChange={() => pickScope("organization")} title="The team" detail="A member of your organization." />
            <ChoiceCard name="scope" value="project" checked={scope === "project"} onChange={() => pickScope("project")} title="One project" detail="A guest who sees only that project." />
          </div>
        </fieldset>
      ) : null}

      {scope === "project" && !project ? (
        projects.length ? (
          <Field label="Project">
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={fieldClass}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        ) : <Notice tone="info">You have no projects to share yet. Create one under Projects first.</Notice>
      ) : null}

      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium">What they can do</legend>
        <div className="space-y-2">
          {roles.map((r) => (
            <ChoiceCard key={r} name="role" value={r} checked={role === r} onChange={setRole} title={ROLE_COPY[r].label} detail={ROLE_COPY[r].grants} />
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-[1fr_9.5rem]">
        <Field label="Their email (optional)" hint="If you fill this in, only that address can use the link.">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="off" className={fieldClass} />
        </Field>
        <Field label="Link lasts">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={fieldClass}>
            <option value={1}>1 day</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
          </select>
        </Field>
      </div>

      {error ? <Notice>{error}</Notice> : null}
      <PrimaryButton type="submit" disabled={busy || (scope === "project" && !projectId)}>
        {busy ? "Creating link…" : "Create invitation link"}
      </PrimaryButton>
    </form>
  );
}
