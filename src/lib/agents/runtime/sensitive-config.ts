const SENSITIVE_CONFIG_PATTERN = /(?:^|[\s"'])((?:api[_-]?key|access[_-]?key|secret|token|password|private[_-]?key|client[_-]?secret|credential)s?)(?:["']?\s*[:=])/im;
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;

/**
 * The runtime configuration UI is deliberately not a credential editor.
 * Fail closed for secret-shaped content so credentials are never returned to,
 * or accepted from, a browser even when the caller can configure a runtime.
 */
export function containsSensitiveRuntimeConfig(content: string) {
  return SENSITIVE_CONFIG_PATTERN.test(content) || PRIVATE_KEY_PATTERN.test(content);
}
