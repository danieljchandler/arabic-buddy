// Clip pipeline, stage 4: the verification stack.
//
// Replaces "a human reviews every clip" with independent cheap verifiers that
// only escalate on disagreement:
//
//   term        does the target word actually sit in the line (word-boundary,
//               normalized) — a hard fail, mining noise never advances
//   markers     dialect/MSA scoring over the line plus its ±20s context
//               window, so an MSA-drifting intro can't smuggle a clip in
//   playability embeddable + availability + the 1.2-10s clip window
//   judge       one short askBrain call (UTILITY lineup, solo, no repair
//               pass): is this the claimed dialect, does it say the target,
//               is it family-friendly and beginner-usable
//
// Tiering: any hard fail → rejected; every check green → verified; anything
// else → needs_review, which is the human audit queue. The full per-check
// evidence is written to clip_candidates.verification so the audit UI can
// show *why* a clip was held and thresholds can be re-tuned over history.
//
// Gated to content managers, plus the CLIP_PIPELINE_SECRET header for the
// scheduled automation loop.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { hasSharedSecret } from "../_shared/requireRole.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import { getLineup } from "../_shared/modelRegistry.ts";
import { normalizeArabic } from "../_shared/msaLeakDetector.ts";
import { scoreDialectMarkers, type MarkerDialect } from "../_shared/dialectMarkers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

