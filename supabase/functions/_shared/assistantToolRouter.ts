// Decides which tools to run before the assistant answers.
//
// `streamBrain` streams a single model call and has no tool loop, and giving
// it one would mean re-plumbing the streaming path that every chat feature in
// the app shares. The cheaper shape, and the one that fits what is already
// here: ask a small fast model once, with a forced tool call, which lookups
// this question needs. Then run them and stream the answer with the results
// already in the prompt.
//
// One extra call, on the cheapest model in the registry, with a prompt that
// deliberately does NOT include the document — the router only needs the
// question and a list of what is available.
import { askBrain, BrainHttpError } from "./aiBrain.ts";
import { DEFAULT_FAST } from "./modelRegistry.ts";
import { ASSISTANT_TOOL_SPECS } from "./assistantToolsCore.ts";
import { MAX_TOOL_CALLS, type PlannedCall } from "./assistantTools.ts";
import type { Dialect } from "./dialectTypes.ts";

interface PlanShape {
  lookups?: Array<{ tool?: string; url?: string; query?: string; word?: string }>;
}

const PLAN_TOOL = {
  name: "plan_lookups",
  description: "Decide which lookups (if any) are needed before answering.",
  parameters: {
    type: "object",
    properties: {
      lookups: {
        type: "array",
        description:
          "Lookups to run, in order. Empty when the question can be answered from what is already on screen — which is the usual case.",
        maxItems: MAX_TOOL_CALLS,
        items: {
          type: "object",
          properties: {
            tool: {
              type: "string",
              enum: ASSISTANT_TOOL_SPECS.map((s) => s.name),
              description: "Which lookup to run.",
            },
            url: { type: "string", description: "For read_source: the source URL from the context." },
            query: { type: "string", description: "For search_library: what to look for." },
            word: { type: "string", description: "For get_word_history: the Arabic word." },
          },
          required: ["tool"],
          additionalProperties: false,
        },
      },
    },
    required: ["lookups"],
    additionalProperties: false,
  },
} as const;

const toolMenu = () =>
  ASSISTANT_TOOL_SPECS.map((spec) => `- ${spec.name}: ${spec.description}`).join("\n");

export interface RoutePlanInput {
  question: string;
  dialect: Dialect;
  /** A short description of the screen — NOT the whole document. */
  pageSummary: string;
  /** Source URLs the learner's screen points at; empty disables read_source. */
  availableUrls: string[];
}

/**
 * Plan the lookups for one question. Returns an empty plan on any failure,
 * and on the common case where nothing needs looking up.
 *
 * Biased hard towards doing nothing. Most questions about a line on screen are
 * answerable from the line on screen, and a lookup that was not needed costs a
 * round trip and drags an irrelevant article into the answer.
 */
export async function planToolCalls(input: RoutePlanInput): Promise<PlannedCall[]> {
  const question = input.question.trim();
  // Too short to be a question that needs research: "ok", "why?", "again".
  if (question.length < 12) return [];

  const urlList = input.availableUrls.length
    ? input.availableUrls.map((u) => `- ${u}`).join("\n")
    : "(none — read_source is unavailable for this question)";

  try {
    const result = await askBrain<PlanShape>({
      purpose: "assistant_tool_router",
      dialect: input.dialect,
      strategy: "solo",
      // The router writes no Arabic, so the dialect machinery is pure overhead.
      skipRepair: true,
      models: [DEFAULT_FAST],
      maxTokens: 300,
      temperature: 0,
      callTimeoutMs: 8000,
      budgetMs: 10_000,
      tool: PLAN_TOOL,
      systemPromptExtra:
        `You route an Arabic tutor's questions to lookups. You do not answer the question.\n\n` +
        `Available lookups:\n${toolMenu()}\n\n` +
        `Rules:\n` +
        `- Return an EMPTY list unless a lookup would genuinely change the answer. Most questions about what is on screen are already answerable from what is on screen.\n` +
        `- read_source only for a URL in the list given to you, and only when the learner is asking about the original source itself — what it really said, detail the app's version dropped, whether the retelling is accurate.\n` +
        `- search_library when they ask where else a word appears, want more real examples, or ask how something is usually said.\n` +
        `- get_word_history when the answer depends on whether THIS learner has met a word before.\n` +
        `- Never more than ${MAX_TOOL_CALLS} lookups.`,
      userPrompt:
        `Learner's question: ${question}\n\n` +
        `What is on their screen: ${input.pageSummary || "(nothing published)"}\n\n` +
        `Source URLs available to read:\n${urlList}`,
    });

    const lookups = Array.isArray(result.output?.lookups) ? result.output.lookups : [];
    return lookups
      .filter((entry) => entry && typeof entry.tool === "string")
      .map((entry) => {
        const args: Record<string, unknown> = {};
        if (typeof entry.url === "string" && entry.url) args.url = entry.url;
        if (typeof entry.query === "string" && entry.query) args.query = entry.query;
        if (typeof entry.word === "string" && entry.word) args.word = entry.word;
        return { name: entry.tool as string, args };
      })
      .slice(0, MAX_TOOL_CALLS);
  } catch (err) {
    // A router that cannot decide is the same as a router that decided to do
    // nothing: the answer still goes out, using what is already on screen.
    if (err instanceof BrainHttpError && (err.status === 402 || err.status === 429)) {
      console.warn("[assistantToolRouter] skipping lookups:", err.status);
    } else {
      console.warn("[assistantToolRouter] planning failed", err);
    }
    return [];
  }
}
