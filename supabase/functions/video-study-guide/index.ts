// video-study-guide — write the per-video study guide the debrief runs on.
//
// Two ways in:
//
//   { videoId, force? }                 one video. The ingest pipeline calls
//                                       this once a transcript is final; a
//                                       content manager can also force a
//                                       rewrite after editing a transcript.
//   { action: "backfill", limit?, after? }
//                                       the library that predates the
//                                       debrief. Works through published
//                                       videos with no guide in id order, a
//                                       few per call, and returns a cursor;
//                                       the admin page loops until
//                                       `remaining` is 0. Admin only — it
//                                       bills one model call per video.
//
// The guide itself, and why a debrief wants one, is described in
// `_shared/videoDebriefCore.ts` and `_shared/videoStudyGuide.ts`.
import { getCorsHeaders } from "../_shared/cors.ts";
import { requireAdmin, requireContentManager } from "../_shared/requireRole.ts";
import { spokenLines } from "../_shared/videoDebriefCore.ts";
import {
  ensureStudyGuide,
  STUDY_GUIDE_VIDEO_COLUMNS,
  studyGuideAdmin,
  type StudyGuideVideo,
} from "../_shared/videoStudyGuide.ts";

/** Guides per backfill call: each is one model call, and the request has a wall clock. */
const BACKFILL_DEFAULT = 2;
const BACKFILL_MAX = 4;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface Outcome {
  id: string;
  status: "generated" | "current" | "no_transcript" | "failed" | "not_found";
  stored?: boolean;
}

async function prepareOne(videoId: string, force: boolean): Promise<Outcome> {
  const { data, error } = await studyGuideAdmin()
    .from("discover_videos")
    .select(STUDY_GUIDE_VIDEO_COLUMNS)
    .eq("id", videoId)
    .maybeSingle();
  if (error || !data) return { id: videoId, status: "not_found" };
  const video = data as StudyGuideVideo;
  const lines = spokenLines(video.transcript_lines);
  if (lines.length === 0) return { id: videoId, status: "no_transcript" };
  const ensured = await ensureStudyGuide(video, lines, { force });
  if (!ensured) return { id: videoId, status: "failed" };
  return { id: videoId, status: ensured.generated ? "generated" : "current", stored: ensured.stored };
}

/** PostgREST answers at most this many rows per request, so listings are paged. */
const PAGE = 1000;

/** Every row of a one-column listing, page by page. */
async function allRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { data: rows, error };
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE) return { data: rows, error: null };
  }
}

async function backfill(limit: number, after: string | null, corsHeaders: Record<string, string>) {
  const supabase = studyGuideAdmin();
  const [videos, guides] = await Promise.all([
    allRows<{ id: string }>((from, to) =>
      supabase.from("discover_videos").select("id").eq("published", true).order("id", { ascending: true }).range(from, to)
    ),
    allRows<{ video_id: string }>((from, to) =>
      supabase.from("video_study_guides").select("video_id").order("video_id", { ascending: true }).range(from, to)
    ),
  ]);
  if (videos.error) return json({ error: videos.error.message }, 500, corsHeaders);
  if (guides.error) {
    // The one failure the admin can act on, so it is named.
    return json(
      {
        error: "guide_table_missing",
        message: "video_study_guides is not readable — apply migration 20261004120000_video_debrief to the project.",
      },
      503,
      corsHeaders,
    );
  }

  const have = new Set(guides.data.map((g) => g.video_id));
  const missing = videos.data
    .map((v) => v.id)
    .filter((id) => !have.has(id))
    .sort();
  // The cursor, not the missing list, is what guarantees the loop ends: a
  // video with no transcript is never going to get a guide, and without a
  // cursor it would be "remaining" on every call forever.
  const queue = after ? missing.filter((id) => id > after) : missing;
  const batch = queue.slice(0, limit);

  const results: Outcome[] = [];
  for (const id of batch) {
    results.push(await prepareOne(id, false));
  }
  const storeFailed = results.some((r) => r.status === "generated" && r.stored === false);
  return json(
    {
      ok: true,
      results,
      cursor: batch.length ? batch[batch.length - 1] : after,
      remaining: queue.length - batch.length,
      storeFailed,
    },
    200,
    corsHeaders,
  );
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // An empty body is answered by the validation below.
  }

  try {
    if (body.action === "backfill") {
      const gate = await requireAdmin(req, corsHeaders);
      if (gate.denied) return gate.response;
      const requested = Number(body.limit ?? BACKFILL_DEFAULT);
      const limit = Math.max(1, Math.min(BACKFILL_MAX, Number.isFinite(requested) ? Math.floor(requested) : BACKFILL_DEFAULT));
      const after = typeof body.after === "string" && UUID.test(body.after) ? body.after : null;
      return await backfill(limit, after, corsHeaders);
    }

    const gate = await requireContentManager(req, corsHeaders);
    if (gate.denied) return gate.response;
    const videoId = typeof body.videoId === "string" ? body.videoId : "";
    if (!UUID.test(videoId)) return json({ error: "videoId is required" }, 400, corsHeaders);

    const outcome = await prepareOne(videoId, body.force === true);
    const status = outcome.status === "not_found" ? 404 : outcome.status === "failed" ? 502 : 200;
    return json(outcome, status, corsHeaders);
  } catch (e) {
    console.error("video-study-guide error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500, corsHeaders);
  }
});
