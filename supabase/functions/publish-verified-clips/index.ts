// Clip pipeline, stage 5: publication.
//
// Moves candidates the verification stack marked 'verified' onto the
// learner-facing surface (published_clips). Playback needs only the YouTube
// id and window — the official iframe embed does the rest — so publication's
// real work is producing the learner-visible text: the caption line's
// translation and a transliteration, generated here with one TRANSLATION-
// lineup call per clip. A clip whose translation fails is left 'verified'
// and reported, never published untranslated.
//
// The ingested source video (if any) deliberately stays out of the Discover
// feed: 4 good seconds do not vouch for the other 10 minutes.
//
// Gated like the rest of the pipeline: content managers, or the service-role
// key + CLIP_PIPELINE_SECRET header for the automation loop.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import { getLineup } from "../_shared/modelRegistry.ts";

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

function hasPipelineSecret(req: Request): boolean {
  const secret = Deno.env.get("CLIP_PIPELINE_SECRET");
  if (!secret) return false;
  return req.headers.get("x-pipeline-secret") === secret;
}

interface VerifiedCandidate {
  id: string;
  concept_id: string | null;
  caption_line_id: string | null;
  start_ms: number;
  end_ms: number;
  verification: {
    mined?: { term?: string; line_text?: string };
    term?: { matched?: string | null };
  } | null;
  channel_videos: {
    yt_video_id: string;
    content_channels: { name: string; dialect: string };
  };
}

async function translateLine(
  arabic: string,
  dialect: string,
): Promise<{ translation: string; transliteration: string | null } | null> {
  try {
    const brain = await askBrain<{ translation: string; transliteration?: string }>({
      purpose: "clip_translation",
      dialect,
      strategy: "solo",
      models: [...getLineup("TRANSLATION").drafters],
      // Output is English; the MSA repair pass has nothing to repair here.
      skipRepair: true,
      maxTokens: 400,
      temperature: 0.2,
      userPrompt:
        `Translate this spoken ${dialect} Arabic caption line into natural, plain English ` +
        `for a beginner learner, and give a simple Latin transliteration of the Arabic as ` +
        `spoken in ${dialect}:\n\n«${arabic}»`,
      tool: {
        name: "emit_clip_text",
        description: "Translation and transliteration for one caption line.",
        parameters: {
          type: "object",
          properties: {
            translation: { type: "string" },
            transliteration: { type: "string" },
          },
          required: ["translation"],
        },
      },
    });
    const translation = brain.output?.translation?.trim();
    if (!translation) return null;
    return { translation, transliteration: brain.output?.transliteration?.trim() || null };
  } catch (e) {
    console.error("[publish-verified-clips] translation failed", e);
    return null;
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!hasPipelineSecret(req) && !(await isContentManager(req))) {
      return json({ error: "content_manager_required" }, 403, corsHeaders);
    }

    const body = await req.json().catch(() => ({}));
    const candidateId = typeof body.candidateId === "string" ? body.candidateId : null;
    // Each publish spends a translation call; bounded per run, loop to drain.
    const limit = Math.max(1, Math.min(20, Number(body.limit) || 10));

    let query = admin()
      .from("clip_candidates")
      .select(
        "id, concept_id, caption_line_id, start_ms, end_ms, verification, " +
          "channel_videos!inner(yt_video_id, content_channels!inner(name, dialect))",
      )
      .eq("status", "verified")
      .order("created_at", { ascending: true })
      .limit(limit);
    if (candidateId) query = query.eq("id", candidateId);

    const { data, error } = await query;
    if (error) throw new Error(`clip_candidates fetch failed: ${error.message}`);
    const candidates = (data ?? []) as unknown as VerifiedCandidate[];
    if (candidates.length === 0) {
      return json({ published: 0, note: "no verified candidates" }, 200, corsHeaders);
    }

    let published = 0;
    const skipped: Array<{ id: string; reason: string }> = [];

    for (const candidate of candidates) {
      const dialect = candidate.channel_videos.content_channels.dialect;

      // The caption line: mining stored it; older candidates fall back to
      // the index.
      let arabic = candidate.verification?.mined?.line_text ?? "";
      if (!arabic && candidate.caption_line_id) {
        const { data: line } = await admin()
          .from("caption_lines")
          .select("text")
          .eq("id", candidate.caption_line_id)
          .maybeSingle();
        arabic = (line as { text?: string } | null)?.text ?? "";
      }
      const term = candidate.verification?.term?.matched ??
        candidate.verification?.mined?.term ?? "";
      if (!arabic || !term) {
        skipped.push({ id: candidate.id, reason: "missing line text or term" });
        continue;
      }

      let gloss: string | null = null;
      if (candidate.concept_id) {
        const { data: concept } = await admin()
          .from("vocab_concepts")
          .select("english_gloss")
          .eq("id", candidate.concept_id)
          .maybeSingle();
        gloss = (concept as { english_gloss?: string } | null)?.english_gloss ?? null;
      }

      const text = await translateLine(arabic, dialect);
      if (!text) {
        // Left 'verified': the next run retries, and nothing ships without
        // a translation a learner can reveal.
        skipped.push({ id: candidate.id, reason: "translation unavailable" });
        continue;
      }

      const { error: insertErr } = await admin()
        .from("published_clips")
        .upsert(
          {
            clip_candidate_id: candidate.id,
            concept_id: candidate.concept_id,
            dialect,
            yt_video_id: candidate.channel_videos.yt_video_id,
            start_ms: candidate.start_ms,
            end_ms: candidate.end_ms,
            term,
            term_gloss: gloss,
            arabic,
            translation: text.translation,
            transliteration: text.transliteration,
            channel_name: candidate.channel_videos.content_channels.name,
          } as unknown as never,
          { onConflict: "yt_video_id,start_ms,end_ms", ignoreDuplicates: true },
        );
      if (insertErr) throw new Error(`published_clips insert failed: ${insertErr.message}`);

      const { error: updateErr } = await admin()
        .from("clip_candidates")
        .update({ status: "published", updated_at: new Date().toISOString() } as unknown as never)
        .eq("id", candidate.id);
      if (updateErr) throw new Error(`clip_candidates update failed: ${updateErr.message}`);
      published += 1;
    }

    const { count: remaining } = await admin()
      .from("clip_candidates")
      .select("id", { count: "exact", head: true })
      .eq("status", "verified");

    return json(
      { published, skipped, remaining: remaining ?? 0 },
      200,
      corsHeaders,
    );
  } catch (e) {
    console.error("[publish-verified-clips] error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500, corsHeaders);
  }
});
