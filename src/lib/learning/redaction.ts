// Learning Core — payload redaction.
//
// Strips secret-shaped values before anything is persisted to LearningEvent
// (or any other Learning Core table that stores a free-form payload). This
// is an allowlist-adjacent safety net, not a security boundary on its own —
// callers still shouldn't hand this function raw credentials on purpose.

const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|api[_-]?key|auth(orization)?|credential|private[_-]?key|access[_-]?key|session[_-]?id|cookie|ssn|ein|ccnum|card[_-]?number|cvv)/i;

// Catches secret-shaped `KEY=value` / `KEY: "value"` assignments embedded in
// free-form text (e.g. a coding worker's stdout from `cat .env`), which
// SENSITIVE_KEY_PATTERN alone can't reach since it only matches object keys,
// not text content. Keyword list intentionally mirrors
// agents/runtime/sensitive-config.ts's SENSITIVE_CONFIG_PATTERN so this stays
// exactly as conservative as the config-UI gate — only redacts the value,
// never the surrounding line, to keep legitimate code/log context readable.
const SENSITIVE_ASSIGNMENT_PATTERN =
  /((?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|credential)s?\s*[:=]\s*)("?)([^\s"'\n]{4,})(\2)/gi;
const PRIVATE_KEY_BLOCK_PATTERN =
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g;

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
  if (typeof value === "string") {
    const sanitized = value
      .replace(PRIVATE_KEY_BLOCK_PATTERN, "[REDACTED PRIVATE KEY]")
      .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
      .replace(/\b(?:sk|ghp|github_pat|xoxb|xoxp)[-_][A-Za-z0-9_-]{16,}/g, "[REDACTED]")
      .replace(SENSITIVE_ASSIGNMENT_PATTERN, "$1$2[REDACTED]$4");
    if (sanitized !== value) redactedKeys.push(path);
    return sanitized;
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
