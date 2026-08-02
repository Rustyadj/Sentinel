// Learning Core — payload redaction.
//
// Strips secret-shaped values before anything is persisted to LearningEvent
// (or any other Learning Core table that stores a free-form payload). This
// is an allowlist-adjacent safety net, not a security boundary on its own —
// callers still shouldn't hand this function raw credentials on purpose.

const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|api[_-]?key|auth(orization)?|credential|private[_-]?key|access[_-]?key|session[_-]?id|cookie|ssn|ein|ccnum|card[_-]?number|cvv)/i;

export interface RedactionResult {
  payload: Record<string, unknown>;
  redactedKeys: string[];
}

function redactValue(
  value: unknown,
  path: string,
  redactedKeys: string[]
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, i) => redactValue(item, `${path}[${i}]`, redactedKeys));
  }
  if (value !== null && typeof value === "object") {
    return redactObject(value as Record<string, unknown>, path, redactedKeys);
  }
  return value;
}

function redactObject(
  obj: Record<string, unknown>,
  path: string,
  redactedKeys: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const keyPath = path ? `${path}.${key}` : key;
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      redactedKeys.push(keyPath);
      result[key] = "[REDACTED]";
      continue;
    }
    result[key] = redactValue(value, keyPath, redactedKeys);
  }
  return result;
}

export function redactPayload(payload: Record<string, unknown>): RedactionResult {
  const redactedKeys: string[] = [];
  const redacted = redactObject(payload, "", redactedKeys);
  return { payload: redacted, redactedKeys };
}
