const INJECTION_RULES: Array<[string, RegExp]> = [
  ["policy_override", /\b(ignore|disregard|override|bypass)\b.{0,60}\b(system|developer|policy|instruction|guardrail)/i],
  ["authorization_change", /\b(grant|elevate|admin|permission|authorize)\b.{0,50}\b(me|agent|user|role|access)/i],
  ["credential_request", /\b(password|api[-_ ]?key|access[-_ ]?token|secret|private key)\b.{0,50}\b(show|send|reveal|print|include|expose)/i],
  ["embedded_tool_directive", /\b(run|execute|call|invoke)\b.{0,40}\b(shell|sql|tool|command|deployment|curl|powershell)/i],
  ["hidden_instruction", /(?:<!--|\u200b|\u200c|\u200d|\ufeff|base64\s*:)/i],
];

const SECRET_PATTERNS = [
  /\b(?:sk|rk|pk)_[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[oprsu]_[A-Za-z0-9]{20,}\b/g,
  /\b(?:password|secret|token|api[-_ ]?key)\s*[:=]\s*[^\s,;]+/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];

export interface SecurityFinding { code: string; excerpt: string }

export function scanUntrustedContent(content: string): SecurityFinding[] {
  const normalized = content.normalize("NFKC");
  return INJECTION_RULES.flatMap(([code, pattern]) => {
    const match = normalized.match(pattern);
    return match ? [{ code, excerpt: match[0].slice(0, 120) }] : [];
  });
}

export function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), value);
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      /password|secret|token|credential|api.?key/i.test(key) ? "[REDACTED]" : redactSecrets(item),
    ]));
  }
  return value;
}

export function assertInputSize(content: string, maxBytes = 128_000): void {
  if (Buffer.byteLength(content, "utf8") > maxBytes) {
    throw new Error(`Input exceeds ${maxBytes} byte limit.`);
  }
}
