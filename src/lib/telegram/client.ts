import { TelegramError } from "./policy";

export class TelegramApiError extends TelegramError {
  constructor(code: string, readonly retryAfter: number | null = null, readonly ambiguous = false) { super(code, 503); }
}
/** Never return or log token-bearing URLs, fetch errors, or Telegram descriptions. */
export async function telegramCall<T>(token: string, method: string, body: Record<string, unknown> = {}, fetcher: typeof fetch = fetch): Promise<T> {
  if (!["getMe", "getWebhookInfo", "setWebhook", "deleteWebhook", "getFile", "sendMessage", "editMessageText", "sendChatAction"].includes(method)) throw new TelegramError("unsupported_telegram_method");
  let response: Response;
  try {
    response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000), redirect: "error" });
  } catch { throw new TelegramApiError("telegram_transport_unknown", null, true); }
  let result: { ok: boolean; result: T; error_code?: number; parameters?: { retry_after?: number } };
  try { result = await response.json(); } catch { throw new TelegramApiError("telegram_response_unknown", null, true); }
  if (result.ok) return result.result;
  if (result.error_code === 429) throw new TelegramApiError("telegram_rate_limited", Math.max(1, Math.min(86400, result.parameters?.retry_after ?? 60)));
  throw new TelegramApiError(`telegram_http_${result.error_code ?? response.status}`, null, response.status >= 500);
}

export async function downloadFile(token: string, fileId: string, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  const info = await telegramCall<{ file_path: string; file_size?: number }>(token, "getFile", { file_id: fileId }, fetcher);
  if (!info.file_path || !/^[A-Za-z0-9_./-]+$/.test(info.file_path) || info.file_path.split("/").includes("..") || (info.file_size ?? 0) > 20_000_000) throw new TelegramError("attachment_not_supported", 413);
  let response: Response;
  try { response = await fetcher(`https://api.telegram.org/file/bot${token}/${info.file_path}`, { signal: AbortSignal.timeout(30_000), redirect: "error" }); }
  catch { throw new TelegramError("attachment_download_failed", 503); }
  if (!response.ok || !response.body) throw new TelegramError("attachment_download_failed", 503);
  const reader = response.body.getReader(); const buffers: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 20_000_000) throw new TelegramError("attachment_too_large", 413);
      buffers.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return Buffer.concat(buffers);
}
