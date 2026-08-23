// Clip pipeline, stage 3: turn the caption index into clip candidates.
//
// Given a target concept (or a coverage-gap sweep over concepts that still
// lack clips for a dialect), expands the concept's approved per-dialect
// realizations into search terms, queries the caption index, ranks the hits,
// and writes `clip_candidates` rows for the verification stack
// (verify-clip-candidate) to judge.
//
// This function is deliberately cheap and deterministic — no model calls. The
// expensive judgment lives in the verifier, so mining can sweep broadly.
//
// Callers: the /admin/clip-search UI (per-concept) and the automation loop
// (coverage sweep). Gated to content managers, with an optional shared-secret
// header for headless runs (CLIP_PIPELINE_SECRET).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { normalizeArabic } from "../_shared/msaLeakDetector.ts";

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

/** Content managers (admin or content_reviewer) — same audience as the RLS. */
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

/** Headless automation path: a shared secret, enabled only when configured. */
function hasPipelineSecret(req: Request): boolean {
  const secret = Deno.env.get("CLIP_PIPELINE_SECRET");
  if (!secret) return false;
  return req.headers.get("x-pipeline-secret") === secret;
}

interface LineHit {
  id: string;
  video_id: string;
  start_ms: number;
  end_ms: number;
  text: string;
  text_normalized: string;
  dialect_score: number | null;
  msa_score: number | null;
  source: string;
  channel_videos: {
    id: string;
    yt_video_id: string;
    availability: string;
    embeddable: boolean | null;
    content_channels: { id: string; name: string; dialect: string; status: string };
  };
}

// The shadow player's clip window, widened a little at the top for lines that
// carry a short sentence rather than a bare word.
const MIN_CLIP_MS = 1200;
const MAX_CLIP_MS = 10000;

