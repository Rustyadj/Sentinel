import type { Agent } from "@/types";

export const AGENT_TEMPLATES: Omit<Agent, "status">[] = [
  {
    id: "hermes-lisa",
    name: "Hermes Lisa",
    role: "Chief Orchestrator",
    avatar: "🌸",
    color: "#8B5CF6",
    description: "Primary coordinator and reasoning agent",
    skills: ["orchestration", "planning", "memory", "synthesis"],
    model: "deepseek/deepseek-v4.1-flash",
    systemPrompt:
      "You are Hermes Lisa, the chief orchestrator of the Sentinel OS platform. Your role is to coordinate between agents, synthesize information, maintain context across sessions, and ensure all tasks are completed efficiently. You have access to all agent outputs and can delegate to specialized agents.",
    toolPermissions: ["all"],
    memoryScope: "org",
  },
  {
    id: "claude-code",
    name: "Claude Code",
    role: "Senior Engineer",
    avatar: "💻",
    color: "#3B82F6",
    description: "Code generation, review, and debugging",
    skills: ["typescript", "python", "react", "system-design"],
    model: "claude-opus-5",
    reasoningEffort: "low",
    systemPrompt:
      "You are Claude Code, the senior engineering agent in Sentinel OS. You specialize in writing clean, production-ready code, performing thorough code reviews, debugging complex issues, and designing scalable systems architectures.",
    toolPermissions: ["code_execution", "file_system", "git"],
    memoryScope: "project",
  },
  {
    id: "codex",
    name: "Codex",
    role: "Code Specialist",
    avatar: "⚡",
    color: "#10B981",
    description: "Advanced coding and completion specialist",
    skills: ["completion", "refactoring", "testing", "documentation"],
    model: "gpt-6-astra",
    reasoningEffort: "low",
    systemPrompt:
      "You are Codex, the code completion and refactoring specialist in Sentinel OS. You excel at intelligent code completion, systematic refactoring, writing comprehensive tests, and generating thorough documentation.",
    toolPermissions: ["code_execution", "file_system"],
    memoryScope: "project",
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    role: "Research Agent",
    avatar: "🔍",
    color: "#F59E0B",
    description: "Deep research and analysis",
    skills: ["research", "analysis", "web-search", "summarization"],
    model: "claude-opus-4-8",
    systemPrompt:
      "You are OpenClaw, the research and analysis agent in Sentinel OS. You perform deep research using web search and other tools, synthesize information from multiple sources, and produce comprehensive, well-cited analyses.",
    toolPermissions: ["web_search", "web_fetch", "document_read"],
    memoryScope: "project",
  },
  {
    id: "security-red",
    name: "Red Teamer",
    role: "Offensive Security",
    avatar: "🔴",
    color: "#EF4444",
    description: "Offensive security testing and vulnerability assessment",
    skills: ["pentesting", "exploits", "recon", "social-engineering"],
    model: "claude-sonnet-4-6",
    systemPrompt:
      "You are Red Teamer, the offensive security specialist in Sentinel OS. You conduct authorized penetration testing, identify vulnerabilities, perform reconnaissance, and simulate adversarial attack scenarios to strengthen security posture.",
    toolPermissions: ["network_scan", "code_execution", "web_fetch"],
    memoryScope: "session",
  },
  {
    id: "security-blue",
    name: "Blue Defender",
    role: "Defensive Security",
    avatar: "🔵",
    color: "#06B6D4",
    description: "Security monitoring and hardening",
    skills: ["monitoring", "hardening", "incident-response", "forensics"],
    model: "claude-sonnet-4-6",
    systemPrompt:
      "You are Blue Defender, the defensive security specialist in Sentinel OS. You monitor systems for threats, implement security hardening measures, coordinate incident response, and perform forensic analysis.",
    toolPermissions: ["log_read", "system_monitor", "alert_create"],
    memoryScope: "project",
  },
];

export const THEME_COLORS = {
  background: {
    primary: "#0A0B0E",
    secondary: "#111318",
    tertiary: "#161820",
    surface: "#1C1F2A",
    elevated: "#22263A",
  },
  border: {
    default: "#2A2D3A",
    subtle: "#1E2130",
    accent: "#3A3D50",
  },
  accent: {
    purple: "#8B5CF6",
    blue: "#3B82F6",
    cyan: "#06B6D4",
    green: "#10B981",
    amber: "#F59E0B",
    red: "#EF4444",
  },
  text: {
    primary: "#F1F5F9",
    secondary: "#94A3B8",
    tertiary: "#64748B",
    muted: "#475569",
  },
} as const;

export const STATUS_COLORS = {
  online: "#10B981",
  busy: "#F59E0B",
  idle: "#64748B",
  offline: "#EF4444",
} as const;

export const PRIORITY_COLORS = {
  low: "#64748B",
  medium: "#3B82F6",
  high: "#F59E0B",
  urgent: "#EF4444",
} as const;

export const DEFAULT_ROOM_ID = "mission-control-main";
