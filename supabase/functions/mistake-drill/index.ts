/**
 * mistake-drill
 *
 * Targeted drills over the learner's own fossilized errors. Errors persist
 * because they rarely impede communication enough to be corrected
 * (docs/plateau-research-2026-09.md §1 — Richards' fifth plateau feature via
 * the noticing literature), so this puts each one where it cannot be missed:
 * a forced choice between the correct form and the learner's OWN recorded
 * production, then a produce step. Only clean production resolves the error —
 * picking the right answer is noticing, saying/writing it is knowing.
 *
 * Actions:
 *   { action: "items", dialect, length? }
 *     Groups the caller's unresolved learner_errors, asks the brain for a
 *     one-line situation + gloss + one extra distractor per target, and
 *     returns choice items. The learner's own erroneous production is always
 *     one of the choices when it exists — that juxtaposition is the salience
 *     the output research says the task must supply (§2, Nassif 2019).
 *
 *   { action: "produce", dialect, targetArabic, produced }
 *     Checks the learner's typed production against the target by normalised
 *     Arabic similarity. A match resolves every unresolved error on that
 *     target (the weak set must decay); a miss records one mistake_drill
 *     error — the fossil is still live.
 *
 * enforceDailyCap is the authorization decision: signed-in callers only,
 * acting on their own error corpus.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import { getDialectLabel, type Dialect } from "../_shared/dialectHelpers.ts";
import {
  recordLearnerErrors,
  resolveLearnerErrors,
} from "../_shared/learnerErrors.ts";
import { arabicSimilarity, normalizeArabic } from "../_shared/arabicMatch.ts";

const KNOWN_DIALECTS = new Set(["Gulf", "Egyptian", "Yemeni"]);
const DEFAULT_LENGTH = 6;
const MAX_LENGTH = 10;
/** Recent unresolved rows considered. Matches the /mistakes page's window. */
const ERROR_WINDOW = 300;
/** Similarity at which a typed production counts as the target, said right. */
const PRODUCE_ACCEPT = 0.85;

interface DrillChoice {
  arabic: string;
  correct: boolean;
  /** True when this wrong answer is the learner's own recorded production. */
  yours?: boolean;
}

interface DrillItem {
  target_arabic: string;
  target_english: string;
  scenario_english: string;
  explanation: string;
  choices: DrillChoice[];
  kinds: string[];
  /** How many unresolved errors this target carries. */
  count: number;
}

interface GeneratedTarget {
  target_arabic: string;
  target_english: string;
  scenario_english: string;
  explanation: string;
  distractor_arabic: string;
}

