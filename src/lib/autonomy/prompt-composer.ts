import { createHash } from "node:crypto";
import {
  PROMPT_LAYER_ORDER,
  type ComposedLayerManifest,
  type PromptLayerId,
  type PromptLayerInput,
} from "./prompt-layers";

export * from "./prompt-layers";

/**
 * Centralized, versioned, modular prompt composition.
 *
 * Every Sentinel surface that builds an agent prompt hands its parts to
 * `composePrompt` as layers. The composer:
 *  - emits them in one canonical order (prompt-layers.ts PROMPT_LAYER_ORDER),
 *  - drops empty layers and any layer whose content duplicates an earlier one,
 *  - skips layers a stateful runtime session already holds (`alreadyInContext`)
 *    so the same instructions are not re-sent every turn,
 *  - truncates a layer past its own budget instead of silently overflowing,
 *  - returns a manifest (per-layer source, version, hash, size) so an
 *    administrator can see exactly what Sentinel contributed.
 *
 * Each agent's identity/personality layers come from that agent's own row, so
 * agents never share one personality, style or method.
 */

export interface ComposeOptions {
  /** Layer hashes the runtime session already received (stateful runtimes like Hermes). */
  alreadyInContext?: ReadonlySet<string>;
  separator?: string;
}

export interface ComposedPrompt {
  text: string;
  layers: ComposedLayerManifest[];
  /** Content address of the whole stack (layer ids + versions + hashes). */
  hash: string;
  totalChars: number;
  sentinelChars: number;
  /** Text of Sentinel-authored layers only, for inspection. */
  sentinelText: string;
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 24);
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function render(layer: PromptLayerInput, content: string): string {
  return layer.title ? `## ${layer.title}\n${content}` : content;
}

export function composePrompt(layers: readonly PromptLayerInput[], options: ComposeOptions = {}): ComposedPrompt {
  const rank = (id: PromptLayerId) => PROMPT_LAYER_ORDER.indexOf(id);
  const ordered = layers.map((layer, index) => ({ layer, index })).sort((a, b) => rank(a.layer.id) - rank(b.layer.id) || a.index - b.index);
  const seen = new Set<string>();
  const manifest: ComposedLayerManifest[] = [];
  const parts: string[] = [];
  const sentinelParts: string[] = [];

  for (const { layer } of ordered) {
    const raw = (layer.content ?? "").trim();
    const contentHash = hashText(normalize(raw));
    const base = { id: layer.id, source: layer.source, version: layer.version ?? null, hash: contentHash };
    if (!raw) { manifest.push({ ...base, chars: 0, truncated: false, status: "empty" }); continue; }
    if (seen.has(contentHash)) { manifest.push({ ...base, chars: 0, truncated: false, status: "duplicate" }); continue; }
    seen.add(contentHash);
    if (options.alreadyInContext?.has(contentHash)) { manifest.push({ ...base, chars: 0, truncated: false, status: "already_in_context" }); continue; }
    const truncated = layer.maxChars !== undefined && raw.length > layer.maxChars;
    const content = truncated ? `${raw.slice(0, layer.maxChars)}\n[truncated to ${layer.maxChars} chars]` : raw;
    const rendered = render(layer, content);
    parts.push(rendered);
    if (layer.source === "sentinel") sentinelParts.push(rendered);
    manifest.push({ ...base, chars: rendered.length, truncated, status: "included" });
  }

  const separator = options.separator ?? "\n\n";
  const text = parts.join(separator);
  const sentinelText = sentinelParts.join(separator);
  const hash = hashText(JSON.stringify(manifest.filter((l) => l.status === "included").map((l) => [l.id, l.version, l.hash])));
  return { text, layers: manifest, hash, totalChars: text.length, sentinelChars: sentinelText.length, sentinelText };
}
