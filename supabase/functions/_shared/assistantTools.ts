// Execution for the Ask AI assistant's tools. One entry point, one switch, and
// three implementations that each return prose the model can read.
//
// Nothing here throws. A tool that fails returns a refusal the model is told
// to report honestly — "I couldn't reach the original article" is a fine
// answer, and far better than a 500 in the middle of a conversation.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  isAssistantToolName,
  isUrlAllowed,
  toolRefusal,
  type AssistantToolName,
  type ToolResult,
} from "./assistantToolsCore.ts";
import { retrieveRelatedContent } from "./contentRetrieval.ts";
import { retrievalBlock } from "./contentRetrievalCore.ts";
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

export interface ToolContext {
  userId: string;
  dialect: Dialect;
  /** URLs the learner's current screen points at. Nothing else is readable. */
  allowedUrls: string[];
  /** The content already on screen, so a library search can skip it. */
  currentSourceId?: string;
}

/** How much of a scraped page reaches the prompt. A news article is a few
 *  thousand characters; the rest is navigation and footer. */
const MAX_ARTICLE_CHARS = 6000;
const FETCH_TIMEOUT_MS = 15_000;

async function readSource(url: unknown, ctx: ToolContext): Promise<ToolResult> {
  if (typeof url !== "string" || !url.trim()) {
    return toolRefusal("No URL was given, so there was nothing to read.");
  }
  if (!isUrlAllowed(url, ctx.allowedUrls)) {
    // Deliberately explicit to the model: it should tell the learner it can
    // only open sources their own screen points at, not silently invent the
    // contents of a page it never read.
    return toolRefusal(
      "Refused: that URL is not one of the sources on the learner's current screen. " +
        "Only the source links shown in the page context can be opened. Tell the learner " +
        "you can only open the source behind what they are looking at.",
    );
  }

  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) return toolRefusal("Source reading is not configured on this deployment.");

  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      console.warn("[assistantTools] scrape failed", res.status, detail);
      return toolRefusal(`Could not read that page (the fetch failed with status ${res.status}).`);
    }
    const payload = await res.json();
    const markdown: string = payload?.data?.markdown ?? payload?.markdown ?? "";
    const title: string = payload?.data?.metadata?.title ?? payload?.metadata?.title ?? "";
    const text = markdown.trim();
    if (!text) return toolRefusal("That page returned no readable text.");

    const clipped = text.length > MAX_ARTICLE_CHARS
      ? `${text.slice(0, MAX_ARTICLE_CHARS)}\n\n[… the rest of the page was not read …]`
      : text;
    return { ok: true, text: `Source page${title ? ` "${title}"` : ""} at ${url}:\n\n${clipped}` };
  } catch (err) {
    console.warn("[assistantTools] scrape error", err);
    return toolRefusal("Could not reach that page.");
  }
}

async function searchLibrary(query: unknown, ctx: ToolContext): Promise<ToolResult> {
  if (typeof query !== "string" || query.trim().length < 2) {
    return toolRefusal("No search term was given.");
  }
  const chunks = await retrieveRelatedContent({
    query,
    dialect: ctx.dialect,
    excludeSourceId: ctx.currentSourceId,
    // A deliberate search for one Arabic word is the point of this tool, not
    // the noise the automatic floor exists to filter out.
    minQueryLength: 2,
  });
  if (chunks.length === 0) {
    return { ok: true, text: `Nothing in the learner's library matched "${query}".` };
  }
  return { ok: true, text: retrievalBlock(chunks) };
}

/**
 * What the SRS actually knows about a word.
 *
 * This is the difference between "you have probably seen this" and knowing.
 * Semantic similarity can suggest a word is familiar; only the review record
 * says whether the learner has ever met it, and how well it stuck.
 */
interface DeckCard {
  deck: "personal" | "curriculum";
  word_english: string | null;
  repetitions: number | null;
  interval_days: number | null;
  lapses: number | null;
  is_leech: boolean | null;
  next_review_at: string | null;
}

/** Both decks are queried because both count as "have I studied this?" — the
 *  personal deck the learner saved into, and the curriculum deck the app
 *  taught them from. The learner model reads both for the same reason. */
