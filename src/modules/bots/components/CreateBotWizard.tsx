"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Sparkles, X } from "lucide-react";
import { BotAvatar, AVATARS, Button, Field, Notice, Select, TextArea, TextInput, lines } from "./bits";
import { api, errorMessage, MEMORY_SCOPE_LABEL } from "./client";

type Fields = Record<string, unknown>;
interface Template { id: string; label: string; summary: string; fields: Fields; suggestedGrants: { serverId: string; toolName: string; permission: string; why: string }[]; wantedServerTags: string[] }
interface Meta {
  hosts: { agentId: string; executionVerified: boolean; health: { ready: boolean } | null }[];
  models: { choices: string[]; inherited: { model: string } } | null;
  templates: Template[]; memoryScopes: string[];
}
interface GrantRow { serverId: string; serverName?: string; toolName: string; permission: string; why: string; checked: boolean }

interface Draft {
  name: string; role: string; description: string; avatar: string; color: string; systemPrompt: string; mission: string; outputPreferences: string;
  workflow: { label: string }[]; capabilities: string[]; memoryPolicy?: { maxItems?: number; minRelevance?: number; enabled?: boolean; readScopes?: string[] }; limits?: Record<string, unknown>;
  [key: string]: unknown;
}
const STEPS = ["Start", "Identity", "Instructions", "Access"] as const;
const READABLE_SCOPES = ["bot", "project", "workspace", "user", "global"];

