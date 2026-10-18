"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/modules/bots/components/client";
import { Button, Empty, Field, Notice, Pill, TextArea } from "@/modules/bots/components/bits";
import { TaskView, type TaskData } from "@/modules/bots/components/TaskView";

interface Bot { id: string; key: string; agentId: string; botId: string; enabled: boolean; lastWebhookAt: string | null; lastHealthAt: string | null; webhookHealth: { username?: string; webhookMatches?: boolean; pendingUpdates?: number } }
interface Update { id: string; telegramBotId: string; messageId: string; replyToMessageId: string | null; status: string; mediaPaths: string[]; currentTaskId: string | null; chatRoomId: string | null; errorCode: string | null; receivedAt: string; deliveries: { id: string; status: string; errorCode: string | null }[] }
interface Conversation { id: string; telegramBotId: string; chatId: string; chatRoomId: string }
interface Status { enabled: boolean; bots: Bot[]; updates: Update[]; conversations: Conversation[] }
export function TelegramPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [task, setTask] = useState<TaskData | null>(null);
  const [conversationId, setConversationId] = useState("");
  const [text, setText] = useState("");
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const update = status?.updates.find((u) => u.id === selected);
  const taskId = update?.currentTaskId;
  const load = useCallback(async () => { setStatus(await api<Status>("/api/telegram")); }, []);
  useEffect(() => {
    let cancelled = false;
    api<Status>("/api/telegram").then((s) => { if (!cancelled) setStatus(s); }).catch((e) => { if (!cancelled) setError(errorMessage(e)); });
    const timer = setInterval(() => { void load().catch((e) => setError(errorMessage(e))); }, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [load]);
  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    const poll = () => api<{ task: TaskData }>(`/api/bots/tasks/${taskId}`).then((d) => { if (!cancelled) setTask(d.task); }).catch((e) => { if (!cancelled) setError(errorMessage(e)); });
    void poll(); const timer = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [taskId]);
  const action = async (bot: Bot, action: string) => {
    setBusy(true); setError(null);
    try { await api(`/api/telegram/bots/${bot.key}`, { method: "POST", body: { action } }); await load(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true); setError(null); const key = requestKey ?? crypto.randomUUID(); setRequestKey(key);
    try { await api(`/api/telegram/conversations/${conversationId}`, { method: "POST", body: { text, idempotencyKey: key } }); setText(""); setRequestKey(null); await load(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return <div className="mx-auto max-w-[1100px] space-y-5 p-5">
    <header><h1 className="text-xl font-semibold">Telegram Mission Control</h1><p className="mt-1 text-sm text-[--muted-foreground]">Messages, governed agent tasks, approvals, memory activity, and delivery outcomes.</p></header>
    {error ? <Notice action={<Button onClick={() => void load().catch((e) => setError(errorMessage(e)))}>Refresh</Button>}>{error}</Notice> : null}
    {status && !status.enabled ? <Notice tone="warn">Execution is paused globally. Authenticated webhook messages can be stored without starting an agent.</Notice> : null}
    {!status ? <p aria-busy="true">Loading Telegram connections…</p> : !status.bots.length ? <Empty title="No Telegram bots configured">Complete the verified gateway setup before moving the existing bots.</Empty> : <div className="grid gap-3 sm:grid-cols-2">{status.bots.map((bot) => <section key={bot.id} className="space-y-2 rounded-lg border border-[--border] bg-[--card] p-4">
      <div className="flex items-center gap-2"><h2 className="font-medium">{bot.key}</h2><Pill tone={bot.enabled ? "good" : "warn"}>{bot.enabled ? "Enabled" : "Paused"}</Pill></div>
      <p className="text-sm">Assigned agent: {bot.agentId}</p>
      <p className="text-xs text-[--muted-foreground]">{bot.webhookHealth.username ? `@${bot.webhookHealth.username} · ` : ""}Webhook: {bot.lastHealthAt ? bot.webhookHealth.webhookMatches ? "matches Sentinel" : "requires attention" : "not checked"} · {bot.webhookHealth.pendingUpdates ?? "?"} pending</p>
      <p className="text-xs text-[--muted-foreground]">Last received: {bot.lastWebhookAt ? new Date(bot.lastWebhookAt).toLocaleString() : "none"}</p>
      <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void action(bot, "health")}>Check connection</Button><Button disabled={busy || !bot.enabled} onClick={() => void action(bot, "pause")}>Pause routing</Button><Link className="text-sm text-[--primary]" href={`/bots/${bot.botId}?tab=activity`}>Bot activity and policy</Link></div>
    </section>)}</div>}
    <section className="space-y-2"><h2 className="font-medium">Conversations</h2>{status?.conversations.map((conversation) => <div key={conversation.id} className="flex flex-wrap items-center gap-3 text-sm"><Link href={`/chat?room=${conversation.chatRoomId}`} className="text-[--primary]">{status.bots.find((b) => b.id === conversation.telegramBotId)?.key} · chat {conversation.chatId} · View history</Link><Button onClick={() => setConversationId(conversation.id)}>Continue here</Button></div>)}</section>
    {conversationId ? <form className="space-y-2 rounded-lg border border-[--border] p-4" onSubmit={(e) => { e.preventDefault(); void send(); }}><Field label="Follow up in this conversation" hint="The reply also goes to the original Telegram chat through the same governed task path."><TextArea required maxLength={12000} value={text} onChange={(e) => { setText(e.target.value); setRequestKey(null); }} /></Field><Button type="submit" busy={busy} disabled={!status?.enabled} variant="primary">Send</Button></form> : null}
    <section className="space-y-2"><h2 className="font-medium">Recent messages and delivery</h2>{status?.updates.length === 0 ? <Empty title="No messages received yet" /> : <ul className="divide-y divide-[--border] rounded-lg border border-[--border]">{status?.updates.map((u) => <li key={u.id} className="flex flex-wrap items-start gap-3 p-3 text-sm"><Pill>{u.status}</Pill><div className="min-w-0 flex-1"><p>{status.bots.find((b) => b.id === u.telegramBotId)?.key} · message {u.messageId}{u.replyToMessageId ? ` · reply to ${u.replyToMessageId}` : ""}</p><p className="text-xs text-[--muted-foreground]">{new Date(u.receivedAt).toLocaleString()} · Delivery: {u.deliveries.map((d) => `${d.status}${d.errorCode ? ` (${d.errorCode})` : ""}`).join(", ") || "awaiting result"}</p>{u.mediaPaths.map((_, index) => <a key={index} className="mr-3 text-xs text-[--primary]" href={`/api/telegram/updates/${u.id}/attachments/${index}`} download>Download attachment {index + 1}</a>)}{u.errorCode ? <p className="text-xs text-red-400">{u.errorCode}</p> : null}</div>{u.currentTaskId ? <Button onClick={() => setSelected(u.id)}>View task</Button> : null}</li>)}</ul>}</section>
    {selected ? <section aria-label="Telegram task activity" className="rounded-lg border border-[--border] p-4">{task && task.id === taskId ? <TaskView task={task} onChanged={() => void load().catch((e) => setError(errorMessage(e)))} /> : <p aria-busy="true">Loading task…</p>}</section> : null}
  </div>;
}
