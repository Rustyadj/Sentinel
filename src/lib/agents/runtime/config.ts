import type { RuntimeCapabilities, RuntimeInstance, RuntimeView } from "./types";

const CONFIG_ROOT = process.env.AGENT_CONFIG_DIR ?? "/opt/sentinel-os/agents";
const LOG_ROOT = process.env.AGENT_LOG_DIR ?? "/opt/sentinel-os/logs";
const PROJECT_ROOT = process.env.AGENT_PROJECT_ROOT ?? "/opt/sentinel-os/projects";

const HERMES_CAPABILITIES: RuntimeCapabilities = {
  streaming: true,
  resume: true,
  cancel: true,
  toolEvents: true,
  fileChangeEvents: false,
  restart: { supported: true },
  reload: { supported: true },
  nativeUi: { supported: true },
};

const OPENCLAW_CAPABILITIES: RuntimeCapabilities = {
  streaming: true,
  resume: true,
  cancel: true,
  toolEvents: true,
  fileChangeEvents: false,
  restart: { supported: true },
  reload: { supported: true },
  nativeUi: { supported: true },
};

export const COMPATIBILITY_RUNTIMES: RuntimeView[] = [
  {
    id: "runtime-hermes-lisa",
    agentId: "hermes-lisa",
    kind: "hermes",
    transport: "docker",
    // Verified runtime listener is 4862; an explicit deployment override
    // remains authoritative for installations that use another binding.
    endpoint: process.env.HERMES_ENDPOINT ?? "http://127.0.0.1:4862",
    containerName: process.env.HERMES_LISA_CONTAINER ?? "hermes-lisa",
    configPath: `${CONFIG_ROOT}/hermes-lisa`,
    logSource: { kind: "file", ref: `${LOG_ROOT}/hermes-lisa.log` },
    workspaceId: process.env.HERMES_LISA_WORKSPACE_ID,
    enabled: true,
    executionVerified: false,
    capabilities: HERMES_CAPABILITIES,
    sentinelControl: "partial",
    nativeUiUrl: process.env.HERMES_LISA_NATIVE_URL ?? "/legacy/hermes",
    model: process.env.HERMES_LISA_MODEL ?? "gpt-5.6-luna",
  },
  {
    id: "runtime-hermes-nathan2",
    agentId: "hermes-nathan2",
    kind: "hermes",
    transport: "docker",
    // Verified 2026-09-07 on the VPS: hermes-nathan2 (container a8a47ec85ac6, pid 119318)
    // listens on 0.0.0.0:4864. Port 4861 answered nothing. Confirmed reachable from the
    // app container as http://host.docker.internal:4864 -> HTTP 200.
    endpoint: process.env.HERMES_NATHAN2_ENDPOINT ?? "http://127.0.0.1:4864",
    containerName: process.env.HERMES_NATHAN2_CONTAINER ?? "hermes-nathan2",
    configPath: `${CONFIG_ROOT}/hermes-nathan2`,
    logSource: { kind: "file", ref: `${LOG_ROOT}/hermes-nathan2.log` },
    workspaceId: process.env.HERMES_NATHAN2_WORKSPACE_ID,
    enabled: true,
    executionVerified: false,
    capabilities: HERMES_CAPABILITIES,
    sentinelControl: "partial",
    nativeUiUrl: process.env.HERMES_NATHAN2_NATIVE_URL ?? "/legacy/hermes-nathan2",
    model: process.env.HERMES_NATHAN2_MODEL ?? "gpt-5.6-luna",
  },
  {
    id: "runtime-openclaw",
    agentId: "openclaw",
    kind: "openclaw",
    transport: "docker",
    endpoint: process.env.OPENCLAW_ENDPOINT ?? "http://127.0.0.1:18789/readyz",
    containerName: process.env.OPENCLAW_CONTAINER ?? "openclaw",
    configPath: `${CONFIG_ROOT}/openclaw`,
    logSource: { kind: "file", ref: `${LOG_ROOT}/openclaw.log` },
    workspaceId: process.env.OPENCLAW_WORKSPACE_ID,
    enabled: true,
    executionVerified: false,
    capabilities: OPENCLAW_CAPABILITIES,
    sentinelControl: "partial",
    nativeUiUrl: process.env.OPENCLAW_NATIVE_URL ?? "/legacy/openclaw",
    model: process.env.OPENCLAW_MODEL ?? "claude-opus-4-8",
  },
  {
    id: "runtime-claude-code",
    agentId: "claude-code",
    kind: "claude-code",
    transport: "process",
    executable: process.env.CLAUDE_CODE_EXECUTABLE ?? "claude",
    args: ["--permission-mode", "acceptEdits"],
    workingDirectoryRoot: process.env.CLAUDE_CODE_PROJECT_ROOT ?? PROJECT_ROOT,
    logSource: { kind: "file", ref: `${LOG_ROOT}/claude-code.log` },
    workspaceId: process.env.CLAUDE_CODE_WORKSPACE_ID,
    enabled: true,
    executionVerified: false,
    capabilities: {
      streaming: true,
      resume: true,
      cancel: true,
      toolEvents: true,
      fileChangeEvents: true,
      restart: { supported: false, reason: "runtime_does_not_expose_capability" },
      reload: { supported: false, reason: "runtime_does_not_expose_capability" },
      nativeUi: { supported: false, reason: "runtime_does_not_expose_capability" },
    },
    sentinelControl: "partial",
  },
  {
    id: "runtime-codex",
    agentId: "codex",
    kind: "codex",
    transport: "process",
    executable: process.env.CODEX_EXECUTABLE ?? "codex",
    args: ["--sandbox", "workspace-write", "--ask-for-approval", "on-request"],
    workingDirectoryRoot: process.env.CODEX_PROJECT_ROOT ?? PROJECT_ROOT,
    logSource: { kind: "file", ref: `${LOG_ROOT}/codex.log` },
    workspaceId: process.env.CODEX_WORKSPACE_ID,
    enabled: true,
    executionVerified: false,
    capabilities: {
      streaming: true,
      resume: false,
      cancel: true,
      toolEvents: true,
      fileChangeEvents: true,
      restart: { supported: false, reason: "runtime_does_not_expose_capability" },
      reload: { supported: false, reason: "runtime_does_not_expose_capability" },
      nativeUi: { supported: false, reason: "runtime_does_not_expose_capability" },
    },
    sentinelControl: "partial",
  },
  {
    id: "runtime-gemini",
    agentId: "gemini",
    kind: "gemini",
    transport: "process",
    executable: process.env.GEMINI_EXECUTABLE ?? "gemini",
    // Verified on Gemini CLI 0.58.0: without --skip-trust the CLI aborts outside a
    // trusted directory and emits nothing. --approval-mode yolo is the non-interactive
    // equivalent of Codex's sandbox policy; Sentinel gates dangerous work upstream.
    args: ["--approval-mode", "yolo"],
    workingDirectoryRoot: process.env.GEMINI_PROJECT_ROOT ?? PROJECT_ROOT,
    logSource: { kind: "file", ref: `${LOG_ROOT}/gemini.log` },
    workspaceId: process.env.GEMINI_WORKSPACE_ID,
    enabled: true,
    executionVerified: false,
    capabilities: {
      streaming: true,
      // `--resume <session-id>` and `--list-sessions` are present in 0.58.0.
      resume: true,
      cancel: true,
      toolEvents: true,
      fileChangeEvents: false,
      restart: { supported: false, reason: "runtime_does_not_expose_capability" },
      reload: { supported: false, reason: "runtime_does_not_expose_capability" },
      nativeUi: { supported: false, reason: "runtime_does_not_expose_capability" },
    },
    sentinelControl: "partial",
  },
];

export function compatibilityRuntime(id: string): RuntimeView | undefined {
  return COMPATIBILITY_RUNTIMES.find((runtime) => runtime.id === id || runtime.agentId === id);
}

export function asRuntimeInstance(runtime: RuntimeView): RuntimeInstance {
  return {
    id: runtime.id,
    agentId: runtime.agentId,
    kind: runtime.kind,
    transport: runtime.transport,
    ...(runtime.endpoint ? { endpoint: runtime.endpoint } : {}),
    ...(runtime.containerName ? { containerName: runtime.containerName } : {}),
    ...(runtime.serviceName ? { serviceName: runtime.serviceName } : {}),
    ...(runtime.executable ? { executable: runtime.executable } : {}),
    ...(runtime.args ? { args: runtime.args } : {}),
    ...(runtime.workingDirectoryRoot ? { workingDirectoryRoot: runtime.workingDirectoryRoot } : {}),
    ...(runtime.configPath ? { configPath: runtime.configPath } : {}),
    ...(runtime.logSource ? { logSource: runtime.logSource } : {}),
  };
}
