import { NextResponse } from "next/server";
import { WorkspaceAccessError } from "@/lib/workspaces/authorization";
import { GrantValidationError } from "@/lib/autonomy/authority-store";

export function autonomyErrorResponse(error: unknown) {
  if (error instanceof WorkspaceAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof GrantValidationError) return NextResponse.json({ error: "Invalid grant", details: error.errors }, { status: 400 });
  if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  console.error("[autonomy]", error);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

export function str(value: unknown, max = 200): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

export function strList(value: unknown, maxItems = 32): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim().slice(0, 80)))].slice(0, maxItems) : [];
}

export function intOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

export function dateOrNull(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
