// Reading and rewriting what the tutor remembers about a learner.
//
// Reads happen on the first turn, beside the learner profile. Rewrites happen
// after the answer has already been streamed, in the background, and only when
// enough has been said since the last one to be worth a model call — so a
// learner never waits on their own memory being updated.
//
// Nothing here throws. A memory that cannot be read is a tutor with no notes,
// which is exactly what it was before this existed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { askBrain } from "./aiBrain.ts";
import { DEFAULT_FAST } from "./modelRegistry.ts";
import {
  clampMemory,
  EMPTY_MEMORY,
  MAX_OPEN_QUESTIONS,
  MAX_SUMMARY_CHARS,
  memoryBlock,
  parseMemory,
  shouldRewrite,
  type LearnerMemory,
} from "./learnerMemoryCore.ts";
import type { Dialect } from "./dialectTypes.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

let cached: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!cached) {
    cached = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

export async function readLearnerMemory(
  userId: string,
  dialect: Dialect,
): Promise<LearnerMemory> {
  if (!userId || !SUPABASE_URL || !SERVICE_ROLE) return EMPTY_MEMORY;
  try {
    const { data, error } = await admin()
      .from("learner_ai_memory")
      .select("summary, open_questions, turns_seen")
      .eq("user_id", userId)
      .eq("dialect", dialect)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return parseMemory(data);
  } catch (err) {
    console.warn("[learnerMemory] read failed", err);
    return EMPTY_MEMORY;
  }
}

/** The memory as a prompt block, or "" when there is nothing remembered yet. */
export async function learnerMemoryBlock(userId: string, dialect: Dialect): Promise<string> {
  return memoryBlock(await readLearnerMemory(userId, dialect));
}

interface SummaryShape {
  summary?: string;
  openQuestions?: string[];
}

const REWRITE_TOOL = {
  name: "update_memory",
  description: "Rewrite the tutor's running notes about this learner.",
  parameters: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description:
          "The updated notes, replacing the previous ones entirely. Under 700 characters.",
      },
      openQuestions: {
        type: "array",
        maxItems: MAX_OPEN_QUESTIONS,
        items: { type: "string" },
        description: "Questions the learner raised that were not fully resolved. Empty if none.",
      },
    },
    required: ["summary", "openQuestions"],
    additionalProperties: false,
  },
} as const;

const REWRITE_SYSTEM =
  `You keep a language tutor's running notes about one learner. You are given the previous notes ` +
  `and the latest exchange, and you return the notes as they should now read.\n\n` +
  `Write about patterns, not events. Useful: what keeps confusing them, which kind of explanation ` +
  `lands, what they are working towards, the register or setting they care about. Useless: a ` +
  `transcript, a list of every word mentioned, anything the SRS already tracks (which words are ` +
  `due, review counts).\n\n` +
  `Rules:\n` +
  `- Rewrite, do not append. The notes must not grow with every conversation.\n` +
  `- Under 700 characters. If something new matters more than something old, drop the old.\n` +
  `- Drop anything the latest exchange contradicts — a learner who has just used a construction ` +
  `correctly no longer struggles with it.\n` +
  `- Write plainly, in the third person ("prefers examples before rules").\n` +
  `- Record nothing personal beyond how they learn Arabic.\n` +
  `- If the exchange added nothing worth keeping, return the previous notes unchanged.`;

/**
 * Fold the latest exchange into the learner's notes.
 *
 * Runs after the answer has gone out, so its cost is invisible to the learner
 * and its failure costs them nothing. Skipped entirely unless enough turns
 * have passed since the last rewrite.
 */
export async function updateLearnerMemory(args: {
  userId: string;
  dialect: Dialect;
  /** The exchange to fold in, newest last. */
  messages: Array<{ role: string; content: string }>;
  /** Running total of assistant turns for this learner, including this one. */
  assistantTurns: number;
  /** Already-read memory, to save a round trip. */
  current?: LearnerMemory;
}): Promise<void> {
  if (!args.userId || !SUPABASE_URL || !SERVICE_ROLE) return;

  try {
    const current = args.current ?? (await readLearnerMemory(args.userId, args.dialect));
    if (!shouldRewrite(current, args.assistantTurns)) return;

    // The last few turns, not the whole conversation: the notes describe how
    // this learner learns, and that is visible in a couple of exchanges.
    const excerpt = args.messages
      .slice(-6)
      .map((m) => `${m.role === "user" ? "Learner" : "Tutor"}: ${m.content.slice(0, 800)}`)
      .join("\n\n");
    if (!excerpt.trim()) return;

    const result = await askBrain<SummaryShape>({
      purpose: "learner_memory_rewrite",
      dialect: args.dialect,
      strategy: "solo",
      // The notes are English prose about a learner; the dialect machinery has
      // nothing to correct here and would only cost passes.
      skipRepair: true,
      models: [DEFAULT_FAST],
      maxTokens: 400,
      temperature: 0.2,
      callTimeoutMs: 15_000,
      budgetMs: 20_000,
      tool: REWRITE_TOOL,
      systemPromptExtra: REWRITE_SYSTEM,
      userPrompt:
        `Previous notes:\n${current.summary || "(none yet — this is the first)"}\n\n` +
        `Previously unresolved:\n${
          current.openQuestions.length ? current.openQuestions.join("; ") : "(none)"
        }\n\n` +
        `Latest exchange:\n${excerpt}`,
    });

    const next = clampMemory(
      {
        summary: result.output?.summary ?? current.summary,
        openQuestions: result.output?.openQuestions ?? current.openQuestions,
      },
      args.assistantTurns,
    );
    // A rewrite that came back empty is a failed rewrite, not an instruction to
    // forget everything.
    if (!next.summary && current.summary) return;

    const { error } = await admin()
      .from("learner_ai_memory")
      .upsert(
        {
          user_id: args.userId,
          dialect: args.dialect,
          summary: next.summary.slice(0, MAX_SUMMARY_CHARS),
          open_questions: next.openQuestions,
          turns_seen: next.turnsSeen,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,dialect" },
      );
    if (error) throw new Error(error.message);
  } catch (err) {
    // Losing a memory update costs the next conversation a little context. It
    // must never cost this one its answer.
    console.warn("[learnerMemory] rewrite failed", err);
  }
}
