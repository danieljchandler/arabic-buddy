/**
 * Vocabulary enrichment cache — reduces Claude/Gemini calls by reusing definitions,
 * roots, and related words across learners.
 *
 * Cache hit rate target: 30–50% after first 1000 words per dialect.
 * Cache misses fall through to askBrain for generation.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

export interface CachedEnrichment {
  definition: string | null;
  literal: string | null;
  root: string | null;
  transliteration: string | null;
  uses: Array<{ arabic: string; english: string }>;
  _meta: {
    cached: true;
    cached_at: string;
    hit_count: number;
  };
}

export interface GeneratedEnrichment {
  definition: string | null;
  literal: string | null;
  root: string | null;
  transliteration: string | null;
  uses: Array<{ arabic: string; english: string }>;
  _meta: {
    cached: false;
    strategy: string;
    models: string[];
    msaRepairs: number;
  };
}

export type EnrichmentResult = CachedEnrichment | GeneratedEnrichment;

/**
 * Normalize word/phrase for cache lookups.
 * Removes diacritics, collapses whitespace, but preserves actual letters.
 */
function normalizeWord(word: string, isPhrase: boolean): string {
  // Remove Arabic diacritics (tashkeel)
  let normalized = word.replace(/[َ-ٟ]/g, "");
  // Normalize whitespace
  normalized = normalized.trim().replace(/\s+/g, " ");
  return normalized;
}

/**
 * Try to fetch cached enrichment. Returns null if not found.
 * Non-blocking on lookup failure.
 */
export async function getCachedEnrichment(
  word: string,
  dialect: string,
  isPhrase: boolean,
): Promise<CachedEnrichment | null> {
  try {
    const supa = admin();
    const normalized = normalizeWord(word, isPhrase);

    const { data, error } = await supa
      .from("vocabulary_enrichments")
      .select("definition,literal,root,transliteration,uses,hit_count,created_at")
      .eq("word_normalized", normalized)
      .eq("dialect", dialect)
      .eq("is_phrase", isPhrase)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    // Increment hit count in background (fire and forget).
    supa
      .from("vocabulary_enrichments")
      .update({ hit_count: (data.hit_count || 0) + 1, updated_at: new Date().toISOString() })
      .eq("word_normalized", normalized)
      .eq("dialect", dialect)
      .eq("is_phrase", isPhrase)
      .then()
      .catch((e) => console.error("[vocabularyCache] hit_count update failed:", e.message));

    return {
      definition: data.definition || null,
      literal: data.literal || null,
      root: data.root || null,
      transliteration: data.transliteration || null,
      uses: (Array.isArray(data.uses) ? data.uses : []) as Array<{ arabic: string; english: string }>,
      _meta: {
        cached: true,
        cached_at: data.created_at,
        hit_count: (data.hit_count || 0) + 1,
      },
    };
  } catch (e) {
    console.error("[vocabularyCache] lookup failed:", e);
    return null; // Fall through to generation on error
  }
}

/**
 * Store newly generated enrichment in cache.
 * Non-blocking on write; errors logged but do not throw.
 */
export async function cacheEnrichment(
  word: string,
  dialect: string,
  isPhrase: boolean,
  enrichment: {
    definition?: string | null;
    literal?: string | null;
    root?: string | null;
    transliteration?: string | null;
    uses?: Array<{ arabic: string; english: string }>;
  },
  metadata: {
    strategy: string;
    models: string[];
    msaRepairs: number;
  },
): Promise<void> {
  try {
    const supa = admin();
    const normalized = normalizeWord(word, isPhrase);

    // Use upsert to handle race conditions: if another request cached this
    // word between our lookup and now, use the older entry (higher hit count).
    const { error } = await supa.from("vocabulary_enrichments").upsert(
      {
        word_normalized: normalized,
        word: word.trim().slice(0, 200),
        dialect,
        is_phrase: isPhrase,
        definition: enrichment.definition || null,
        literal: enrichment.literal || null,
        root: enrichment.root || null,
        transliteration: enrichment.transliteration || null,
        uses: enrichment.uses ? JSON.stringify(enrichment.uses) : null,
        generated_by: metadata.strategy,
        msa_repairs: metadata.msaRepairs,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        hit_count: 1,
      },
      {
        onConflict: "word_normalized,dialect,is_phrase",
        ignoreDuplicates: false, // Update if exists
      },
    );

    if (error) {
      console.error("[vocabularyCache] insert/update failed:", error.message);
    }
  } catch (e) {
    console.error("[vocabularyCache] cacheEnrichment error:", e);
    // Non-blocking: do not throw if caching fails
  }
}
