// What each speaker is asked. Pure functions, so the wording can be tested
// and changed without touching the engine.
//
// The aim is a discussion between colleagues rather than three polite
// answers to the same question: take a position, answer each other by name,
// and say plainly where you disagree.

export interface TranscriptTurn {
  speaker: string;
  kind: string;
  content: string;
}

const MAX_TURN_CHARS = 1_800;

const RULES = [
  "This is a discussion only. Do not run tools, read or edit files, or start any work. Reply in plain prose.",
  "No preamble, no headings, no bullet lists. Under 170 words.",
].join("\n");

const POSITION_LINE = "Finish with one final line in exactly this form:\nPOSITION: <where you stand, in one sentence>";

function renderTranscript(turns: TranscriptTurn[]): string {
  return turns
    .map((turn) => {
      const body = turn.content.length > MAX_TURN_CHARS ? `${turn.content.slice(0, MAX_TURN_CHARS)}…` : turn.content;
      return `${turn.speaker}${turn.kind === "human" ? " (a person in the room)" : ""}:\n${body}`;
    })
    .join("\n\n");
}

export function openingPrompt(input: { speaker: string; others: string[]; asker: string; topic: string; earlier: TranscriptTurn[] }): string {
  return [
    `You are ${input.speaker}, in a roundtable with ${input.others.join(" and ")}. ${input.asker} put this to the group:`,
    `"${input.topic}"`,
    input.earlier.length ? `Said so far:\n\n${renderTranscript(input.earlier)}` : "You are speaking first.",
    [
      "Give your own view, as you would to colleagues you trust:",
      "- Take a position. Do not survey both sides or soften it to be agreeable.",
      "- Say what you are unsure of and what would change your mind.",
      "- If you think the question itself is wrong, say so.",
      input.earlier.length ? "- Do not repeat what has been said. Add to it or push back on it." : "",
    ].filter(Boolean).join("\n"),
    RULES,
    POSITION_LINE,
  ].join("\n\n");
}

export function responsePrompt(input: { speaker: string; topic: string; transcript: TranscriptTurn[]; round: number }): string {
  return [
    `You are ${input.speaker}. The roundtable on "${input.topic}" continues (round ${input.round}).`,
    `The discussion so far:\n\n${renderTranscript(input.transcript)}`,
    [
      "Respond to the others directly, by name:",
      "- Where you disagree, say so plainly and give your reason. Do not look for a compromise that nobody argued for.",
      "- Where someone changed your mind, say what did it.",
      "- If a person in the room spoke, answer them.",
      "- Do not restate your earlier points.",
    ].join("\n"),
    RULES,
    POSITION_LINE,
  ].join("\n\n");
}

export function synthesisPrompt(input: { speaker: string; asker: string; topic: string; transcript: TranscriptTurn[] }): string {
  return [
    `You are ${input.speaker}. Close the roundtable on "${input.topic}" for ${input.asker}.`,
    `The full discussion:\n\n${renderTranscript(input.transcript)}`,
    [
      "Write the closing note in three short paragraphs:",
      "1. What the group agrees on.",
      "2. What is still disputed, naming who holds which view. Do not paper over it; if you were one side of it, say so.",
      "3. What you would do next, and what would settle the dispute.",
    ].join("\n"),
    "Discussion only: no tools, no files. Plain prose, under 220 words.",
  ].join("\n\n");
}

/** Pulls the POSITION line out of a reply. Returns the prose without it, and the stance if there was one. */
export function splitPosition(reply: string): { content: string; position: string | null } {
  const lines = reply.trim().split("\n");
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 4; i--) {
    const match = /^\s*\**\s*POSITION\s*:\**\s*(.+)$/i.exec(lines[i]);
    if (match) {
      const position = match[1].replace(/\*+$/, "").trim().slice(0, 300);
      return { content: [...lines.slice(0, i), ...lines.slice(i + 1)].join("\n").trim(), position: position || null };
    }
  }
  return { content: reply.trim(), position: null };
}
