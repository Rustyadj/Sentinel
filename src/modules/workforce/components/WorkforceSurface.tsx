"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { objectiveActionKey, surfaceSchema, type SurfaceAction } from "@/lib/workforce/surface";

export function WorkforceSurface({ surface, allowedActions, onAction, busy }: {
  surface: unknown;
  allowedActions?: ReadonlyMap<string, string>;
  onAction?: (action: SurfaceAction) => void;
  busy?: boolean;
}) {
  const parsed = surfaceSchema.safeParse(surface);
  if (!parsed.success) return <p role="alert">This interface contains invalid components.</p>;
  const { title, components } = parsed.data;

  return <Card role="region" aria-label={title}>
    <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      {components.map((item) => {
        switch (item.type) {
          case "text":
            return <p key={item.id} className="whitespace-pre-wrap text-sm">{item.text}</p>;
          case "metrics":
            return <dl key={item.id} className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {item.values.map((entry, i) => <div key={i} className="rounded-md border border-(--border) p-3">
                <dt className="text-xs text-(--muted-foreground)">{entry.label}</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">{entry.value}</dd>
              </div>)}
            </dl>;
          case "table":
            return <div key={item.id} className="overflow-auto">
              <table className="w-full text-left text-sm">
                <caption className="mb-2 text-left font-medium">{item.caption}</caption>
                <thead><tr className="border-b border-(--border)">{item.columns.map((column, i) => <th key={i} scope="col" className="p-2">{column}</th>)}</tr></thead>
                <tbody>{item.rows.map((row, i) => <tr key={i} className="border-b border-(--border)">{row.map((value, j) => <td key={j} className="p-2">{value}</td>)}</tr>)}</tbody>
              </table>
            </div>;
          case "barChart": {
            const max = Math.max(1, ...item.values.map(({ value }) => value));
            return <figure key={item.id}>
              <figcaption className="mb-2 text-sm font-medium">{item.caption}</figcaption>
              <ul className="space-y-2">
                {item.values.map(({ label, value }, i) => <li key={i} className="grid grid-cols-[minmax(6rem,auto)_1fr_auto] items-center gap-2 text-sm">
                  <span>{label}</span><meter className="w-full" aria-label={label} min={0} max={max} value={value} /><span className="tabular-nums">{value}</span>
                </li>)}
              </ul>
            </figure>;
          }
          case "action": {
            const label = allowedActions?.get(objectiveActionKey(item));
            if (!onAction || !label) return null;
            return <Button key={item.id} className="mr-2" variant="outline" size="sm" disabled={busy}
              onClick={() => onAction(item)}>{label}</Button>;
          }
        }
      })}
    </CardContent>
  </Card>;
}
