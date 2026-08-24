// transcript-review — every write a native-speaker reviewer makes.
//
// One function rather than six because it is one privilege: "this person may
// correct a transcript". Splitting it would mean repeating the role check, the
// video lookup and the revision-logging in six places, and the interesting bug
// in a system like this is always the surface that forgot one of them.
//
// Why the client does not write these tables directly:
//
//   The point of the audit trail is that its subject cannot author it. A client
//   that could POST its own `transcript_line_revisions` row could record a
//   "previous value" that was never in the database, and a client that could
//   POST its own `transcript_line_reviews` row could sign off on a line it
//   never opened. So the diff is computed here, against what is actually
//   stored, and the reviewer's identity comes from their JWT rather than from
//   the request body. The RLS policies grant SELECT and nothing else; this
//   function holds the service role.
//
// It is also the only write path a transcriber has to `discover_videos`, which
// is what keeps the role narrow: the column allow-lists below are the whole of
// what a transcriber can change about a video, and `published` is not among
// them.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import { getLineup } from "../_shared/modelRegistry.ts";
import { normalizeDialect } from "../_shared/transcriptDiffCore.ts";
import type { Dialect } from "../_shared/dialectHelpers.ts";
import {
  diffTranscriptRevisions,
  diffVideoField,
  type RevisionSource,
  type TranscriptRevision,
} from "../_shared/transcriptRevisionCore.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Roles allowed to review a transcript. Mirrors `can_review_transcripts()`. */
const REVIEWER_ROLES = ["admin", "content_reviewer", "transcriber"] as const;

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

interface Reviewer {
  userId: string;
  roles: string[];
}

/**
 * Who is asking, and may they review.
 *
 * Reads the role from the database rather than trusting anything in the body —
 * the whole audit trail rests on `changed_by` being the person who actually
 * held the JWT.
 */
async function resolveReviewer(req: Request): Promise<Reviewer | null> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;

  const { data: userData, error } = await admin().auth.getUser(token);
  if (error || !userData?.user?.id) return null;

  const { data: roles } = await admin()
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id)
    .in("role", REVIEWER_ROLES as unknown as string[]);

  if (!Array.isArray(roles) || roles.length === 0) return null;
  return {
    userId: userData.user.id,
    roles: roles.map((r) => String((r as { role: unknown }).role)),
  };
}

interface TranscriptLine {
  id?: string;
  arabic?: string;
  translation?: string;
  literal?: string;
  startMs?: number;
  endMs?: number;
  [key: string]: unknown;
}

interface VideoRow {
  id: string;
  dialect: string | null;
  transcript_lines: unknown;
  cultural_context: string | null;
  grammar_points: unknown;
  vocabulary: unknown;
}

async function loadVideo(videoId: string): Promise<VideoRow | null> {
  const { data, error } = await admin()
    .from("discover_videos")
    .select("id, dialect, transcript_lines, cultural_context, grammar_points, vocabulary")
    .eq("id", videoId)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as VideoRow;
}

/**
 * Persist the revision rows for one save.
 *
 * Deliberately not fatal: a reviewer's correction is the thing being protected
 * here, and losing the note about it is better than refusing the correction. A
 * failure is reported back in the response so the UI can say the log is behind
 * rather than pretending it is complete.
 */
async function recordRevisions(
  videoId: string,
  revisions: TranscriptRevision[],
  changedBy: string,
  source: RevisionSource,
): Promise<boolean> {
  if (revisions.length === 0) return true;
  const { error } = await admin().from("transcript_line_revisions").insert(
    revisions.map((r) => ({
      video_id: videoId,
      line_id: r.lineId,
      field: r.field,
      previous_value: r.previousValue,
      new_value: r.newValue,
      changed_by: changedBy,
      source,
    })),
  );
  if (error) console.error("transcript-review: revision log failed", error.message);
  return !error;
}

