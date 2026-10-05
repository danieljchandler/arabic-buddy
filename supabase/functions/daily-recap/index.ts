// daily-recap — go over a learner's yesterday (or last week) in the app with
// the tutor, the next morning.
//
// Four actions, one body shape `{ action, dialect, localDate, tzOffsetMinutes, … }`:
//
//   summary  → is there anything to recap, and what: counts and a headline for
//              the strip at the bottom of the screen, plus whether today's
//              session was already done. Model-free; any signed-in learner.
//   plan     → the session: its steps, the quiz on the learner's own words,
//              the slips to fix, the lines to shadow, and the notes the tutor
//              will read from. Built once per learner, dialect and local day
//              and stored in learner_recaps; rebuilt identically when it
//              cannot be stored. Subscribers only.
//   chat     → one streamed tutor turn for `step`, given the conversation so far.
//   complete → record how the session went.
//
// The client says only what its clock reads (its local date and UTC offset),
// which dialect, which step, and what was said. Everything the tutor knows
// about the learner's day is read here from the database — the window is
// never taken from the body.
import { getCorsHeaders } from "../_shared/cors.ts";
import { requireActiveSubscription, resolveUserId } from "../_shared/usageCap.ts";
import { BrainHttpError, streamBrain } from "../_shared/aiBrain.ts";
import { DEFAULT_CHAT } from "../_shared/modelRegistry.ts";
import { getDialectLabel, type Dialect } from "../_shared/dialectHelpers.ts";
import { buildLearnerProfile, renderProfileForPrompt } from "../_shared/learnerProfile.ts";
import { studyGuideAdmin } from "../_shared/videoStudyGuide.ts";
import { resolveRecapWindow } from "../_shared/recapWindow.ts";
import {
  buildRecapPlan,
  countWindow,
  isRecapStep,
  parseStoredPlan,
  planArabicSources,
  recapBounds,
  recapHeadline,
  recapStepKickoff,
  recapSystemPrompt,
  sanitizeOutcome,
  windowHasContent,
  type RecapPlan,
} from "../_shared/recapCore.ts";

const KNOWN_DIALECTS = new Set(["Gulf", "Egyptian", "Yemeni"]);
/** Turns of history a request may carry, and characters per turn. */
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 2000;
/** Words the quiz asks about, and lines the learner shadows. */
const QUIZ_SIZE = 6;
const SHADOW_COUNT = 2;

const PAYWALL = "Going over your day with the tutor is available on a paid plan.";
const NOTHING = "Nothing to go over yet — watch a clip or save a few words, and tomorrow's recap will be waiting.";

type RecapStatus = "ready" | "completed";

interface StoredRecap {
  plan: RecapPlan;
  status: RecapStatus;
}

