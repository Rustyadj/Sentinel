import type { RuntimeCapabilities, RuntimeInstance, RuntimeView } from "./types";

const CONFIG_ROOT = process.env.AGENT_CONFIG_DIR ?? "/opt/sentinel-os/agents";
const LOG_ROOT = process.env.AGENT_LOG_DIR ?? "/opt/sentinel-os/logs";
const PROJECT_ROOT = process.env.AGENT_PROJECT_ROOT ?? "/opt/sentinel-os/projects";

const HTTP_CAPABILITIES: RuntimeCapabilities = {
  streaming: false,
  resume: false,
  cancel: false,
  toolEvents: false,
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
    endpoint: process.env.HERMES_ENDPOINT ?? "http://127.0.0.1:4860",
    containerName: process.env.HERMES_LISA_CONTAINER ?? "hermes-lisa",
    configPath: `${CONFIG_ROOT}/hermes-lisa`,
    logSource: { kind: "file", ref: `${LOG_ROOT}/hermes-lisa.log` },
    workspaceId: process.env.HERMES_LISA_WORKSPACE_ID,
    enabled: true,
    capabilities: HTTP_CAPABILITIES,
    sentinelControl: "partial",
    nativeUiUrl: process.env.HERMES_LISA_NATIVE_URL ?? "/legacy/hermes",
    model: process.env.HERMES_LISA_MODEL ?? "claude-sonnet-4-6",
  },
  {
    id: "runtime-hermes-clint",
    agentId: "hermes-clint",
    kind: "hermes",
    transport: "docker",
    endpoint: process.env.HERMES_CLINT_ENDPOINT ?? "http://127.0.0.1:4861",
    containerName: process.env.HERMES_CLINT_CONTAINER ?? "hermes-clint",
    configPath: `${CONFIG_ROOT}/hermes-clint`,
    logSource: { kind: "file", ref: `${LOG_ROOT}/hermes-clint.log` },
    workspaceId: process.env.HERMES_CLINT_WORKSPACE_ID,
    enabled: true,
    capabilities: HTTP_CAPABILITIES,
    sentinelControl: "partial",
    nativeUiUrl: process.env.HERMES_CLINT_NATIVE_URL,
    model: process.env.HERMES_CLINT_MODEL ?? "claude-sonnet-4-6",
  },
  {
    id: "runtime-openclaw",
    agentId: "openclaw",
    kind: "openclaw",
    transport: "docker",
    endpoint: process.env.OPENCLAW_ENDPOINT ?? "http://127.0.0.1:3001",
    containerName: process.env.OPENCLAW_CONTAINER ?? "openclaw",
    configPath: `${CONFIG_ROOT}/openclaw`,
    logSource: { kind: "file", ref: `${LOG_ROOT}/openclaw.log` },
    workspaceId: process.env.OPENCLAW_WORKSPACE_ID,
    enabled: true,
    capabilities: HTTP_CAPABILITIES,
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