function asLines(value: unknown): TranscriptLine[] {
  return Array.isArray(value) ? (value as TranscriptLine[]) : [];
}

// ── Actions ─────────────────────────────────────────────────────────────────

async function saveLines(
  reviewer: Reviewer,
  body: Record<string, unknown>,
  cors: Record<string, string>,
): Promise<Response> {
  const videoId = String(body.videoId ?? "");
  const lines = body.lines;
  if (!videoId || !Array.isArray(lines)) {
    return json({ error: "videoId and lines are required" }, 400, cors);
  }

  const video = await loadVideo(videoId);
  if (!video) return json({ error: "video_not_found" }, 404, cors);

  const source: RevisionSource = body.source === "ai_resegment" ? "ai_resegment" : "human";
  const revisions = diffTranscriptRevisions(video.transcript_lines, lines);

  const { error } = await admin()
    .from("discover_videos")
    .update({ transcript_lines: lines })
    .eq("id", videoId);
  if (error) return json({ error: "save_failed", message: error.message }, 500, cors);

  const logged = await recordRevisions(videoId, revisions, reviewer.userId, source);
  return json({ saved: true, revisions: revisions.length, logged }, 200, cors);
}

/**
 * Mark or unmark one line as checked by a human.
 *
 * The approved Arabic and English are snapshotted onto the row. That is what
 * lets the workspace show a tick as stale rather than silently keeping it
 * valid over text nobody checked — see the column comments in
 * 20260824090100_transcript_review.sql.
 */
async function setReviewed(
  reviewer: Reviewer,
  body: Record<string, unknown>,
  cors: Record<string, string>,
): Promise<Response> {
  const videoId = String(body.videoId ?? "");
  const lineId = String(body.lineId ?? "");
  const reviewed = body.reviewed !== false;
  if (!videoId || !lineId) return json({ error: "videoId and lineId are required" }, 400, cors);

  if (!reviewed) {
    const { error } = await admin()
      .from("transcript_line_reviews")
      .delete()
      .eq("video_id", videoId)
      .eq("line_id", lineId);
    if (error) return json({ error: "unreview_failed", message: error.message }, 500, cors);
    return json({ reviewed: false }, 200, cors);
  }

  const video = await loadVideo(videoId);
  if (!video) return json({ error: "video_not_found" }, 404, cors);

  const line = asLines(video.transcript_lines).find((l) => l?.id === lineId);
  if (!line) return json({ error: "line_not_found" }, 404, cors);

  // Re-checking a line the reviewer already signed off replaces the snapshot,
  // which is how a stale tick is cleared once they have looked at the new text.
  const { error } = await admin()
    .from("transcript_line_reviews")
    .upsert(
      {
        video_id: videoId,
        line_id: lineId,
        reviewed_by: reviewer.userId,
        reviewed_at: new Date().toISOString(),
        reviewed_arabic: line.arabic ?? null,
        reviewed_translation: line.translation ?? null,
      },
      { onConflict: "video_id,line_id" },
    );
  if (error) return json({ error: "review_failed", message: error.message }, 500, cors);

  return json({ reviewed: true }, 200, cors);
}

/**
 * Re-translate one line from whatever Arabic it now holds.
 *
 * The reviewer has just corrected the Arabic, so the English underneath it is
 * describing words that are no longer there. This regenerates it — and logs the
 * result as a revision with `source: 'ai_retranslate'`, because it is a change
 * to the record even though no person wrote the words.
 */