function json(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function dialectOf(body: Record<string, unknown>): Dialect {
  return typeof body.dialect === "string" && KNOWN_DIALECTS.has(body.dialect) ? body.dialect : "Gulf";
}

/** Today's stored session for this learner and dialect, if the table exists and holds one. */
async function loadRecap(userId: string, dialect: string, date: string): Promise<StoredRecap | null> {
  try {
    const { data, error } = await studyGuideAdmin()
      .from("learner_recaps")
      .select("plan, status")
      .eq("user_id", userId)
      .eq("dialect", dialect)
      .eq("recap_date", date)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as { plan: unknown; status: string };
    const plan = parseStoredPlan(row.plan);
    if (!plan) return null;
    return { plan, status: row.status === "completed" ? "completed" : "ready" };
  } catch (err) {
    console.warn("[daily-recap] stored recap unavailable:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Keep the plan, so every later turn and the strip read the same session. False when it could not be kept. */
async function storeRecap(userId: string, plan: RecapPlan): Promise<boolean> {
  try {
    const { error } = await studyGuideAdmin()
      .from("learner_recaps")
      .upsert(
        {
          user_id: userId,
          dialect: plan.dialect,
          recap_date: plan.date,
          window_days: plan.windowDays,
          plan,
          status: "ready",
          outcome: null,
          completed_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,dialect,recap_date" },
      );
    if (error) {
      console.warn("[daily-recap] plan not stored:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[daily-recap] plan not stored:", err instanceof Error ? err.message : err);
    return false;
  }
}

async function completeRecap(userId: string, dialect: string, date: string, outcome: unknown): Promise<boolean> {
  try {
    const { data, error } = await studyGuideAdmin()
      .from("learner_recaps")
      .update({ status: "completed", outcome, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("dialect", dialect)
      .eq("recap_date", date)
      .select("id");
    if (error) {
      console.warn("[daily-recap] completion not stored:", error.message);
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  } catch (err) {
    console.warn("[daily-recap] completion not stored:", err instanceof Error ? err.message : err);
    return false;
  }
}

/** The learner's level in this dialect, and their profile block for the prompt. */
async function learnerContext(userId: string, dialect: Dialect) {
  try {
    const profile = await buildLearnerProfile({ userId, dialect });
    return {
      level: profile.level,
      block: renderProfileForPrompt(profile, { includeWeak: false, includeInterests: true }),
    };
  } catch (e) {
    console.warn("[daily-recap] profile unavailable:", e instanceof Error ? e.message : e);
    return { level: null, block: "" };
  }
}

function cleanMessages(raw: unknown): Array<{ role: "user" | "assistant"; content: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: (m.content as string).slice(0, MAX_MESSAGE_CHARS),
    }))
    .filter((m) => m.content.trim().length > 0)
    .slice(-MAX_MESSAGES);
}

/**
 * Today's plan: the stored one, or a fresh one from the window.
 *
 * Null when there is nothing to recap. `stored` says whether the plan is in
 * the table — false on a project that has not applied the migration, where
 * the same plan is simply rebuilt on each request.
 */
async function planFor(
  userId: string,
  dialect: Dialect,
  input: { localDate?: unknown; tzOffsetMinutes?: unknown },
): Promise<{ plan: RecapPlan; status: RecapStatus; stored: boolean } | null> {
  const today = recapBounds({ ...input, days: 1 }).localDate;
  const existing = await loadRecap(userId, dialect, today);
  if (existing) return { ...existing, stored: true };

  const [window, learner] = await Promise.all([
    resolveRecapWindow({ userId, dialect, input, depth: "full", prepareGuides: 1 }),
    learnerContext(userId, dialect),
  ]);
  if (!windowHasContent(window)) return null;
  const plan = buildRecapPlan(window, {
    level: learner.level,
    // Seeded by learner and day, so the quiz the plan showed is the quiz the
    // chat is told about on every later turn, stored or not.
    seed: `${userId}:${window.bounds.localDate}`,
    quizSize: QUIZ_SIZE,
    shadowCount: SHADOW_COUNT,
  });
  const stored = await storeRecap(userId, plan);
  return { plan, status: "ready", stored };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = body.action;
    if (action !== "summary" && action !== "plan" && action !== "chat" && action !== "complete") {
      return json({ error: "action must be summary, plan, chat or complete" }, 400, corsHeaders);
    }
    const dialect = dialectOf(body);
    const input = { localDate: body.localDate, tzOffsetMinutes: body.tzOffsetMinutes };

    if (action === "summary") {
      const userId = await resolveUserId(req);
      if (!userId) {
        return json({ error: "auth_required", message: "Please sign in to see your recap." }, 401, corsHeaders);
      }
      const window = await resolveRecapWindow({ userId, dialect, input, depth: "counts" });
      const counts = countWindow(window);
      const hasContent = windowHasContent(window);
      const stored = hasContent ? await loadRecap(userId, dialect, window.bounds.localDate) : null;
      return json(
        {
          date: window.bounds.localDate,
          windowDays: window.bounds.days,
          hasContent,
          counts,
          headline: recapHeadline(counts, window.bounds.days, window.challenge),
          firstVideo: window.videos[0]?.title ?? null,
          status: stored?.status ?? "none",
        },
        200,
        corsHeaders,
      );
    }

    const gate = await requireActiveSubscription(req, corsHeaders, PAYWALL);
    if (gate.limited) return gate.response;
    const userId = gate.userId;

    if (action === "complete") {
      const today = recapBounds({ ...input, days: 1 }).localDate;
      const outcome = sanitizeOutcome(body.outcome);
      const stored = await completeRecap(userId, dialect, today, outcome);
      return json({ stored, date: today }, 200, corsHeaders);
    }

    const session = await planFor(userId, dialect, input);
    if (!session) return json({ error: "nothing_to_recap", message: NOTHING }, 422, corsHeaders);
    const { plan } = session;

    if (action === "plan") {
      return json({ ...plan, status: session.status, stored: session.stored }, 200, corsHeaders);
    }

    const step = body.step;
    if (!isRecapStep(step)) return json({ error: "step is required" }, 400, corsHeaders);
    const messages = cleanMessages(body.messages);
    // A step opens with the tutor speaking, so there is no learner message to
    // answer yet; this stands in for one.
    if (messages.length === 0 || messages[messages.length - 1].role === "assistant") {
      messages.push({ role: "user", content: recapStepKickoff(step) });
    }
    const learner = await learnerContext(userId, dialect);

    return await streamBrain({
      purpose: "daily_recap",
      dialect,
      messages,
      systemPromptExtra: recapSystemPrompt({
        step,
        plan: plan.steps.includes(step) ? plan : { ...plan, steps: [...plan.steps, step] },
        dialectLabel: getDialectLabel(dialect),
        learnerBlock: learner.block,
      }),
      model: DEFAULT_CHAT,
      temperature: 0.6,
      maxTokens: step === "recap" ? 900 : 600,
      responseHeaders: corsHeaders,
      signal: req.signal,
      // Judge only the Arabic the tutor wrote. The videos' lines are native
      // speakers' own words, the slips are the learner's, and so are their messages.
      nativeReview: {
        sources: [...planArabicSources(plan), ...messages.filter((m) => m.role === "user").map((m) => m.content)],
      },
    });
  } catch (err) {
    if (err instanceof BrainHttpError) {
      if (err.status === 429) return json({ error: "Rate limit reached. Please try again in a moment." }, 429, corsHeaders);
      if (err.status === 402) return json({ error: "AI credits exhausted. Please add credits in Settings." }, 402, corsHeaders);
    }
    console.error("daily-recap error", err);
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500, corsHeaders);
  }
});