function jsonResponse(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/** Deterministic-ish shuffle so the correct answer isn't always first. */
function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface ErrorGroup {
  target: string;
  attempts: string[];
  kinds: string[];
  count: number;
}

/** Group unresolved rows by target, most-frequent first. */
function groupErrors(
  rows: Array<{ target_arabic?: unknown; produced_arabic?: unknown; error_kind?: unknown }>,
): ErrorGroup[] {
  const byTarget = new Map<string, ErrorGroup>();
  for (const row of rows) {
    const target = typeof row.target_arabic === "string" ? row.target_arabic.trim() : "";
    if (!target) continue;
    const group = byTarget.get(target) ?? { target, attempts: [], kinds: [], count: 0 };
    group.count += 1;
    const produced = typeof row.produced_arabic === "string" ? row.produced_arabic.trim() : "";
    // A "production" identical to the target after normalisation is ASR noise,
    // not a distractor — offering it as a wrong answer would show the learner
    // two right answers.
    if (
      produced &&
      normalizeArabic(produced) !== normalizeArabic(target) &&
      !group.attempts.includes(produced)
    ) {
      group.attempts.push(produced);
    }
    const kind = typeof row.error_kind === "string" ? row.error_kind : "other";
    if (!group.kinds.includes(kind)) group.kinds.push(kind);
    byTarget.set(target, group);
  }
  return [...byTarget.values()].sort((a, b) => b.count - a.count);
}

async function generateItems(
  dialect: Dialect,
  groups: ErrorGroup[],
): Promise<DrillItem[]> {
  const brain = await askBrain<{ targets: GeneratedTarget[] }>({
    purpose: "mistake_drill",
    dialect,
    strategy: "solo",
    temperature: 0.6,
    maxTokens: 2048,
    systemPromptExtra: `You build drill cards for ${getDialectLabel(dialect)} words and phrases a learner keeps getting wrong.

For EACH target below, return:
- target_arabic: the target exactly as given (do not "improve" it).
- target_english: a natural English gloss.
- scenario_english: ONE short line of situation in English where saying the target is exactly right (e.g. "A friend hands you your coffee.").
- explanation: one short, encouraging English sentence on what makes the target correct in this dialect${groups.some((g) => g.attempts.length > 0) ? ", contrasted with the learner's own version where one is given" : ""}.
- distractor_arabic: ONE plausible but wrong alternative in Arabic script — a near-miss a learner of this dialect actually produces (an MSA form, a wrong preposition, a close-sounding word). Never a second correct way of saying it.

Targets:
${groups.map((g, i) => `${i + 1}. ${g.target}${g.attempts.length > 0 ? ` — the learner has said: ${g.attempts.join("، ")}` : ""}`).join("\n")}

Return ONLY the structured fields via the provided tool, one entry per target, in the same order.`,
    userPrompt: `Build the drill cards.`,
    arabicTextPath: (p) =>
      ((p as { targets?: GeneratedTarget[] } | null)?.targets ?? [])
        .map((t) => t?.distractor_arabic ?? "")
        .join("\n"),
    tool: {
      name: "emit_drill_targets",
      description: "One drill card per target the learner keeps missing.",
      parameters: {
        type: "object",
        properties: {
          targets: {
            type: "array",
            items: {
              type: "object",
              properties: {
                target_arabic: { type: "string" },
                target_english: { type: "string" },
                scenario_english: { type: "string" },
                explanation: { type: "string" },
                distractor_arabic: { type: "string" },
              },
              required: [
                "target_arabic",
                "target_english",
                "scenario_english",
                "explanation",
                "distractor_arabic",
              ],
            },
          },
        },
        required: ["targets"],
      },
    },
  });

  const generated = brain.output?.targets ?? [];
  // Join on the normalised target rather than trusting order — a model that
  // reorders or drops an entry must not attach the wrong scenario to a target.
  const byTarget = new Map(
    generated
      .filter((t) => typeof t?.target_arabic === "string")
      .map((t) => [normalizeArabic(t.target_arabic), t] as const),
  );

  const items: DrillItem[] = [];
  for (const group of groups) {
    const gen = byTarget.get(normalizeArabic(group.target));
    if (!gen) continue;

    const choices: DrillChoice[] = [{ arabic: group.target, correct: true }];
    // The learner's own version first: that juxtaposition is the drill.
    if (group.attempts.length > 0) {
      choices.push({ arabic: group.attempts[0], correct: false, yours: true });
    }
    const distractor = gen.distractor_arabic?.trim();
    if (
      distractor &&
      normalizeArabic(distractor) !== normalizeArabic(group.target) &&
      !choices.some((c) => normalizeArabic(c.arabic) === normalizeArabic(distractor))
    ) {
      choices.push({ arabic: distractor, correct: false });
    }
    if (choices.length < 2) continue; // nothing to choose between

    items.push({
      target_arabic: group.target,
      target_english: gen.target_english ?? "",
      scenario_english: gen.scenario_english ?? "",
      explanation: gen.explanation ?? "",
      choices: shuffle(choices),
      kinds: group.kinds,
      count: group.count,
    });
  }
  return items;
}

serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = await req.json().catch(() => ({}));
    const action: string = (body?.action as string) || "items";
    const rawDialect: string = (body?.dialect as string) || "Gulf";
    const dialect = (KNOWN_DIALECTS.has(rawDialect) ? rawDialect : "Gulf") as Dialect;

    // One shared ladder for both actions. The produce check is cheap, but it
    // is also the write path that resolves errors — it must not be anonymous.
    const cap = await enforceDailyCap(req, "mistake-drill", 30, cors, {
      standard: 100,
      allin: 300,
    });
    if (cap.limited) return cap.response;

    if (action === "produce") {
      const target = String(body?.targetArabic ?? "").trim();
      const produced = String(body?.produced ?? "").trim();
      if (!target || !produced) {
        return jsonResponse({ error: "targetArabic and produced are required" }, 400, cors);
      }

      const similarity = arabicSimilarity(produced, target);
      const accepted = similarity >= PRODUCE_ACCEPT;
      if (accepted) {
        // Clean production is what resolves a fossil — awaited so the learner
        // sees the card leave the list when the page refetches.
        await resolveLearnerErrors(cap.userId, target, dialect);
      } else {
        await recordLearnerErrors(cap.userId, [{
          source: "mistake_drill",
          dialect,
          targetArabic: target,
          producedArabic: produced,
          errorKind: "wrong_word",
          detail: { similarity },
        }]);
      }
      return jsonResponse({ accepted, similarity }, 200, cors);
    }

    if (action !== "items") {
      return jsonResponse({ error: "unknown_action" }, 400, cors);
    }

    const length = Math.min(MAX_LENGTH, Math.max(1, Number(body?.length) || DEFAULT_LENGTH));

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: rows, error } = await admin
      .from("learner_errors")
      .select("target_arabic, produced_arabic, error_kind")
      .eq("user_id", cap.userId)
      .eq("dialect", dialect)
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(ERROR_WINDOW);
    if (error) throw error;

    const groups = groupErrors(rows ?? []).slice(0, length);
    if (groups.length === 0) {
      return jsonResponse({ items: [] }, 200, cors);
    }

    const items = await generateItems(dialect, groups);
    return jsonResponse({ items }, 200, cors);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("mistake-drill error:", msg);
    return jsonResponse({ error: msg }, 500, cors);
  }
});