function containsTerm(normalizedLine: string, normalizedTerm: string): boolean {
  if (!normalizedTerm) return false;
  const esc = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\s\\p{P}])${esc}($|[\\s\\p{P}])`, "u").test(normalizedLine);
}

function rankScore(line: LineHit): number {
  const dialect = line.dialect_score ?? 0;
  const msa = line.msa_score ?? 0;
  const duration = line.end_ms - line.start_ms;
  // Sweet spot: long enough to shadow, short enough to stay one thought.
  const durationFit = duration >= 2000 && duration <= 8000 ? 0.2 : 0;
  return dialect - msa + durationFit;
}

async function searchTerm(term: string, dialect: string, limit: number): Promise<LineHit[]> {
  const { data, error } = await admin()
    .from("caption_lines")
    .select(
      "id, video_id, start_ms, end_ms, text, text_normalized, dialect_score, msa_score, source, " +
        "channel_videos!inner(id, yt_video_id, availability, embeddable, " +
        "content_channels!inner(id, name, dialect, status))",
    )
    .textSearch("text_normalized", term, { config: "simple", type: "phrase" })
    .eq("channel_videos.content_channels.dialect", dialect)
    .eq("channel_videos.content_channels.status", "approved")
    .neq("channel_videos.availability", "unavailable")
    .limit(limit);
  if (error) throw new Error(`caption search failed: ${error.message}`);
  return (data ?? []) as unknown as LineHit[];
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!hasPipelineSecret(req) && !(await isContentManager(req))) {
      return json({ error: "content_manager_required" }, 403, corsHeaders);
    }

    const body = await req.json().catch(() => ({}));
    const dialect = typeof body.dialect === "string" ? body.dialect : null;
    if (!dialect || !["Gulf", "Egyptian", "Yemeni"].includes(dialect)) {
      return json({ error: "dialect_required" }, 400, corsHeaders);
    }
    const conceptKey = typeof body.conceptKey === "string" ? body.conceptKey : null;
    // Ad-hoc terms let the admin search UI mine a word before the concept
    // list has approved realizations for it.
    const adHocTerms: string[] = Array.isArray(body.terms)
      ? body.terms.filter((t: unknown) => typeof t === "string").slice(0, 6)
      : [];
    const conceptLimit = Math.max(1, Math.min(25, Number(body.conceptLimit) || 10));
    const perConcept = Math.max(1, Math.min(10, Number(body.perConcept) || 3));

    // ---- pick target concepts ----
    let conceptQuery = admin()
      .from("vocab_concepts")
      .select("id, key, english_gloss")
      .order("sort_order", { ascending: true })
      .limit(conceptKey ? 1 : conceptLimit);
    if (conceptKey) conceptQuery = conceptQuery.eq("key", conceptKey);
    const { data: conceptRows, error: conceptErr } = await conceptQuery;
    if (conceptErr) throw new Error(`vocab_concepts fetch failed: ${conceptErr.message}`);
    let concepts = (conceptRows ?? []) as Array<{ id: string; key: string; english_gloss: string }>;

    if (concepts.length === 0 && adHocTerms.length === 0) {
      return json({ mined: 0, note: "no concepts matched" }, 200, corsHeaders);
    }

    // How much index there is to mine for this dialect. Zero is the most
    // common first-run failure ("I harvested but never fetched captions"),
    // and a silent 0-mined answer hides it — so it is measured up front and
    // reported whenever mining comes back empty.
    const { count: indexSize } = await admin()
      .from("caption_lines")
      .select("id, channel_videos!inner(content_channels!inner(dialect, status))", {
        count: "exact",
        head: true,
      })
      .eq("channel_videos.content_channels.dialect", dialect)
      .eq("channel_videos.content_channels.status", "approved");
    const captionLinesIndexed = indexSize ?? 0;

    // Coverage gate for sweeps: skip concepts that already have live
    // candidates in this dialect. (An explicit conceptKey call skips the
    // gate: the reviewer asked for more of this word.)
    if (!conceptKey && concepts.length > 0) {
      const { data: existing } = await admin()
        .from("clip_candidates")
        .select("concept_id, channel_videos!inner(content_channels!inner(dialect))")
        .in("concept_id", concepts.map((c) => c.id))
        .neq("status", "rejected")
        .eq("channel_videos.content_channels.dialect", dialect);
      const covered = new Map<string, number>();
      for (const row of (existing ?? []) as Array<{ concept_id: string | null }>) {
        if (row.concept_id) covered.set(row.concept_id, (covered.get(row.concept_id) ?? 0) + 1);
      }
      concepts = concepts.filter((c) => (covered.get(c.id) ?? 0) < perConcept);
    }

    // ---- terms per concept ----
    const targets: Array<{ conceptId: string | null; key: string; terms: string[] }> = [];
    if (adHocTerms.length > 0) {
      // Ad-hoc terms attach to a concept only when the caller named one —
      // never to whichever concept happened to sort first.
      targets.push({
        conceptId: conceptKey ? concepts[0]?.id ?? null : null,
        key: conceptKey ?? "(ad hoc)",
        terms: adHocTerms.map(normalizeArabic).filter(Boolean),
      });
    } else {
      const { data: realizationRows, error: realErr } = await admin()
        .from("concept_realizations")
        .select("concept_id, surface, variants")
        .in("concept_id", concepts.map((c) => c.id))
        .eq("dialect", dialect)
        .eq("status", "approved");
      if (realErr) throw new Error(`concept_realizations fetch failed: ${realErr.message}`);
      const byConcept = new Map<string, string[]>();
      for (const row of (realizationRows ?? []) as Array<{ concept_id: string; surface: string; variants: string[] }>) {
        const terms = byConcept.get(row.concept_id) ?? [];
        terms.push(row.surface, ...(row.variants ?? []));
        byConcept.set(row.concept_id, terms);
      }
      for (const c of concepts) {
        const terms = (byConcept.get(c.id) ?? []).map(normalizeArabic).filter(Boolean);
        if (terms.length > 0) targets.push({ conceptId: c.id, key: c.key, terms: terms.slice(0, 6) });
      }
    }

    // ---- search, rank, insert ----
    const summary: Array<{ concept: string; found: number; inserted: number }> = [];
    let totalInserted = 0;

    for (const target of targets) {
      const hitsByLine = new Map<string, { line: LineHit; term: string }>();
      for (const term of target.terms) {
        for (const line of await searchTerm(term, dialect, 30)) {
          // FTS matched the lexeme; confirm the word-boundary containment the
          // index cannot express, then keep the best line only once.
          if (!containsTerm(line.text_normalized, term)) continue;
          const duration = line.end_ms - line.start_ms;
          if (duration < MIN_CLIP_MS || duration > MAX_CLIP_MS) continue;
          if (line.channel_videos.embeddable === false) continue;
          if (!hitsByLine.has(line.id)) hitsByLine.set(line.id, { line, term });
        }
      }

      const hits = [...hitsByLine.values()]
        .sort((a, b) => rankScore(b.line) - rankScore(a.line));

      // Never resurface a line that already has a candidate, whatever its
      // status — a rejected line stays rejected.
      const lineIds = hits.map((h) => h.line.id);
      const already = new Set<string>();
      if (lineIds.length > 0) {
        const { data: existingLines } = await admin()
          .from("clip_candidates")
          .select("caption_line_id")
          .in("caption_line_id", lineIds);
        for (const row of (existingLines ?? []) as Array<{ caption_line_id: string | null }>) {
          if (row.caption_line_id) already.add(row.caption_line_id);
        }
      }

      const fresh = hits.filter((h) => !already.has(h.line.id)).slice(0, perConcept);
      if (fresh.length > 0) {
        const { error: insertErr } = await admin().from("clip_candidates").insert(
          fresh.map(({ line, term }) => ({
            concept_id: target.conceptId,
            video_id: line.video_id,
            caption_line_id: line.id,
            start_ms: line.start_ms,
            end_ms: line.end_ms,
            status: "pending",
            rank_score: rankScore(line),
            verification: {
              mined: {
                term,
                concept_key: target.key,
                line_text: line.text,
                caption_source: line.source,
                channel: line.channel_videos.content_channels.name,
                yt_video_id: line.channel_videos.yt_video_id,
              },
            },
          })) as unknown as never,
        );
        if (insertErr) throw new Error(`clip_candidates insert failed: ${insertErr.message}`);
      }
      totalInserted += fresh.length;
      summary.push({ concept: target.key, found: hits.length, inserted: fresh.length });
    }

    // An empty result always says why, in order of likelihood.
    let note: string | undefined;
    if (totalInserted === 0) {
      if (captionLinesIndexed === 0) {
        note =
          "The caption index has no lines for this dialect's approved channels. " +
          "Harvesting only lists videos — run scripts/fetch-captions.ts to index their captions, then mine again.";
      } else if (targets.length === 0) {
        note =
          "No search terms: this dialect has no approved concept realizations yet. " +
          "Type Arabic word(s) to mine ad hoc, or approve realization drafts first.";
      } else if (summary.every((s) => s.found === 0)) {
        note =
          `No caption line contains these exact words (${captionLinesIndexed} lines indexed). ` +
          "Captions write words with clitics — try the definite form (الكلب for كلب) and other spelling variants, or another word.";
      } else {
        note = "Matches were found but every line already has a candidate or fell outside the 1.2-10s clip window.";
      }
    }

    return json(
      { mined: totalInserted, dialect, concepts: summary, captionLinesIndexed, note },
      200,
      corsHeaders,
    );
  } catch (e) {
    console.error("[mine-clip-candidates] error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500, corsHeaders);
  }
});
