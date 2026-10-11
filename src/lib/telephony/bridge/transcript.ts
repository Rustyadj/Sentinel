/** A slice of transcript on the GPT-Live session timeline. */
export interface Fragment {
  start: number;
  end: number;
  text: string;
}

/** A commentary append carries at most 500 tokens; stay well inside that. */
const COMMENTARY_CHUNK_CHARS = 1_500;
const COMMENTARY_MAX_CHUNKS = 4;

/** Splits a spoken answer at sentence boundaries into appends the live model accepts. */
export function chunkForSpeech(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let rest = clean;
  while (rest.length > COMMENTARY_CHUNK_CHARS && chunks.length < COMMENTARY_MAX_CHUNKS - 1) {
    const window = rest.slice(0, COMMENTARY_CHUNK_CHARS);
    const cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "));
    const at = cut > COMMENTARY_CHUNK_CHARS / 2 ? cut + 1 : COMMENTARY_CHUNK_CHARS;
    chunks.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  chunks.push(rest.length > COMMENTARY_CHUNK_CHARS ? `${rest.slice(0, COMMENTARY_CHUNK_CHARS - 1)}…` : rest);
  return chunks;
}

/** Caller speech fragments, indexed by session-timeline offset. */
export class FragmentLog {
  private fragments: Fragment[] = [];

  add(fragment: Fragment): void {
    this.fragments.push(fragment);
  }

  /** True once transcript has reached `offsetMs` (minus slack), i.e. the delegation's words have arrived. */
  covers(offsetMs: number, slackMs: number): boolean {
    return this.fragments.some((f) => f.end >= offsetMs - slackMs);
  }

  /** Text of fragments that start in (afterMs, atMostMs]. */
  utterance(afterMs: number, atMostMs: number): string {
    return this.fragments
      .filter((f) => f.start > afterMs && f.start <= atMostMs)
      .map((f) => f.text)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  }
}

export type TurnRole = "caller" | "agent";
export interface RecordedTurn { role: TurnRole; text: string; offsetMs: number }

/**
 * Groups streaming transcript deltas into turns. Each speaker's buffer is
 * flushed after it has been quiet for `idleMs` — GPT-Live is full duplex and
 * delivers no turn boundaries, so silence is the only honest delimiter.
 */
export class TurnRecorder {
  private buffers = new Map<TurnRole, { text: string; offsetMs: number; timer: ReturnType<typeof setTimeout> }>();
  readonly turns: RecordedTurn[] = [];

  constructor(
    private readonly onTurn: (turn: RecordedTurn) => void,
    private readonly idleMs = 1_500,
  ) {}

  push(role: TurnRole, delta: string, offsetMs: number): void {
    const current = this.buffers.get(role);
    if (current) clearTimeout(current.timer);
    const text = (current?.text ?? "") + delta;
    const start = current?.offsetMs ?? offsetMs;
    const timer = setTimeout(() => this.flush(role), this.idleMs);
    timer.unref?.();
    this.buffers.set(role, { text, offsetMs: start, timer });
  }

  flush(role?: TurnRole): void {
    for (const key of role ? [role] : [...this.buffers.keys()]) {
      const entry = this.buffers.get(key);
      if (!entry) continue;
      clearTimeout(entry.timer);
      this.buffers.delete(key);
      const text = entry.text.replace(/\s+/g, " ").trim();
      if (!text) continue;
      const turn = { role: key, text, offsetMs: entry.offsetMs };
      this.turns.push(turn);
      this.onTurn(turn);
    }
  }
}
