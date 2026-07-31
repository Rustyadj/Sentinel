"use client";

import { useEffect, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight, Plus, CalendarDays, Kanban as KanbanIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CONTENT_ITEM_STATUSES,
  CONTENT_ITEM_STATUS_LABELS,
  type Brand,
  type ContentItem,
  type ContentItemStatus,
} from "../types";

type ViewMode = "calendar" | "kanban";

function ItemCard({
  item,
  onDragStart,
}: {
  item: ContentItem;
  onDragStart: (e: React.DragEvent, item: ContentItem) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, item)}
      className="rounded-md border border-[--border] bg-[--muted] px-2 py-1.5 text-xs text-[--foreground] cursor-grab active:cursor-grabbing truncate"
      title={item.title}
    >
      {item.title}
    </div>
  );
}

export function CalendarView({ activeBrand }: { activeBrand: Brand | null }) {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [mode, setMode] = useState<ViewMode>("calendar");
  const [month, setMonth] = useState(() => new Date());
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (!activeBrand) return;
    fetch(`/api/creator-studio/items?brandId=${activeBrand.id}`)
      .then((r) => r.json())
      .then((data: ContentItem[]) => setItems(data))
      .catch(() => {});
  }, [activeBrand]);

  async function addItem() {
    if (!activeBrand || !title.trim()) return;
    const res = await fetch("/api/creator-studio/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandId: activeBrand.id, title: title.trim() }),
    });
    if (res.ok) {
      const item = (await res.json()) as ContentItem;
      setItems((prev) => [item, ...prev]);
      setTitle("");
    }
  }

  async function updateItem(id: string, patch: Partial<Pick<ContentItem, "status" | "scheduledAt">>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    await fetch(`/api/creator-studio/items/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  function onDragStart(e: React.DragEvent, item: ContentItem) {
    e.dataTransfer.setData("text/plain", item.id);
  }

  function onDropStatus(e: React.DragEvent, status: ContentItemStatus) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (id) updateItem(id, { status });
  }

  function onDropDay(e: React.DragEvent, day: Date) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (id) {
      const scheduled = new Date(day);
      scheduled.setHours(12, 0, 0, 0);
      updateItem(id, { scheduledAt: scheduled.toISOString(), status: "scheduled" });
    }
  }

  if (!activeBrand) {
    return (
      <div className="p-8 max-w-2xl">
        <h1 className="text-lg font-semibold text-[--foreground] mb-2">Content Calendar</h1>
        <p className="text-sm text-[--muted-foreground]">Select a brand to see its calendar.</p>
      </div>
    );
  }

  const unscheduled = items.filter((i) => !i.scheduledAt);

  const gridStart = startOfWeek(startOfMonth(month));
  const gridEnd = endOfWeek(endOfMonth(month));
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-[--foreground]">Content Calendar</h1>
        <div className="flex items-center gap-1 bg-[--muted] rounded-lg p-0.5">
          {(
            [
              ["calendar", CalendarDays, "Calendar"],
              ["kanban", KanbanIcon, "Kanban"],
            ] as const
          ).map(([m, Icon, label]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors",
                mode === m ? "bg-[--card] text-[--foreground] shadow-sm" : "text-[--muted-foreground]"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-[--muted-foreground] mb-4">
        Drag items between {mode === "calendar" ? "days to reschedule" : "columns to change status"}.
      </p>

      <div className="flex items-center gap-2 mb-5">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addItem()}
          placeholder="New content item…"
          className="flex-1 max-w-sm h-9 rounded-lg border border-[--border] bg-[--muted] px-3 text-sm text-[--foreground] placeholder:text-[--muted-foreground] outline-none focus:border-[--primary]/50"
        />
        <button
          onClick={addItem}
          disabled={!title.trim()}
          className="h-9 px-3 rounded-lg bg-[--primary] text-[--primary-foreground] text-sm font-medium disabled:opacity-40 flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>

      {mode === "kanban" ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {CONTENT_ITEM_STATUSES.map((status) => {
            const columnItems = items.filter((i) => i.status === status);
            return (
              <div
                key={status}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => onDropStatus(e, status)}
                className="w-56 shrink-0 rounded-lg border border-[--border] bg-[--card] p-2"
              >
                <div className="flex items-center justify-between px-1 py-1 mb-1.5">
                  <span className="text-xs font-medium text-[--foreground]">
                    {CONTENT_ITEM_STATUS_LABELS[status]}
                  </span>
                  <span className="text-[10px] text-[--muted-foreground]">{columnItems.length}</span>
                </div>
                <div className="space-y-1.5 min-h-10">
                  {columnItems.map((item) => (
                    <ItemCard key={item.id} item={item} onDragStart={onDragStart} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          {unscheduled.length > 0 && (
            <div
              onDragOver={(e) => e.preventDefault()}
              className="mb-4 rounded-lg border border-dashed border-[--border] p-2"
            >
              <div className="text-[10px] uppercase tracking-widest text-[--muted-foreground] mb-1.5 px-1">
                Unscheduled
              </div>
              <div className="flex flex-wrap gap-1.5">
                {unscheduled.map((item) => (
                  <div key={item.id} className="w-40">
                    <ItemCard item={item} onDragStart={onDragStart} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between mb-2">
            <button onClick={() => setMonth((m) => subMonths(m, 1))} className="p-1 rounded hover:bg-[--muted]">
              <ChevronLeft className="w-4 h-4 text-[--muted-foreground]" />
            </button>
            <span className="text-sm font-medium text-[--foreground]">{format(month, "MMMM yyyy")}</span>
            <button onClick={() => setMonth((m) => addMonths(m, 1))} className="p-1 rounded hover:bg-[--muted]">
              <ChevronRight className="w-4 h-4 text-[--muted-foreground]" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="text-center text-[10px] text-[--muted-foreground] py-1">
                {d}
              </div>
            ))}
            {days.map((day) => {
              const dayItems = items.filter((i) => i.scheduledAt && isSameDay(new Date(i.scheduledAt), day));
              return (
                <div
                  key={day.toISOString()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => onDropDay(e, day)}
                  className={cn(
                    "min-h-24 rounded-lg border border-[--border] p-1.5 space-y-1",
                    isSameMonth(day, month) ? "bg-[--card]" : "bg-transparent opacity-40"
                  )}
                >
                  <div className="text-[10px] text-[--muted-foreground] px-0.5">{format(day, "d")}</div>
                  {dayItems.map((item) => (
                    <ItemCard key={item.id} item={item} onDragStart={onDragStart} />
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
