export interface LearningCoreSection {
  id: string;
  label: string;
  status: "available" | "planned";
  owner: "claude" | "codex" | "shared";
}

// Owner tags exist only to keep the parallel build from colliding on files —
// they carry no runtime meaning once a section ships.
export const LEARNING_CORE_SECTIONS: LearningCoreSection[] = [
  { id: "overview", label: "Overview", status: "available", owner: "claude" },
  { id: "curiosity", label: "Curiosity", status: "available", owner: "claude" },
  { id: "knowledge-gaps", label: "Knowledge Gaps", status: "available", owner: "claude" },
  { id: "reflection", label: "Reflection", status: "available", owner: "claude" },
  { id: "replay", label: "Experience Replay", status: "available", owner: "claude" },
  { id: "metrics", label: "Metrics", status: "available", owner: "claude" },
  { id: "hypotheses", label: "Hypotheses", status: "available", owner: "codex" },
  { id: "experiments", label: "Experiments", status: "available", owner: "codex" },
  { id: "benchmarks", label: "Benchmarks", status: "available", owner: "codex" },
  { id: "skills", label: "Skill Library", status: "available", owner: "codex" },
  { id: "improvement-queue", label: "Improvement Queue", status: "available", owner: "codex" },
  { id: "trust", label: "Trust Center", status: "available", owner: "codex" },
  { id: "feature-flags", label: "Feature Flags", status: "available", owner: "codex" },
  { id: "evolution", label: "Evolution Timeline", status: "available", owner: "codex" },
];

export interface CuriosityEvent {
  id: string;
  agentId: string;
  score: number;
  factors: Record<string, number | string | boolean>;
  triggerContext: string | null;
  question: string | null;
  resolved: boolean;
  resolution: string | null;
  createdAt: string;
  agent?: { id: string; name: string; avatar: string; color: string };
}

export interface Reflection {
  id: string;
  agentId: string;
  taskRef: string | null;
  wentWell: string | null;
  wentWrong: string | null;
  surprises: string | null;
  wrongAssumptions: string | null;
  missingInfo: string | null;
  shouldRemember: string | null;
  skillIdea: string | null;
  shouldAskMore: boolean;
  createdAt: string;
  agent?: { id: string; name: string; avatar: string; color: string };
}

export interface ReplayEntry {
  id: string;
  category: string;
  sourceRef: string | null;
  summary: string;
  lessons: string[];
  improvementOpportunities: string[];
  runDate: string;
  createdAt: string;
}

export interface LearningCoreMetrics {
  curiosity: { total: number; unresolved: number };
  knowledgeGaps: Record<string, number>;
  reflection: { total: number; shouldAskMore: number };
  replay: Record<string, number>;
  preferences: { total: number };
  hypotheses: Record<string, number>;
  experiments: Record<string, number>;
  skills: { total: number };
  trustEvents: { total: number };
}

export interface KnowledgeGap {
  id: string;
  agentId: string;
  topic: string;
  description: string;
  occurrenceCount: number;
  confidence: number;
  priority: "low" | "medium" | "high";
  status: "open" | "learning" | "resolved";
  estimatedBenefit: string | null;
  createdAt: string;
  updatedAt: string;
  agent?: { id: string; name: string; avatar: string; color: string };
}
