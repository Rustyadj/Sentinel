"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, FolderKanban } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Brand, ContentProject, ProjectTask } from "../types";

const TASK_STATUSES = ["backlog", "in_progress", "review", "done"] as const;

function TaskList({ project }: { project: ContentProject }) {
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [title, setTitle] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`/api/creator-studio/projects/${project.id}/tasks`)
      .then((r) => r.json())
      .then((data: ProjectTask[]) => setTasks(data))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [project.id]);

  async function addTask() {
    if (!title.trim()) return;
    const res = await fetch(`/api/creator-studio/projects/${project.id}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
    if (res.ok) {
      const task = (await res.json()) as ProjectTask;
      setTasks((prev) => [task, ...prev]);
      setTitle("");
    }
  }

  async function updateStatus(taskId: string, status: string) {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status } : t)));
    await fetch(`/api/creator-studio/projects/${project.id}/tasks/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }

  async function deleteTask(taskId: string) {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    await fetch(`/api/creator-studio/projects/${project.id}/tasks/${taskId}`, { method: "DELETE" });
  }

  return (
    <div className="mt-4">
      <div className="text-[10px] uppercase tracking-widest text-[--muted-foreground] mb-2">Tasks</div>
      <div className="flex items-center gap-2 mb-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTask()}
          placeholder="New task…"
          className="flex-1 h-8 rounded-md border border-[--border] bg-[--muted] px-2.5 text-xs text-[--foreground] placeholder:text-[--muted-foreground] outline-none focus:border-[--primary]/50"
        />
        <button
          onClick={addTask}
          disabled={!title.trim()}
          className="h-8 px-2.5 rounded-md bg-[--primary] text-[--primary-foreground] text-xs font-medium disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      {loaded && tasks.length === 0 ? (
        <p className="text-xs text-[--muted-foreground]">No tasks yet.</p>
      ) : (
        <div className="space-y-1.5">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center gap-2 rounded-md border border-[--border] bg-[--muted] px-2.5 py-1.5"
            >
              <span className="flex-1 text-xs text-[--foreground] truncate">{task.title}</span>
              <select
                value={task.status}
                onChange={(e) => updateStatus(task.id, e.target.value)}
                className="h-6 rounded border border-[--border] bg-[--card] px-1.5 text-[10px] text-[--foreground]"
              >
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ")}
                  </option>
                ))}
              </select>
              <button onClick={() => deleteTask(task.id)} className="text-[--muted-foreground] hover:text-[--destructive]">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProjectsView({ activeBrand }: { activeBrand: Brand | null }) {
  const [projects, setProjects] = useState<ContentProject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    if (!activeBrand) return;
    fetch(`/api/creator-studio/projects?brandId=${activeBrand.id}`)
      .then((r) => r.json())
      .then((data: ContentProject[]) => setProjects(data))
      .catch(() => {});
  }, [activeBrand]);

  async function createProject() {
    if (!activeBrand || !name.trim()) return;
    const res = await fetch("/api/creator-studio/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandId: activeBrand.id, name: name.trim() }),
    });
    if (res.ok) {
      const project = (await res.json()) as ContentProject;
      setProjects((prev) => [project, ...prev]);
      setName("");
      setSelectedId(project.id);
    }
  }

  async function deleteProject(id: string) {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    if (selectedId === id) setSelectedId(null);
    await fetch(`/api/creator-studio/projects/${id}`, { method: "DELETE" });
  }

  if (!activeBrand) {
    return (
      <div className="p-8 max-w-2xl">
        <h1 className="text-lg font-semibold text-[--foreground] mb-2">Projects</h1>
        <p className="text-sm text-[--muted-foreground]">Select a brand to see its projects.</p>
      </div>
    );
  }

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-1">Projects</h1>
      <p className="text-sm text-[--muted-foreground] mb-6">
        Every piece of content for {activeBrand.name} lives inside a project.
      </p>

      <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-6">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createProject()}
              placeholder="New project name…"
              className="flex-1 h-9 rounded-lg border border-[--border] bg-[--muted] px-3 text-sm text-[--foreground] placeholder:text-[--muted-foreground] outline-none focus:border-[--primary]/50"
            />
            <button
              onClick={createProject}
              disabled={!name.trim()}
              className="h-9 px-3 rounded-lg bg-[--primary] text-[--primary-foreground] text-sm font-medium disabled:opacity-40 flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {projects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[--border] py-10 text-center text-sm text-[--muted-foreground]">
              No projects yet.
            </div>
          ) : (
            <div className="space-y-1.5">
              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => setSelectedId(project.id)}
                  className={cn(
                    "w-full flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors",
                    project.id === selectedId
                      ? "border-[--primary]/40 bg-[--primary]/5"
                      : "border-[--border] bg-[--card] hover:border-[--primary]/20"
                  )}
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <FolderKanban className="w-3.5 h-3.5 text-[--muted-foreground] shrink-0" />
                    <span className="text-sm text-[--foreground] truncate">{project.name}</span>
                  </div>
                  <span className="text-[10px] text-[--muted-foreground] shrink-0">
                    {project._count?.items ?? 0} items
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[--border] bg-[--card] p-4">
          {!selected ? (
            <p className="text-sm text-[--muted-foreground]">Select a project to see its tasks.</p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-[--foreground]">{selected.name}</div>
                  {selected.description && (
                    <p className="text-xs text-[--muted-foreground] mt-1">{selected.description}</p>
                  )}
                </div>
                <button
                  onClick={() => deleteProject(selected.id)}
                  className="text-[--muted-foreground] hover:text-[--destructive] shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <TaskList project={selected} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