export function CreateBotWizard({ workspaceId, onClose, onCreated }: { workspaceId: string; onClose: () => void; onCreated: () => void }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [templateId, setTemplateId] = useState("blank");
  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<{ dropped: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const [f, setF] = useState<Draft>({ name: "", role: "Assistant", description: "", avatar: "bot", color: "#7c6cf6", tags: [], systemPrompt: "", mission: "", responsibilities: [], constraints: [], outputPreferences: "", workflow: [], capabilities: [] });
  const [tagsText, setTagsText] = useState("");
  const [respText, setRespText] = useState("");
  const [consText, setConsText] = useState("");
  const [hostId, setHostId] = useState("");
  const [model, setModel] = useState("");
  const [readScopes, setReadScopes] = useState<string[]>(["bot"]);
  const [memoryOn, setMemoryOn] = useState(true);
  const [grants, setGrants] = useState<GrantRow[]>([]);

  useEffect(() => {
    api<Meta>(`/api/bots/meta?workspaceId=${workspaceId}&health=1`).then((m) => { setMeta(m); setHostId((h) => h || m.hosts[0]?.agentId || ""); }).catch((e) => setMetaError(errorMessage(e)));
  }, [workspaceId]);

  const applyFields = (fields: Fields) => {
    setF((prev) => ({ ...prev, ...(fields as Partial<Draft>) }));
    const list = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);
    setTagsText(list(fields.tags).join(", "));
    setRespText(list(fields.responsibilities).join("\n"));
    setConsText(list(fields.constraints).join("\n"));
    const memory = fields.memoryPolicy as Draft["memoryPolicy"];
    if (memory?.readScopes) setReadScopes(memory.readScopes);
    if (memory?.enabled !== undefined) setMemoryOn(memory.enabled);
  };

  const pickTemplate = (t: Template) => {
    setTemplateId(t.id); setGenerated(null);
    applyFields(t.fields);
    setGrants(t.suggestedGrants.map((g) => ({ ...g, checked: true })));
  };

  const generate = async () => {
    setGenerating(true); setError(null);
    try {
      const { proposal } = await api<{ proposal: { fields: Fields; suggestedGrants: { serverId: string; serverName?: string; toolName: string; permission: string; why: string }[]; dropped: string[]; hostAgentId: string } }>("/api/bots/generate", { method: "POST", body: { workspaceId, description } });
      setTemplateId("blank"); applyFields(proposal.fields);
      // Proposed access is shown but never pre-approved.
      setGrants(proposal.suggestedGrants.map((g) => ({ ...g, checked: false })));
      setGenerated({ dropped: proposal.dropped });
      setStep(1);
    } catch (e) { setError(errorMessage(e)); } finally { setGenerating(false); }
  };

  const create = async () => {
    setCreating(true); setError(null);
    try {
      const { bot } = await api<{ bot: { id: string } }>("/api/bots", { method: "POST", body: {
        workspaceId, ...f, tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean), responsibilities: lines(respText), constraints: lines(consText),
        runtimeAgentId: hostId, templateId, modelConfig: model ? { primary: model } : {},
        memoryPolicy: { enabled: memoryOn, readScopes, writeScopes: ["bot"], maxItems: f.memoryPolicy?.maxItems ?? 8, minRelevance: f.memoryPolicy?.minRelevance ?? 0, consolidation: "standard", retentionDays: null },
        limits: f.limits, toolGrants: grants.filter((g) => g.checked).map(({ serverId, toolName, permission }) => ({ serverId, toolName, permission })),
      } });
      setCreatedId(bot.id); onCreated();
    } catch (e) { setError(errorMessage(e)); } finally { setCreating(false); }
  };

  const identityOk = f.name.trim() && f.role.trim();
  const canNext = step === 0 ? true : step === 1 ? Boolean(identityOk) : true;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[min(720px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-[--border] bg-[--card] text-[--foreground] shadow-[var(--shadow-lg)] focus:outline-none">
          <div className="flex items-center justify-between border-b border-[--border] px-5 py-3">
            <div>
              <Dialog.Title className="text-[15px] font-semibold">{createdId ? "Bot created" : "Create bot"}</Dialog.Title>
              <Dialog.Description className="text-[12px] text-[--muted-foreground]">{createdId ? "It starts as a draft. Test it before enabling." : `Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}</Dialog.Description>
            </div>
            <Dialog.Close asChild><button aria-label="Close" className="rounded-md p-1.5 text-[--muted-foreground] hover:bg-[--accent] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]"><X className="h-4 w-4" /></button></Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {metaError ? <Notice>Could not load options: {metaError}</Notice> : null}
            {error ? <Notice>{error}</Notice> : null}
            {!meta && !metaError ? <p className="text-[13px] text-[--muted-foreground]" aria-busy="true">Loading options…</p> : null}

            {createdId ? (
              <div className="space-y-3">
                <p className="text-[13px] leading-5">{f.name} is saved with {grants.filter((g) => g.checked).length} tool grant(s). It cannot use anything else.</p>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/bots/${createdId}?tab=test`} className="inline-flex h-8 items-center rounded-md bg-[--primary] px-3 text-[13px] font-medium text-[--primary-foreground] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]">Test bot</Link>
                  <Link href={`/bots/${createdId}`} className="inline-flex h-8 items-center rounded-md border border-[--border] px-3 text-[13px] hover:bg-[--accent] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]">Open settings</Link>
                  <Button variant="ghost" onClick={onClose}>Close</Button>
                </div>
              </div>
            ) : meta && step === 0 ? (
              <>
                <section>
                  <Field label="Describe the bot" hint="Sentinel proposes a definition for you to edit. It never grants access on its own.">
                    <TextArea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A bot that makes short-form video ads for construction companies" rows={3} maxLength={2000} />
                  </Field>
                  <div className="mt-2 flex items-center gap-2">
                    <Button variant="primary" busy={generating} disabled={description.trim().length < 10} onClick={generate}><Sparkles className="h-3.5 w-3.5" aria-hidden />Generate bot instructions</Button>
                    <span className="text-[12px] text-[--muted-foreground]">Runs on a Hermes host. Takes up to a minute.</span>
                  </div>
                </section>
                <section aria-label="Templates">
                  <h3 className="mb-2 text-[13px] font-medium">Or start from a template</h3>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {meta.templates.map((t) => (
                      <li key={t.id}>
                        <button type="button" aria-pressed={templateId === t.id} onClick={() => pickTemplate(t)} className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring] ${templateId === t.id ? "border-[--primary]/60 bg-[--accent]" : "border-[--border] hover:bg-[--accent]"}`}>
                          <BotAvatar icon={String(t.fields.avatar ?? "bot")} color={String(t.fields.color ?? "#7c6cf6")} size={30} />
                          <span><span className="block text-[13px] font-medium">{t.label}</span><span className="block text-[12px] leading-4 text-[--muted-foreground]">{t.summary}</span></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              </>
            ) : meta && step === 1 ? (
              <div className="space-y-3">
                {generated ? <Notice tone="info">Proposed from your description. Read it, change anything, then continue. {generated.dropped.length ? `Not used because they do not exist here: ${generated.dropped.join(", ")}.` : ""}</Notice> : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Name"><TextInput value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={60} placeholder="Forge" /></Field>
                  <Field label="Role"><TextInput value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} maxLength={100} placeholder="Creative Production Director" /></Field>
                </div>
                <Field label="Description" hint="What it is for. Other agents read this when choosing who to ask."><TextArea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={1000} /></Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Icon"><Select value={f.avatar} onChange={(e) => setF({ ...f, avatar: e.target.value })}>{Object.keys(AVATARS).map((k) => <option key={k} value={k}>{k}</option>)}</Select></Field>
                  <Field label="Tags" hint="Comma separated."><TextInput value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="creative, video" /></Field>
                </div>
              </div>
            ) : meta && step === 2 ? (
              <div className="space-y-3">
                <Field label="System prompt"><TextArea rows={5} value={f.systemPrompt} onChange={(e) => setF({ ...f, systemPrompt: e.target.value })} maxLength={12000} /></Field>
                <Field label="Mission"><TextInput value={f.mission} onChange={(e) => setF({ ...f, mission: e.target.value })} maxLength={2000} /></Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Responsibilities" hint="One per line."><TextArea rows={5} value={respText} onChange={(e) => setRespText(e.target.value)} /></Field>
                  <Field label="Constraints" hint="One per line."><TextArea rows={5} value={consText} onChange={(e) => setConsText(e.target.value)} /></Field>
                </div>
                <Field label="Output preferences"><TextArea rows={2} value={f.outputPreferences} onChange={(e) => setF({ ...f, outputPreferences: e.target.value })} /></Field>
                {f.workflow?.length ? <p className="text-[12px] text-[--muted-foreground]">Working method: {f.workflow.map((step) => step.label).join(" → ")}. Edit steps on the bot page.</p> : null}
              </div>
            ) : meta ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Hermes host" hint="Where its sessions run.">
                    <Select value={hostId} onChange={(e) => setHostId(e.target.value)}>{meta.hosts.map((h) => <option key={h.agentId} value={h.agentId}>{h.agentId}{!h.executionVerified ? " (not verified)" : h.health && !h.health.ready ? " (not ready)" : ""}</option>)}</Select>
                  </Field>
                  <Field label="Model" hint="Choices come from Sentinel's model registry."><Select value={model} onChange={(e) => setModel(e.target.value)}><option value="">Host default{meta.models ? ` (${meta.models.inherited.model})` : ""}</option>{meta.models?.choices.map((m) => <option key={m} value={m}>{m}</option>)}</Select></Field>
                </div>
                <section aria-label="Tool access">
                  <h3 className="text-[13px] font-medium">Tool access</h3>
                  <p className="mb-2 text-[12px] text-[--muted-foreground]">{grants.length ? "Suggested access. Only ticked rows are granted. Everything else stays off." : "No tools. You can grant some later from the bot's Tools tab."}</p>
                  <ul className="space-y-1">
                    {grants.map((g, i) => (
                      <li key={`${g.serverId}:${g.toolName}`} className="flex flex-wrap items-center gap-2 rounded-md border border-[--border] px-2.5 py-1.5 text-[13px]">
                        <input type="checkbox" id={`g${i}`} checked={g.checked} onChange={(e) => setGrants(grants.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)))} className="h-4 w-4 accent-[--primary]" />
                        <label htmlFor={`g${i}`} className="min-w-0 flex-1"><code className="text-[12px]">{g.toolName === "*" ? "all tools" : g.toolName}</code> <span className="text-[--muted-foreground]">on {g.serverName ?? g.serverId}{g.why ? `: ${g.why}` : ""}</span></label>
                        <Select aria-label="Permission" value={g.permission} onChange={(e) => setGrants(grants.map((x, j) => (j === i ? { ...x, permission: e.target.value } : x)))} className="h-7 w-[130px] py-0 text-[12px]"><option value="read">Read only</option><option value="execute">Execute</option><option value="approval">Needs approval</option></Select>
                      </li>
                    ))}
                  </ul>
                </section>
                <section aria-label="Memory">
                  <label className="flex items-center gap-2 text-[13px] font-medium"><input type="checkbox" checked={memoryOn} onChange={(e) => setMemoryOn(e.target.checked)} className="h-4 w-4 accent-[--primary]" />Use Sentinel memory</label>
                  <fieldset disabled={!memoryOn} className="mt-2 flex flex-wrap gap-x-4 gap-y-1 disabled:opacity-50">
                    <legend className="mb-1 text-[12px] text-[--muted-foreground]">It can read</legend>
                    {READABLE_SCOPES.filter((s) => meta.memoryScopes.includes(s)).map((s) => <label key={s} className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={readScopes.includes(s)} onChange={(e) => setReadScopes(e.target.checked ? [...readScopes, s] : readScopes.filter((x) => x !== s))} className="h-4 w-4 accent-[--primary]" />{MEMORY_SCOPE_LABEL[s]}</label>)}
                  </fieldset>
                  <p className="mt-1 text-[11px] text-[--muted-foreground]">It writes only to its own private scope. Change that later on the Memory tab.</p>
                </section>
                <p className="text-[12px] text-[--muted-foreground]">Only you can call it until you allow other agents on the Delegation tab. It is created as a draft.</p>
              </div>
            ) : null}
          </div>

          {!createdId ? (
            <div className="flex items-center justify-between gap-2 border-t border-[--border] px-5 py-3">
              <Button variant="ghost" onClick={() => (step === 0 ? onClose() : setStep(step - 1))}>{step === 0 ? "Cancel" : "Back"}</Button>
              {step < STEPS.length - 1 ? <Button variant="primary" disabled={!canNext} onClick={() => setStep(step + 1)}>{step === 0 ? (templateId === "blank" && !f.name ? "Start blank" : "Use this") : "Next"}</Button>
                : <Button variant="primary" busy={creating} disabled={!identityOk || !hostId} onClick={create}>Create bot</Button>}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