async function retranslateLine(
  reviewer: Reviewer,
  body: Record<string, unknown>,
  cors: Record<string, string>,
): Promise<Response> {
  const videoId = String(body.videoId ?? "");
  const lineId = String(body.lineId ?? "");
  if (!videoId || !lineId) return json({ error: "videoId and lineId are required" }, 400, cors);

  const video = await loadVideo(videoId);
  if (!video) return json({ error: "video_not_found" }, 404, cors);

  const lines = asLines(video.transcript_lines);
  const index = lines.findIndex((l) => l?.id === lineId);
  if (index === -1) return json({ error: "line_not_found" }, 404, cors);

  const line = lines[index];
  const arabic = String(line.arabic ?? "").trim();
  if (!arabic) return json({ error: "line_has_no_arabic" }, 400, cors);

  // `discover_videos.dialect` carries city-level labels ("Kuwaiti", "Emirati")
  // that the brain's rulebook does not have prompts for; normalizeDialect
  // collapses them onto the three it does.
  const dialect: Dialect = normalizeDialect(video.dialect) ?? "Gulf";
  // Neighbours disambiguate a pronoun or a dangling clause that the line alone
  // cannot settle. They are context, not content: the prompt asks for the
  // middle line only.
  const before = lines[index - 1]?.arabic ?? "";
  const after = lines[index + 1]?.arabic ?? "";

  let result: { translation?: string; literal?: string } | null = null;
  try {
    const brain = await askBrain<{ translation: string; literal?: string }>({
      purpose: "transcript_line_retranslation",
      dialect,
      strategy: "solo",
      models: [...getLineup("TRANSLATION").drafters],
      // The output is English; the MSA repair pass has nothing to repair.
      skipRepair: true,
      maxTokens: 500,
      temperature: 0.2,
      userPrompt:
        `A native speaker has just corrected the Arabic of one line of a spoken ` +
        `${dialect} Arabic transcript. Translate the corrected line into natural, ` +
        `plain English for a learner, and give a word-for-word literal gloss.\n\n` +
        (before ? `Previous line (context only): «${before}»\n` : "") +
        (after ? `Next line (context only): «${after}»\n` : "") +
        `\nTranslate this line only:\n«${arabic}»`,
      tool: {
        name: "emit_line_translation",
        description: "Natural and literal English for one transcript line.",
        parameters: {
          type: "object",
          properties: {
            translation: { type: "string", description: "Natural English." },
            literal: { type: "string", description: "Word-for-word gloss." },
          },
          required: ["translation"],
        },
      },
    });
    result = brain.output;
  } catch (e) {
    console.error("transcript-review: retranslate failed", e);
    return json({ error: "retranslate_failed" }, 502, cors);
  }

  const translation = String(result?.translation ?? "").trim();
  if (!translation) return json({ error: "retranslate_empty" }, 502, cors);
  const literal = String(result?.literal ?? "").trim();

  const updated: TranscriptLine = { ...line, translation };
  if (literal) updated.literal = literal;
  const nextLines = [...lines.slice(0, index), updated, ...lines.slice(index + 1)];

  const { error } = await admin()
    .from("discover_videos")
    .update({ transcript_lines: nextLines })
    .eq("id", videoId);
  if (error) return json({ error: "save_failed", message: error.message }, 500, cors);

  const revisions = diffTranscriptRevisions(lines, nextLines);
  await recordRevisions(videoId, revisions, reviewer.userId, "ai_retranslate");

  return json({ translation, literal: literal || null }, 200, cors);
}

async function addComment(
  reviewer: Reviewer,
  body: Record<string, unknown>,
  cors: Record<string, string>,
): Promise<Response> {
  const videoId = String(body.videoId ?? "");
  const text = String(body.body ?? "").trim();
  if (!videoId || !text) return json({ error: "videoId and body are required" }, 400, cors);

  const kind = ["comment", "suggestion", "concern"].includes(String(body.kind))
    ? String(body.kind)
    : "comment";
  const lineId = body.lineId ? String(body.lineId) : null;
  const suggested = String(body.suggestedTranslation ?? "").trim();

  const { data, error } = await admin()
    .from("transcript_line_comments")
    .insert({
      video_id: videoId,
      line_id: lineId,
      kind,
      body: text,
      suggested_translation: suggested || null,
      author_id: reviewer.userId,
    })
    .select("id, video_id, line_id, kind, body, suggested_translation, author_id, created_at")
    .maybeSingle();

  if (error) return json({ error: "comment_failed", message: error.message }, 500, cors);
  return json({ comment: data }, 200, cors);
}

