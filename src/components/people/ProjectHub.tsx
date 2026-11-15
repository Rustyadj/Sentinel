"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MessageSquare, MessagesSquare, Plus } from "lucide-react";
import { ROLE_COPY } from "@/lib/people/roles";
import { cn } from "@/lib/utils";
import { InviteForm } from "./InviteForm";
import { ProjectAgents } from "./ProjectAgents";
import { Initial, Notice, QuietButton, fieldClass, readError } from "./ui";

interface Person { id: string; name: string; email: string | null }
interface Members { canShare: boolean; owner: Person; members: Array<{ id: string; role: "editor" | "viewer"; user: Person }> }
interface Room { id: string; name: string; projectId: string | null; _count: { messages: number } }
interface Talk { id: string; title: string; status: string; projectId: string | null }

/** A project as a place: who is on it, the rooms they talk in, and the roundtables held for it. */
export function ProjectHub({ project, canWrite }: { project: { id: string; name: string }; canWrite: boolean }) {
  const [people, setPeople] = useState<Members | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [talks, setTalks] = useState<Talk[]>([]);
  const [roomName, setRoomName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const loadPeople = useCallback(async () => {
    const res = await fetch(`/api/projects/${project.id}/members`, { cache: "no-store" });
    if (res.ok) setPeople((await res.json()) as Members); else setError(await readError(res, "The people on this project could not be loaded."));
  }, [project.id]);
  const loadRooms = useCallback(async () => {
    const res = await fetch("/api/rooms", { cache: "no-store" });
    if (res.ok) setRooms(((await res.json()) as Room[]).filter((room) => room.projectId === project.id));
  }, [project.id]);

  useEffect(() => {
    // Loading on mount: every setState in here runs after an await, never during the effect itself.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPeople();
    void loadRooms();
    fetch("/api/discussions", { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as { discussions: Talk[] }).discussions : []))
      .then((rows) => setTalks(rows.filter((row) => row.projectId === project.id)))
      .catch(() => undefined);
  }, [loadPeople, loadRooms, project.id]);

  async function change(key: string, request: () => Promise<Response>, failure: string, after: () => Promise<void>) {
    setBusy(key); setError("");
    try {
      const res = await request();
      if (!res.ok) throw new Error(await readError(res, failure));
      await after();
    } catch (e) {
      setError(e instanceof Error ? e.message : failure);
    } finally {
      setBusy("");
    }
  }

  const createRoom = () => change("room", () => fetch("/api/rooms", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: roomName.trim(), projectId: project.id }),
  }), "The room was not created.", async () => { setRoomName(""); await loadRooms(); });

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 space-y-10">
        {error ? <Notice>{error}</Notice> : null}

        <section aria-labelledby="rooms-heading">
          <h2 id="rooms-heading" className="mb-3 font-display text-[18px] font-semibold tracking-tight">Rooms</h2>
          <ul className="divide-y divide-(--border) overflow-hidden rounded-(--radius-lg) border border-(--border) bg-(--panel)">
            {rooms === null ? <li className="h-14 animate-pulse bg-(--panel) motion-reduce:animate-none" /> : null}
            {rooms?.length === 0 ? <li className="px-4 py-5 text-[13.5px] text-(--muted-foreground)">No rooms yet. A room is where the people on this project, and its agents, talk.</li> : null}
            {rooms?.map((room) => (
              <li key={room.id}>
                <Link href={`/chat?room=${room.id}`} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-(--muted) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--ring)">
                  <MessageSquare aria-hidden className="h-4 w-4 shrink-0 text-(--entity-project)" />
                  <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium">{room.name}</span>
                  <span className="text-[12.5px] text-(--muted-foreground)">{room._count.messages} {room._count.messages === 1 ? "message" : "messages"}</span>
                </Link>
              </li>
            ))}
          </ul>
          {canWrite ? (
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (roomName.trim()) void createRoom(); }}>
              <input value={roomName} onChange={(e) => setRoomName(e.target.value)} aria-label="New room name" placeholder="Name a new room" maxLength={80} className={cn(fieldClass, "max-w-xs")} />
              <QuietButton type="submit" className="h-10" disabled={!roomName.trim() || busy === "room"}><Plus className="h-4 w-4" /> Open room</QuietButton>
            </form>
          ) : null}
        </section>

        <section aria-labelledby="talks-heading">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="talks-heading" className="font-display text-[18px] font-semibold tracking-tight">Roundtables</h2>
            <Link href="/roundtable" className="text-[13px] text-(--primary-soft) underline-offset-2 hover:underline">Start one</Link>
          </div>
          <ul className="divide-y divide-(--border) overflow-hidden rounded-(--radius-lg) border border-(--border) bg-(--panel)">
            {talks.length === 0 ? <li className="px-4 py-5 text-[13.5px] text-(--muted-foreground)">None shared with this project yet. Share one when you start it and everyone here can read it and speak in it.</li> : null}
            {talks.map((talk) => (
              <li key={talk.id}>
                <Link href={`/roundtable?id=${talk.id}`} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-(--muted) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--ring)">
                  <MessagesSquare aria-hidden className="h-4 w-4 shrink-0 text-(--entity-agent)" />
                  <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium">{talk.title}</span>
                  <span className={cn("text-[12.5px]", talk.status === "running" ? "text-(--primary)" : "text-(--muted-foreground)")}>{talk.status === "running" ? "In progress" : "Finished"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <ProjectAgents projectId={project.id} canWrite={canWrite} />

        <section aria-labelledby="project-people-heading">
          <h2 id="project-people-heading" className="mb-3 font-display text-[18px] font-semibold tracking-tight">People on this project</h2>
          {!people ? <div className="h-16 animate-pulse rounded-(--radius-md) bg-(--panel) motion-reduce:animate-none" /> : (
            <ul className="divide-y divide-(--border) overflow-hidden rounded-(--radius-lg) border border-(--border) bg-(--panel)">
              <li className="flex items-center gap-3 px-4 py-3.5">
                <Initial name={people.owner.name} />
                <div className="min-w-0 flex-1"><p className="truncate text-[14.5px] font-semibold">{people.owner.name}</p>{people.owner.email ? <p className="truncate text-[12.5px] text-(--muted-foreground)">{people.owner.email}</p> : null}</div>
                <span className="rounded-full border border-(--border) px-3 py-1 text-[12.5px] text-(--muted-foreground)">Owner</span>
              </li>
              {people.members.map((member) => (
                <li key={member.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5">
                  <Initial name={member.user.name} />
                  <div className="min-w-0 flex-1 basis-40"><p className="truncate text-[14.5px] font-semibold">{member.user.name}</p>{member.user.email ? <p className="truncate text-[12.5px] text-(--muted-foreground)">{member.user.email}</p> : null}</div>
                  {people.canShare ? (
                    <>
                      <select
                        aria-label={`Role for ${member.user.name}`} value={member.role} disabled={busy === member.id} className={cn(fieldClass, "h-9 w-[7.5rem]")}
                        onChange={(e) => void change(member.id, () => fetch(`/api/projects/${project.id}/members`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId: member.id, role: e.target.value }) }), "The role was not changed.", loadPeople)}
                      >
                        <option value="editor">Editor</option><option value="viewer">Viewer</option>
                      </select>
                      <QuietButton danger disabled={busy === member.id} onClick={() => { if (window.confirm(`Take ${member.user.name} off ${project.name}?`)) void change(member.id, () => fetch(`/api/projects/${project.id}/members?memberId=${member.id}`, { method: "DELETE" }), "They were not removed.", loadPeople); }}>Remove</QuietButton>
                    </>
                  ) : <span className="rounded-full border border-(--border) px-3 py-1 text-[12.5px] text-(--muted-foreground)" title={ROLE_COPY[member.role].grants}>{ROLE_COPY[member.role].label}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {people?.canShare ? (
        <aside aria-labelledby="project-invite-heading" className="h-fit rounded-(--radius-lg) border border-(--border) bg-(--panel) p-5 xl:sticky xl:top-6">
          <h2 id="project-invite-heading" className="mb-1 font-display text-[19px] font-semibold tracking-tight">Invite to {project.name}</h2>
          <p className="mb-4 text-[13px] leading-snug text-(--muted-foreground)">They will see this project, its rooms and its roundtables. Nothing else in Sentinel.</p>
          <InviteForm scopes={["project"]} project={project} />
        </aside>
      ) : null}
    </div>
  );
}

