/**
 * The single-pass decision bundle: every System 1 question for one request,
 * asked in ONE provider call. Providers answer questions independently and in
 * parallel against the same state, so adding a question costs almost nothing —
 * adding a round trip costs a lot. Never split this into sequential calls.
 *
 * State is kept deliberately small (the request, at most two prior turns, the
 * agent, and the tools it actually holds): classifier accuracy falls as the
 * state fills with unrelated content.
 */
import {
  SYSTEM_ONE_INTENTS,
  SYSTEM_ONE_ROUTES,
  type ReadOnlyToolDescriptor,
  type SystemOneAnswer,
  type SystemOneDecision,
  type SystemOneIntent,
  type SystemOneProviderRequest,
  type SystemOneQuestion,
  type SystemOneRoute,
  type SystemOneSurface,
} from "./types";

export const NO_TOOL = "none";
/** Upper bound on per-argument Choice questions, so a large tool catalog can't bloat the bundle. */
const MAX_ARGUMENT_QUESTIONS = 8;
const MAX_REQUEST_CHARS = 4_000;
const MAX_TURN_CHARS = 600;

export interface DecisionInput {
  request: string;
  surface: SystemOneSurface;
  agentId: string;
  agentRole?: string;
  recentTurns?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Only tools this agent is authorized for. Never a global catalog. */
  tools: ReadOnlyToolDescriptor[];
  /** The agent's configured model, echoed into the decision — never chosen. */
  configuredModel?: string | null;
}

const argumentQuestionId = (toolIndex: number, arg: string) => `arg__${toolIndex}__${arg}`;

export function buildDecisionRequest(input: DecisionInput): SystemOneProviderRequest {
  const tools = input.tools;
  const state: Record<string, unknown> = {
    request: input.request.slice(0, MAX_REQUEST_CHARS),
    surface: input.surface === "voice" ? "spoken conversation" : "typed chat",
    agent: { id: input.agentId, ...(input.agentRole ? { role: input.agentRole } : {}) },
    recent_conversation: (input.recentTurns ?? []).slice(-2).map((t) => ({ role: t.role, content: t.content.slice(0, MAX_TURN_CHARS) })),
    available_tools: tools.map((t) => ({ id: t.id, description: t.description })),
  };

  const questions: Record<string, SystemOneQuestion> = {
    intent: {
      type: "choice",
      instructions: "What is the user trying to do in `request`, read in the context of `recent_conversation`?",
      criteria: { ...SYSTEM_ONE_INTENTS },
    },
    route: {
      type: "choice",
      instructions: "Which path should handle `request`? Choose `tool_read` only when one entry of `available_tools` alone can answer it.",
      criteria: { ...SYSTEM_ONE_ROUTES },
    },
    needs_memory: {
      type: "noul",
      instructions: "Does answering `request` depend on something said, decided or stored before this conversation turn?",
    },
    needs_tool: {
      type: "noul",
      instructions: "Does answering `request` require reading or changing live data in an external system?",
    },
    needs_search: {
      type: "noul",
      instructions: "Does answering `request` require current information from the public internet?",
    },
    needs_system2: {
      type: "noul",
      instructions: "Does answering `request` require writing new text, judgement, analysis, planning or several steps — more than reading back data?",
      criteria: {
        true: "The answer must be composed, reasoned about, compared, planned or written",
        false: "The answer is a greeting, or a direct read-back of data or a stored fact",
      },
    },
    needs_clarification: {
      type: "noul",
      instructions: "Is `request` too ambiguous to act on without first asking the user what they mean?",
    },
    read_only: {
      type: "noul",
      instructions: "Does `request` only ask to look at or read information, with nothing to be created, changed, sent, booked, assigned or deleted?",
    },
    complexity: {
      type: "score",
      instructions: "How much work does answering `request` take?",
      criteria: [
        "A greeting or acknowledgement",
        "Reading back one fact or one set of records",
        "Combining a few facts or making one judgement",
        "Multi-step analysis, planning, writing or code",
      ],
    },
    urgency: {
      type: "score",
      instructions: "How time-sensitive is `request`?",
      criteria: [
        "No time pressure is expressed or implied",
        "Wanted soon, as part of ongoing work",
        "Blocking work now, or something is failing or at risk",
      ],
    },
  };

  if (tools.length > 0) {
    questions.tool = {
      type: "choice",
      instructions: "Which entry of `available_tools`, by `id`, would answer `request` on its own?",
      criteria: {
        ...Object.fromEntries(tools.map((t) => [t.id, t.description.slice(0, 200)])),
        [NO_TOOL]: "No single listed tool answers it",
      },
    };
    let argumentQuestions = 0;
    tools.forEach((tool, index) => {
      if (!tool.fastPathEligible) return;
      for (const [arg, values] of Object.entries(tool.enumArguments)) {
        if (argumentQuestions >= MAX_ARGUMENT_QUESTIONS) return;
        questions[argumentQuestionId(index, arg)] = {
          type: "choice",
          instructions: `If \`${tool.id}\` were used to answer \`request\`, which value of its \`${arg}\` argument fits?`,
          criteria: Object.fromEntries(values.map((v) => [v, null])),
        };
        argumentQuestions += 1;
      }
    });
  }

  return { state, questions };
}

function choiceOf(answers: Record<string, SystemOneAnswer>, id: string) {
  const a = answers[id];
  return a?.type === "choice" ? a : null;
}
function noulOf(answers: Record<string, SystemOneAnswer>, id: string): number {
  const a = answers[id];
  return a?.type === "noul" ? a.noul : 0.5;
}
function normalisedScore(answers: Record<string, SystemOneAnswer>, id: string): number {
  const a = answers[id];
  return a?.type === "score" && a.levels > 1 ? a.score / (a.levels - 1) : 0.5;
}

export function interpretAnswers(input: DecisionInput, answers: Record<string, SystemOneAnswer>): SystemOneDecision {
  const intent = choiceOf(answers, "intent");
  const route = choiceOf(answers, "route");
  const tool = choiceOf(answers, "tool");
  const toolIndex = tool && tool.choice !== NO_TOOL ? input.tools.findIndex((t) => t.id === tool.choice) : -1;
  const chosenTool = toolIndex >= 0 ? input.tools[toolIndex] : null;

  const suggestedToolArguments: Record<string, string> = {};
  if (chosenTool) {
    for (const arg of Object.keys(chosenTool.enumArguments)) {
      const answer = choiceOf(answers, argumentQuestionId(toolIndex, arg));
      if (answer) suggestedToolArguments[arg] = answer.choice;
    }
  }

  return {
    intent: (intent?.choice ?? "other") as SystemOneIntent,
    route: (route?.choice ?? "agent_runtime") as SystemOneRoute,
    needsMemory: noulOf(answers, "needs_memory"),
    needsTool: noulOf(answers, "needs_tool"),
    needsSearch: noulOf(answers, "needs_search"),
    needsSystem2: noulOf(answers, "needs_system2"),
    needsClarification: noulOf(answers, "needs_clarification"),
    readOnly: noulOf(answers, "read_only"),
    complexity: normalisedScore(answers, "complexity"),
    urgency: normalisedScore(answers, "urgency"),
    suggestedTool: chosenTool?.id ?? null,
    suggestedToolArguments,
    suggestedModel: input.configuredModel ?? null,
    confidence: route?.confidence ?? 0,
    confidences: { intent: intent?.confidence ?? 0, route: route?.confidence ?? 0, tool: tool?.confidence ?? null },
  };
}
