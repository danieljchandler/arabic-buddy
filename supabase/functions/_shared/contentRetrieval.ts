// The reader for the semantic content index: embed a question, ask
// match_content for the nearest material, and label the results with
// something a learner would recognise.
//
// Every failure path here degrades to "no related material" rather than to an
// error. A missing pgvector extension, an embeddings outage, or a database
// without the RPC must cost the tutor a nice-to-have paragraph, never the
// answer itself — which is why nothing in this module throws.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { embedTexts } from "./embeddings.ts";
import {
  MAX_CHUNKS,
  retrievalBlock,
  selectChunks,
  type RetrievedChunk,
} from "./contentRetrievalCore.ts";
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

interface MatchRow {
  kind: string;
  source_id: string;
  chunk_index: number;
  dialect: string;
  content: string;
  similarity: number;
}

/**
 * Put a recognisable name on each match. A learner is told "you saw this in
 * 'Souq tour'", not "you saw this in 6f3a-…". Only video lines carry a title
 * worth showing; vocabulary and corpus matches are their own label.
 *
 * Best-effort: a failed lookup drops the titles, not the matches.
 */
async function labelChunks(chunks: RetrievedChunk[]): Promise<RetrievedChunk[]> {
  const videoIds = [...new Set(chunks.filter((c) => c.kind === "video_line").map((c) => c.sourceId))];
  if (videoIds.length === 0) return chunks;

  try {
    const { data, error } = await admin()
      .from("discover_videos")
      .select("id, title")
      .in("id", videoIds);
    if (error) throw new Error(error.message);
    const titles = new Map(
      ((data ?? []) as Array<{ id: string; title: string }>).map((row) => [row.id, row.title]),
    );
    return chunks.map((chunk) =>
      chunk.kind === "video_line" && titles.has(chunk.sourceId)
        ? { ...chunk, label: titles.get(chunk.sourceId) }
        : chunk,
    );
  } catch (err) {
    console.warn("[contentRetrieval] title lookup failed", err);
    return chunks;
  }
}

export interface RetrieveOptions {
  /** What the learner asked, plus any sentence the chat was opened about. */
  query: string;
  dialect: Dialect;
  /** The video or article already on screen — excluded from the results. */
  excludeSourceId?: string;
  max?: number;
  /**
   * Shortest query worth embedding.
   *
   * The default suits the automatic per-turn retrieval, where the query is
   * whatever the learner typed and a short one is an acknowledgement ("ok",
   * "thanks") rather than a question. A deliberate `search_library` tool call
   * is the opposite case — one Arabic word is exactly what it is for — so it
   * lowers the floor.
   */
  minQueryLength?: number;
}

/** Nearest library material to a question. Empty on every failure. */
export async function retrieveRelatedContent(opts: RetrieveOptions): Promise<RetrievedChunk[]> {
  const query = opts.query.trim();
  if (query.length < (opts.minQueryLength ?? 8)) return [];
  if (!SUPABASE_URL || !SERVICE_ROLE) return [];

  try {
    const [vector] = await embedTexts([query]);
    if (!vector) return [];

    const { data, error } = await admin().rpc("match_content", {
      query_embedding: JSON.stringify(vector),
      match_dialect: opts.dialect,
      // Over-fetch: selectChunks keeps one per source, so asking for exactly
      // the number wanted would return six lines of the same transcript.
      match_count: (opts.max ?? MAX_CHUNKS) * 5,
    });
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as MatchRow[];
    const selected = selectChunks(
      rows.map((row) => ({
        kind: row.kind,
        sourceId: row.source_id,
        chunkIndex: row.chunk_index,
        content: row.content,
        similarity: row.similarity,
      })),
      { excludeSourceId: opts.excludeSourceId, max: opts.max },
    );
    return await labelChunks(selected);
  } catch (err) {
    // Expected on a database with no pgvector: the migration is guarded, so
    // the table and the RPC simply do not exist there.
    console.warn("[contentRetrieval] retrieval unavailable", err);
    return [];
  }
}

/** Retrieval as a ready-to-paste prompt block. Empty string when there is
 *  nothing relevant, which is the common case and costs the prompt nothing. */
export async function relatedContentBlock(opts: RetrieveOptions): Promise<string> {
  return retrievalBlock(await retrieveRelatedContent(opts));
}