async function resolveComment(
  reviewer: Reviewer,
  body: Record<string, unknown>,
  cors: Record<string, string>,
): Promise<Response> {
  const commentId = String(body.commentId ?? "");
  if (!commentId) return json({ error: "commentId is required" }, 400, cors);
  const resolved = body.resolved !== false;

  const { error } = await admin()
    .from("transcript_line_comments")
    .update(
      resolved
        ? { resolved_at: new Date().toISOString(), resolved_by: reviewer.userId }
        : { resolved_at: null, resolved_by: null },
    )
    .eq("id", commentId);

  if (error) return json({ error: "resolve_failed", message: error.message }, 500, cors);
  return json({ resolved }, 200, cors);
}

/**
 * The video's own notes: cultural context, grammar points, vocabulary.
 *
 * These three columns and no others. A transcriber has no route to `published`,
 * `source_url` or anything else on the row, and the allow-list is stated as
 * code here rather than as a convention in the client.
 */
async function saveNotes(
  reviewer: Reviewer,
  body: Record<string, unknown>,
  cors: Record<string, string>,
): Promise<Response> {
  const videoId = String(body.videoId ?? "");
  if (!videoId) return json({ error: "videoId is required" }, 400, cors);

  const video = await loadVideo(videoId);
  if (!video) return json({ error: "video_not_found" }, 404, cors);

  const updates: Record<string, unknown> = {};
  const revisions: TranscriptRevision[] = [];

  if ("culturalContext" in body) {
    const next = body.culturalContext === null ? null : String(body.culturalContext ?? "");
    const revision = diffVideoField("cultural_context", video.cultural_context, next);
    if (revision) {
      updates.cultural_context = next || null;
      revisions.push(revision);
    }
  }

  for (const [key, column] of [
    ["grammarPoints", "grammar_points"],
    ["vocabulary", "vocabulary"],
  ] as const) {
    if (!(key in body)) continue;
    const next = Array.isArray(body[key]) ? body[key] : [];
    const revision = diffVideoField(
      column,
      column === "grammar_points" ? video.grammar_points : video.vocabulary,
      next,
    );
    if (revision) {
      updates[column] = next;
      revisions.push(revision);
    }
  }

  if (Object.keys(updates).length === 0) {
    return json({ saved: true, revisions: 0, logged: true }, 200, cors);
  }

  const { error } = await admin().from("discover_videos").update(updates).eq("id", videoId);
  if (error) return json({ error: "save_failed", message: error.message }, 500, cors);

  const logged = await recordRevisions(videoId, revisions, reviewer.userId, "human");
  return json({ saved: true, revisions: revisions.length, logged }, 200, cors);
}

// ── Entry point ─────────────────────────────────────────────────────────────

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, corsHeaders);
  }

  const reviewer = await resolveReviewer(req);
  if (!reviewer) {
    return json({ error: "forbidden", message: "Transcript review access required." }, 403, corsHeaders);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400, corsHeaders);
  }

  const action = String(body.action ?? "");
  try {
    switch (action) {
      case "save_lines":
        return await saveLines(reviewer, body, corsHeaders);
      case "set_reviewed":
        return await setReviewed(reviewer, body, corsHeaders);
      case "retranslate_line":
        return await retranslateLine(reviewer, body, corsHeaders);
      case "add_comment":
        return await addComment(reviewer, body, corsHeaders);
      case "resolve_comment":
        return await resolveComment(reviewer, body, corsHeaders);
      case "save_notes":
        return await saveNotes(reviewer, body, corsHeaders);
      default:
        return json({ error: "unknown_action", action }, 400, corsHeaders);
    }
  } catch (e) {
    console.error("transcript-review: unhandled", e);
    return json({ error: "internal_error" }, 500, corsHeaders);
  }
});