async function deckCards(word: string, ctx: ToolContext): Promise<DeckCard[]> {
  const [personal, curriculum] = await Promise.all([
    admin()
      .from("user_vocabulary")
      .select("word_english, repetitions, interval_days, lapses, is_leech, next_review_at")
      .eq("user_id", ctx.userId)
      .eq("dialect", ctx.dialect)
      .eq("word_arabic", word)
      .limit(1),
    // The curriculum deck has no word text of its own — it inherits it from
    // the vocabulary row, hence the inner join.
    admin()
      .from("word_reviews")
      .select(
        "repetitions, interval_days, lapses, is_leech, next_review_at, " +
          "vocabulary_words!inner(word_arabic, word_english, dialect_module)",
      )
      .eq("user_id", ctx.userId)
      .eq("vocabulary_words.word_arabic", word)
      .eq("vocabulary_words.dialect_module", ctx.dialect)
      .limit(1),
  ]);

  const out: DeckCard[] = [];
  for (const row of (personal.data ?? []) as Array<Record<string, unknown>>) {
    out.push({
      deck: "personal",
      word_english: (row.word_english as string) ?? null,
      repetitions: (row.repetitions as number) ?? null,
      interval_days: (row.interval_days as number) ?? null,
      lapses: (row.lapses as number) ?? null,
      is_leech: (row.is_leech as boolean) ?? null,
      next_review_at: (row.next_review_at as string) ?? null,
    });
  }
  // Cast through unknown: the embedded-resource select gives postgrest-js a
  // shape it types as a possible error object, and the runtime rows are plain.
  for (const row of ((curriculum.data ?? []) as unknown) as Array<Record<string, unknown>>) {
    const joined = (row.vocabulary_words ?? {}) as { word_english?: string };
    out.push({
      deck: "curriculum",
      word_english: joined.word_english ?? null,
      repetitions: (row.repetitions as number) ?? null,
      interval_days: (row.interval_days as number) ?? null,
      lapses: (row.lapses as number) ?? null,
      is_leech: (row.is_leech as boolean) ?? null,
      next_review_at: (row.next_review_at as string) ?? null,
    });
  }
  return out;
}

/**
 * What the review record actually says about a word.
 *
 * This is the difference between "you have probably seen this" and knowing.
 * Semantic similarity can suggest a word is familiar; only the SRS state says
 * whether the learner ever met it, and whether it stuck.
 */
async function getWordHistory(word: unknown, ctx: ToolContext): Promise<ToolResult> {
  if (typeof word !== "string" || !word.trim()) {
    return toolRefusal("No word was given.");
  }
  const target = word.trim();

  try {
    const cards = await deckCards(target, ctx);
    if (cards.length === 0) {
      return {
        ok: true,
        text: `"${target}" is in neither of this learner's decks — as far as the app knows, it is new to them.`,
      };
    }

    const parts: string[] = [];
    for (const card of cards) {
      const where = card.deck === "personal" ? "their own saved words" : "the curriculum deck";
      const reps = card.repetitions ?? 0;
      const bits = [
        `"${target}"${card.word_english ? ` (${card.word_english})` : ""} is in ${where}`,
        reps === 0 ? "not reviewed yet" : `reviewed ${reps} time${reps === 1 ? "" : "s"}`,
      ];
      // A leech is a card that keeps being forgotten; lapses are the failures
      // that got it there. Both are more useful to a tutor than the interval.
      if (card.is_leech) {
        bits.push("and it is a leech — they keep forgetting it, so a fresh angle will land better than the same gloss again");
      } else if ((card.lapses ?? 0) >= 2) {
        bits.push(`with ${card.lapses} lapses — it has not stuck yet`);
      } else if ((card.interval_days ?? 0) >= 21) {
        bits.push("and it is well established — safe to use without explaining it");
      }
      if (card.next_review_at) bits.push(`next due ${card.next_review_at.slice(0, 10)}`);
      parts.push(`${bits.join(", ")}.`);
    }
    return { ok: true, text: parts.join("\n") };
  } catch (err) {
    console.warn("[assistantTools] word history failed", err);
    return toolRefusal("Could not look up the learner's history for that word.");
  }
}

/** Run one tool. Unknown names are refused rather than ignored, so a model
 *  that invents a tool hears about it instead of getting silence. */
export async function executeAssistantTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!isAssistantToolName(name)) {
    return toolRefusal(`There is no tool called "${name}".`);
  }
  const tool = name as AssistantToolName;
  switch (tool) {
    case "read_source":
      return await readSource(args.url, ctx);
    case "search_library":
      return await searchLibrary(args.query, ctx);
    case "get_word_history":
      return await getWordHistory(args.word, ctx);
  }
}

/** At most this many tools run for one question. A plan longer than this is a
 *  model exploring rather than answering, and each entry costs a round trip. */
export const MAX_TOOL_CALLS = 2;

export interface PlannedCall {
  name: string;
  args: Record<string, unknown>;
}

/** Execute a plan, in order, and pair each result with the call that made it. */
export async function executePlan(
  plan: PlannedCall[],
  ctx: ToolContext,
): Promise<Array<{ name: string; args: Record<string, unknown>; result: ToolResult }>> {
  const out: Array<{ name: string; args: Record<string, unknown>; result: ToolResult }> = [];
  for (const call of plan.slice(0, MAX_TOOL_CALLS)) {
    if (!call || typeof call.name !== "string") continue;
    const args = call.args && typeof call.args === "object" ? call.args : {};
    out.push({ name: call.name, args, result: await executeAssistantTool(call.name, args, ctx) });
  }
  return out;
}