let cached: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!cached) {
    cached = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

function json(body: unknown, status = 200, corsHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function isContentManager(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return false;
  const { data: userData, error } = await admin().auth.getUser(token);
  if (error || !userData?.user?.id) return false;
  const { data: roles } = await admin()
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id)
    .in("role", ["admin", "content_reviewer"]);
  return Array.isArray(roles) && roles.length > 0;
}

async function hasPipelineSecret(req: Request): Promise<boolean> {
  return await hasSharedSecret(req, "x-pipeline-secret", "CLIP_PIPELINE_SECRET");
}

interface CandidateRow {
  id: string;
  concept_id: string | null;
  video_id: string;
  caption_line_id: string | null;
  start_ms: number;
  end_ms: number;
  status: string;
  verification: Record<string, unknown>;
  channel_videos: {
    id: string;
    yt_video_id: string;
    availability: string;
    embeddable: boolean | null;
    content_channels: { id: string; name: string; dialect: string };
  };
}

interface JudgeVerdict {
  is_target_dialect: boolean;
  contains_target: boolean;
  family_friendly: boolean;
  beginner_friendly: boolean;
  reason: string;
}

const MIN_CLIP_MS = 1200;
const MAX_CLIP_MS = 10000;
// A line whose ±20s context scores this much MSA is probably a scripted
// voice-over moment, whatever the channel's overall vetting said.
const MSA_CEILING = 0.3;

function containsTerm(normalizedLine: string, normalizedTerm: string): boolean {
  if (!normalizedTerm) return false;
  const esc = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\s\\p{P}])${esc}($|[\\s\\p{P}])`, "u").test(normalizedLine);
}

/** The candidate's target terms: its concept's realizations for the dialect. */
async function targetTerms(conceptId: string | null, dialect: string): Promise<string[]> {
  if (!conceptId) return [];
  const { data } = await admin()
    .from("concept_realizations")
    .select("surface, variants")
    .eq("concept_id", conceptId)
    .eq("dialect", dialect);
  const terms: string[] = [];
  for (const row of (data ?? []) as Array<{ surface: string; variants: string[] }>) {
    terms.push(row.surface, ...(row.variants ?? []));
  }
  return terms.map(normalizeArabic).filter(Boolean);
}

/** Line text plus its ±20s neighbours — the marker scorer's context window. */
async function contextWindow(candidate: CandidateRow): Promise<{ line: string; context: string }> {
  const { data } = await admin()
    .from("caption_lines")
    .select("id, start_ms, text")
    .eq("video_id", candidate.video_id)
    .gte("start_ms", candidate.start_ms - 20000)
    .lte("start_ms", candidate.end_ms + 20000)
    .order("start_ms", { ascending: true });
  const rows = (data ?? []) as Array<{ id: string; start_ms: number; text: string }>;
  const line = rows.find((r) => r.id === candidate.caption_line_id)?.text ??
    rows.find((r) => r.start_ms === candidate.start_ms)?.text ?? "";
  return { line, context: rows.map((r) => r.text).join(" ") };
}

async function runJudge(
  lineText: string,
  contextText: string,
  dialect: string,
  targetGloss: string | null,
): Promise<{ verdict: JudgeVerdict | null; error?: string }> {
  try {
    const brain = await askBrain<JudgeVerdict>({
      purpose: "clip_verification",
      dialect,
      strategy: "solo",
      models: [...getLineup("UTILITY").drafters],
      skipRepair: true,
      maxTokens: 512,
      temperature: 0,
      userPrompt:
        `You are auditing a 5-10 second video clip candidate for a beginner ${dialect} Arabic course.\n` +
        `Caption line of the clip: «${lineText}»\n` +
        `Surrounding transcript context: «${contextText.slice(0, 1200)}»\n` +
        (targetGloss ? `The clip should teach the word/phrase meaning: "${targetGloss}".\n` : "") +
        `Judge the CAPTION LINE (the context is only evidence about the speaker):\n` +
        `- is_target_dialect: is the speech ${dialect} Arabic (not MSA, not another dialect)?\n` +
        (targetGloss
          ? `- contains_target: does the line actually use that word/phrase in its normal sense?\n`
          : `- contains_target: true (no target specified).\n`) +
        `- family_friendly: free of profanity, slurs, adult or violent content?\n` +
        `- beginner_friendly: short, concrete, usable as a model sentence for an A1 learner?`,
      tool: {
        name: "emit_clip_verdict",
        description: "Verdict on one clip candidate.",
        parameters: {
          type: "object",
          properties: {
            is_target_dialect: { type: "boolean" },
            contains_target: { type: "boolean" },
            family_friendly: { type: "boolean" },
            beginner_friendly: { type: "boolean" },
            reason: { type: "string", description: "One sentence." },
          },
          required: [
            "is_target_dialect",
            "contains_target",
            "family_friendly",
            "beginner_friendly",
            "reason",
          ],
        },
      },
    });
    const v = brain.output;
    if (!v || typeof v.is_target_dialect !== "boolean") {
      return { verdict: null, error: "judge returned no verdict" };
    }
    return { verdict: v };
  } catch (e) {
    return { verdict: null, error: e instanceof Error ? e.message : "judge failed" };
  }
}

async function verifyOne(candidate: CandidateRow): Promise<string> {
  const dialect = candidate.channel_videos.content_channels.dialect as MarkerDialect;
  const { line, context } = await contextWindow(candidate);
  const normalizedLine = normalizeArabic(line);

  // ---- term ----
  const terms = await targetTerms(candidate.concept_id, dialect);
  const minedTerm = (candidate.verification as { mined?: { term?: string } })?.mined?.term;
  if (minedTerm) terms.push(normalizeArabic(minedTerm));
  const matched = terms.find((t) => containsTerm(normalizedLine, t)) ?? null;
  const termCheck = { pass: terms.length === 0 ? false : matched !== null, matched, terms };

  // ---- markers ----
  const lineScore = scoreDialectMarkers(line);
  const contextScore = scoreDialectMarkers(context);
  const confidentMisfit = contextScore.best !== null &&
    contextScore.best !== dialect && contextScore.confidence >= 0.5;
  const markerCheck = {
    pass: contextScore.msaScore < MSA_CEILING && !confidentMisfit,
    lineDialect: lineScore.dialectScores[dialect],
    lineMsa: lineScore.msaScore,
    contextMsa: contextScore.msaScore,
    contextBest: contextScore.best,
    contextConfidence: contextScore.confidence,
  };

  // ---- playability ----
  const durationMs = candidate.end_ms - candidate.start_ms;
  const embeddable = candidate.channel_videos.embeddable;
  const availability = candidate.channel_videos.availability;
  const playabilityCheck = {
    pass: embeddable !== false && availability !== "unavailable" &&
      durationMs >= MIN_CLIP_MS && durationMs <= MAX_CLIP_MS,
    embeddable,
    availability,
    durationMs,
  };

  // ---- judge ----
  let gloss: string | null = null;
  if (candidate.concept_id) {
    const { data } = await admin()
      .from("vocab_concepts")
      .select("english_gloss")
      .eq("id", candidate.concept_id)
      .maybeSingle();
    gloss = (data as { english_gloss?: string } | null)?.english_gloss ?? null;
  }
  const { verdict, error: judgeError } = await runJudge(line, context, dialect, gloss);

  // ---- tier ----
  // Hard fails end the candidate: mining noise (term absent), a video that
  // cannot be embedded, or content the judge calls unsafe.
  let status: "verified" | "needs_review" | "rejected";
  if (
    !termCheck.pass ||
    embeddable === false || availability === "unavailable" ||
    verdict?.family_friendly === false
  ) {
    status = "rejected";
  } else if (
    playabilityCheck.pass && markerCheck.pass &&
    verdict !== null && verdict.is_target_dialect &&
    verdict.contains_target && verdict.beginner_friendly
  ) {
    status = "verified";
  } else {
    // A judge outage lands here too: nothing auto-publishes unjudged.
    status = "needs_review";
  }

  const { error: updateErr } = await admin()
    .from("clip_candidates")
    .update({
      status,
      verification: {
        ...(candidate.verification ?? {}),
        term: termCheck,
        markers: markerCheck,
        playability: playabilityCheck,
        judge: verdict ?? { error: judgeError ?? "unavailable" },
        decidedAt: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    } as unknown as never)
    .eq("id", candidate.id);
  if (updateErr) throw new Error(`clip_candidates update failed: ${updateErr.message}`);
  return status;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!(await hasPipelineSecret(req)) && !(await isContentManager(req))) {
      return json({ error: "content_manager_required" }, 403, corsHeaders);
    }

    const body = await req.json().catch(() => ({}));
    const candidateId = typeof body.candidateId === "string" ? body.candidateId : null;
    // Sweep mode is bounded per run; the caller loops until pending: 0.
    const limit = Math.max(1, Math.min(20, Number(body.limit) || 5));

    let query = admin()
      .from("clip_candidates")
      .select(
        "id, concept_id, video_id, caption_line_id, start_ms, end_ms, status, verification, " +
          "channel_videos!inner(id, yt_video_id, availability, embeddable, " +
          "content_channels!inner(id, name, dialect))",
      )
      .order("created_at", { ascending: true })
      .limit(limit);
    query = candidateId ? query.eq("id", candidateId) : query.eq("status", "pending");

    const { data, error } = await query;
    if (error) throw new Error(`clip_candidates fetch failed: ${error.message}`);
    const candidates = (data ?? []) as unknown as CandidateRow[];
    if (candidates.length === 0) {
      return json({ processed: 0, note: "no pending candidates" }, 200, corsHeaders);
    }

    const outcomes: Record<string, number> = {};
    for (const candidate of candidates) {
      const status = await verifyOne(candidate);
      outcomes[status] = (outcomes[status] ?? 0) + 1;
    }

    const { count: pending } = await admin()
      .from("clip_candidates")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");

    return json({ processed: candidates.length, outcomes, pending: pending ?? 0 }, 200, corsHeaders);
  } catch (e) {
    console.error("[verify-clip-candidate] error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500, corsHeaders);
  }
});
