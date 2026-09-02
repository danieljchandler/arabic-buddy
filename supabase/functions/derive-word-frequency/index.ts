// derive-word-frequency — count the dialect's own words and rank the decks by
// them (docs/language-learning-plan-2026-09.md, Phase 3).
//
// No frequency list for spoken Gulf, Egyptian or Yemeni Arabic exists
// anywhere, and MSA frequency ranks the wrong words for a dialect learner
// (research §4). The only genuine dialect frequency this project has is what
// it has transcribed. This job counts it: caption lines from channels that
// carry the dialect, kept only where the line itself measures as dialectal
// (corpora labelled "dialectal" are often mostly MSA — research §5), plus the
// published transcripts native reviewers have corrected, weighted higher.
// Then every vocabulary word and set phrase that matches a counted token gets
// its rank, and reviewOrder.ts admits new cards common-first.
//
// Runs under the service role on a schedule, guarded by a shared secret in
// the x-frequency-secret header (the same shape as harvest-social-trends).
// Calls no model, so it needs no cap. Idempotent: each run replaces the
// dialect's rows and rewrites only the ranks that changed.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { hasSharedSecret } from "../_shared/requireRole.ts";
import {
  CAPTION_WEIGHT,
  countTokens,
  DEFAULT_MIN_DIALECT_SCORE,
  rankEntries,
  REVIEWED_WEIGHT,
  toFrequencyRows,
  type FrequencySource,
} from "../_shared/wordFrequencyCore.ts";

const DIALECTS = ["Gulf", "Egyptian", "Yemeni"] as const;
type Dialect = (typeof DIALECTS)[number];
const PAGE = 1000;
const INSERT_CHUNK = 500;
const UPDATE_PARALLEL = 20;

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

/** PostgREST caps a select at 1000 rows; page with a stable order. */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

interface ChannelRow { id: string; dialect: string | null; status: string | null }
interface ChannelVideoRow { id: string; channel_id: string }
interface CaptionRow { video_id: string; text_normalized: string; dialect_score: number | null }
interface DiscoverRow { id: string; dialect: string | null; transcript_lines: unknown }
interface EntryRow { id: string; arabic: string; frequency_rank: number | null }

async function sourcesFor(supa: SupabaseClient, dialect: Dialect, minScore: number): Promise<{ sources: FrequencySource[]; captions: number; reviewed: number }> {
  const channels = await fetchAll<ChannelRow>((from, to) =>
    supa.from("content_channels").select("id, dialect, status").eq("dialect", dialect).order("id").range(from, to));
  const channelIds = channels.filter((c) => c.status !== "rejected").map((c) => c.id);

  const sources: FrequencySource[] = [];
  let captions = 0;
  if (channelIds.length > 0) {
    const videos = await fetchAll<ChannelVideoRow>((from, to) =>
      supa.from("channel_videos").select("id, channel_id").in("channel_id", channelIds).order("id").range(from, to));
    const videoIds = videos.map((v) => v.id);
    for (let i = 0; i < videoIds.length; i += 200) {
      const slice = videoIds.slice(i, i + 200);
      const lines = await fetchAll<CaptionRow>((from, to) =>
        supa.from("caption_lines").select("video_id, text_normalized, dialect_score").in("video_id", slice).order("id").range(from, to));
      for (const line of lines) {
        if ((line.dialect_score ?? 0) < minScore) continue;
        sources.push({ text: line.text_normalized, weight: CAPTION_WEIGHT, doc: line.video_id });
        captions++;
      }
    }
  }

  const discover = await fetchAll<DiscoverRow>((from, to) =>
    supa.from("discover_videos").select("id, dialect, transcript_lines").eq("dialect", dialect).eq("published", true).order("id").range(from, to));
  let reviewed = 0;
  for (const video of discover) {
    if (!Array.isArray(video.transcript_lines)) continue;
    for (const raw of video.transcript_lines) {
      const arabic = (raw as { arabic?: unknown } | null)?.arabic;
      if (typeof arabic !== "string" || !arabic.trim()) continue;
      sources.push({ text: arabic, weight: REVIEWED_WEIGHT, doc: `discover:${video.id}` });
      reviewed++;
    }
  }
  return { sources, captions, reviewed };
}

async function replaceFrequency(supa: SupabaseClient, dialect: Dialect, rows: ReturnType<typeof toFrequencyRows>): Promise<void> {
  const del = await supa.from("dialect_word_frequency").delete().eq("dialect", dialect);
  if (del.error) throw new Error(del.error.message);
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK).map((r) => ({
      dialect: r.dialect, token: r.token, count: r.count, doc_count: r.docCount, zipf: r.zipf, updated_at: now,
    }));
    const ins = await supa.from("dialect_word_frequency").insert(chunk);
    if (ins.error) throw new Error(ins.error.message);
  }
}

/** Rank one table's entries for a dialect; write only the ranks that changed. */
async function rankTable(
  supa: SupabaseClient,
  table: "vocabulary_words" | "set_phrases",
  dialect: Dialect,
  stats: ReturnType<typeof countTokens>,
): Promise<number> {
  const dialectColumn = table === "vocabulary_words" ? "dialect_module" : "dialect";
  const arabicColumn = table === "vocabulary_words" ? "word_arabic" : "phrase_arabic";
  const entries = await fetchAll<Record<string, unknown>>((from, to) =>
    supa.from(table).select(`id, ${arabicColumn}, frequency_rank`).eq(dialectColumn, dialect).order("id").range(from, to));
  const rankable: EntryRow[] = entries.map((e) => ({
    id: String(e.id), arabic: String(e[arabicColumn] ?? ""), frequency_rank: (e.frequency_rank as number | null) ?? null,
  }));
  const ranked = rankEntries(rankable, stats);
  const changed = ranked.filter((r, i) => r.frequencyRank !== rankable[i].frequency_rank);
  for (let i = 0; i < changed.length; i += UPDATE_PARALLEL) {
    const batch = changed.slice(i, i + UPDATE_PARALLEL);
    const results = await Promise.all(
      batch.map((r) => supa.from(table).update({ frequency_rank: r.frequencyRank }).eq("id", r.id)),
    );
    const failed = results.find((res) => res.error);
    if (failed?.error) throw new Error(failed.error.message);
  }
  return changed.length;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (!(await hasSharedSecret(req, "x-frequency-secret", "FREQUENCY_DERIVE_SECRET"))) {
    return json({ error: "unauthorized" }, 401, corsHeaders);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return json({ error: "service role not configured" }, 500, corsHeaders);
  const supa = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const only = typeof body.dialect === "string" ? (body.dialect as Dialect) : null;
  const minScore = typeof body.minDialectScore === "number" ? body.minDialectScore : DEFAULT_MIN_DIALECT_SCORE;
  const targets = only ? DIALECTS.filter((d) => d === only) : [...DIALECTS];
  if (targets.length === 0) return json({ error: `dialect must be one of ${DIALECTS.join(", ")}` }, 400, corsHeaders);

  const started = Date.now();
  const report: Record<string, unknown> = {};
  try {
    for (const dialect of targets) {
      const { sources, captions, reviewed } = await sourcesFor(supa, dialect, minScore);
      const stats = countTokens(sources);
      await replaceFrequency(supa, dialect, toFrequencyRows(dialect, stats));
      const words = await rankTable(supa, "vocabulary_words", dialect, stats);
      const phrases = await rankTable(supa, "set_phrases", dialect, stats);
      report[dialect] = { captionLines: captions, reviewedLines: reviewed, tokens: stats.length, wordsReranked: words, phrasesReranked: phrases };
    }
    return json({ ok: true, minDialectScore: minScore, durationMs: Date.now() - started, ...report }, 200, corsHeaders);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("derive-word-frequency failed:", message);
    return json({ error: message, partial: report }, 500, corsHeaders);
  }
});
