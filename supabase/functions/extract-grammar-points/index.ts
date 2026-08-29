// Extracts level-tagged dialect grammar points from a Discover video transcript
// and appends them to discover_videos.grammar_points. Avoids duplicating
// existing titles. Callable by signed-in users (target their own level) or
// admins (any level), under a daily cap — the append lands on shared content,
// so an uncapped call was an open invitation.
//
// Every note is also filed in `curriculum_concepts` under its
// `grammarTaxonomy.ts` key and linked to the video through
// `content_concept_links`. That is what makes a paid extraction reusable: the
// note shows on the video for a learner at its level, *and* the concept is
// visible to `planCoverage`, so the curriculum can build on what a video
// already teaches instead of re-deriving it from a jsonb blob nothing queries.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";
import { canonicalGrammarKey } from "../_shared/grammarTaxonomy.ts";


type Cefr = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

interface GrammarPoint {
  title: string;
  explanation: string;
  examples: string[];
  cefr_level?: Cefr;
  /**
   * The taxonomy key this note was filed under, stored alongside the note so
   * every later reader joins on the same string the mastery ladder uses
   * instead of re-deriving it from free text and drifting.
   */
  concept_key?: string;
}

const LEVEL_GUIDE: Record<Cefr, string> = {
  A1: "Very simple patterns: pronouns, basic negation, definite article, possessive suffixes, present-tense conjugation, common question words.",
  A2: "Past tense, simple imperatives, plurals, common prepositions, basic dialect particles (e.g. ما, مو, مش).",
  B1: "Aspect markers (ب/ع/قاعد/راح/بدي), conditional with لو, comparative/superlative, common dialect connectors.",
  B2: "Subjunctive vs. indicative, embedded clauses, نفي compound forms, dialect-specific verb modifiers, idiomatic prepositions.",
  C1: "Subtle register shifts, MSA↔dialect alternations, fronting/topicalization, discourse particles (يعني, طيب), nuanced modality.",
  C2: "Idiomatic syntax, poetic/proverbial structures, sociolinguistic register, fine MSA contrast and code-switching.",
};

function normTitle(t: string): string {
  return (t ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFC")
    .replace(/[\u064B-\u0652\u0670]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * File one extracted note in the shared concept taxonomy, and link it to the
 * video it came from.
 *
 * This is what makes a paid extraction worth more than one page render. Until
 * now the model's output landed only in `discover_videos.grammar_points` — a
 * jsonb blob on a single row, invisible to anything that plans lessons or
 * tracks mastery. Going through `canonicalGrammarKey` puts it in the same key
 * space as `user_concept_mastery` and `curriculum_concepts`, which is the
 * invariant CLAUDE.md states for *both* writers that tag content with grammar
 * concepts; this one was the half that did not.
 *
 * Once linked, `planCoverage` can see the concept (so curriculum-chat stops
 * proposing what a video already teaches, and can reinforce what is due), and
 * the link table answers "which videos teach this?" for a learner at the level.
 *
 * Deliberately insert-if-absent rather than a plain upsert: the unique key is
 * (kind, key, dialect) with no CEFR in it, so a blind upsert would let one
 * video's guess at a level overwrite a curated concept's. An existing concept
 * keeps everything it has and just gains a link.
 */
async function fileConcept(
  service: SupabaseClient,
  point: GrammarPoint,
  opts: { dialect: string; videoId: string },
): Promise<string | null> {
  const key = canonicalGrammarKey(point.title);
  if (!key) return null;

  try {
    await service.from("curriculum_concepts").upsert(
      {
        kind: "grammar",
        key,
        display_english: point.title,
        dialect: opts.dialect,
        cefr_level: point.cefr_level ?? null,
        source_type: "discover_video",
        source_id: opts.videoId,
      } as unknown as never,
      { onConflict: "kind,key,dialect", ignoreDuplicates: true },
    );

    // Re-read rather than trusting the upsert's return: with
    // ignoreDuplicates an existing row comes back empty, and that is the
    // common case once the taxonomy has filled in.
    const { data: concept } = await service
      .from("curriculum_concepts")
      .select("id")
      .eq("kind", "grammar")
      .eq("key", key)
      .eq("dialect", opts.dialect)
      .maybeSingle();
    const conceptId = (concept as { id?: string } | null)?.id;
    if (!conceptId) return null;

    await service.from("content_concept_links").upsert(
      {
        concept_id: conceptId,
        content_type: "discover_video",
        content_id: opts.videoId,
        role: "introduce",
      } as unknown as never,
      { onConflict: "concept_id,content_type,content_id,role" },
    );
    return key;
  } catch (e) {
    // The note itself is already saved on the video by the time this runs.
    // Failing to file it costs reuse, not the learner's page — so log and
    // carry on rather than turning a successful extraction into an error.
    console.error(`[extract-grammar-points] could not file "${point.title}":`, e);
    return null;
  }
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Deliberately still open to signed-in learners: the notes they generate
    // append to the shared `discover_videos.grammar_points`, and the Discover
    // page re-reads the row to show them. That shared append is a product
    // decision, not an oversight — but it was also an uncapped LLM call, which
    // is what actually made it abusable. The cap is the fix; the write stays.
    const cap = await enforceDailyCap(req, "extract-grammar-points", 20, corsHeaders);
    if (cap.limited) return cap.response;

    const body = await req.json().catch(() => ({}));
    const videoId: string = body.video_id;
    const targetLevelRaw: string = (body.target_level || "B1").toUpperCase();
    const target_level: Cefr = (["A1","A2","B1","B2","C1","C2"].includes(targetLevelRaw) ? targetLevelRaw : "B1") as Cefr;
    const count = Math.max(1, Math.min(8, Number(body.count) || 4));

    if (!videoId) {
      return new Response(JSON.stringify({ error: "video_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: video, error: vErr } = await service
      .from("discover_videos")
      .select("id, dialect, difficulty, transcript_lines, grammar_points")
      .eq("id", videoId)
      .single();
    if (vErr || !video) {
      return new Response(JSON.stringify({ error: "Video not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const existing: GrammarPoint[] = Array.isArray(video.grammar_points) ? (video.grammar_points as any[]) : [];
    const existingTitles = existing.map((p) => p?.title).filter(Boolean);
    const existingTitleSet = new Set(existingTitles.map(normTitle));

    const lines = Array.isArray(video.transcript_lines) ? (video.transcript_lines as any[]) : [];
    if (lines.length === 0) {
      return new Response(JSON.stringify({ error: "Video has no transcript yet" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const transcriptSnippet = lines.slice(0, 60).map((l: any, i: number) =>
      `${i + 1}. ${l.arabic ?? ""}${l.translation ? "  —  " + l.translation : ""}`
    ).join("\n");

    const dialect = video.dialect || "Gulf";
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) {
      return new Response(JSON.stringify({ error: "Missing LOVABLE_API_KEY" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are a ${dialect} Arabic dialect coach. Extract grammar notes from a real transcript that are useful for a learner at CEFR ${target_level}.

LEVEL GUIDANCE for ${target_level}:
${LEVEL_GUIDE[target_level]}

RULES:
- Focus on ${dialect}-specific grammar, NOT MSA. Note dialect↔MSA contrasts when illuminating.
- Each point must be GROUNDED in the transcript — quote 1–2 real Arabic lines as examples.
- Difficulty must match ${target_level}: do NOT pick patterns that are too basic or too advanced.
- AVOID these titles already covered for this video (do not return any near-duplicates): ${existingTitles.length ? existingTitles.map((t) => `"${t}"`).join(", ") : "(none)"}.
- Titles must be short (≤ 6 words) and describe the pattern, not the example.
- Explanations should be 1–3 sentences, plain English, learner-friendly.
- Return exactly ${count} new points.`;

    const userPrompt = `Transcript (first ${lines.length > 60 ? 60 : lines.length} lines):
${transcriptSnippet}

Return ONLY JSON of the form:
{"points":[{"title":"...","explanation":"...","examples":["...","..."],"cefr_level":"${target_level}"}]}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
      body: JSON.stringify({
        model: MODEL_IDS.GEMINI_FAST,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text().catch(() => "");
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit reached, try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `AI gateway error: ${aiResp.status}`, detail: errText.slice(0, 300) }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiResp.json();
    const raw = aiJson?.choices?.[0]?.message?.content ?? "";
    let parsed: { points?: GrammarPoint[] } = {};
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    } catch (e) {
      console.warn("Failed to parse AI JSON", e);
    }

    const candidates = Array.isArray(parsed.points) ? parsed.points : [];
    const fresh: GrammarPoint[] = [];
    for (const p of candidates) {
      if (!p?.title || !p?.explanation) continue;
      const key = normTitle(p.title);
      if (!key || existingTitleSet.has(key)) continue;
      existingTitleSet.add(key);
      fresh.push({
        title: String(p.title).slice(0, 120),
        explanation: String(p.explanation).slice(0, 600),
        examples: Array.isArray(p.examples) ? p.examples.slice(0, 3).map((s) => String(s).slice(0, 300)) : [],
        cefr_level: target_level,
      });
    }

    if (fresh.length === 0) {
      return new Response(JSON.stringify({ added: 0, points: [], message: "No new grammar points (all duplicates or invalid)." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // File each note in the shared taxonomy before saving, so the key it was
    // filed under travels with the note rather than having to be re-derived.
    // Sequential on purpose: several notes in one batch often canonicalise to
    // the same key, and racing them turns the insert-if-absent into a pile of
    // duplicate-key conflicts for no gain on a list this short.
    const conceptKeys: string[] = [];
    for (const point of fresh) {
      const key = await fileConcept(service, point, { dialect, videoId });
      if (key) {
        point.concept_key = key;
        conceptKeys.push(key);
      }
    }

    const merged = [...existing, ...fresh];
    const { error: upErr } = await service
      .from("discover_videos")
      .update({ grammar_points: merged })
      .eq("id", videoId);
    if (upErr) {
      return new Response(JSON.stringify({ error: `Failed to save: ${upErr.message}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        added: fresh.length,
        points: fresh,
        total: merged.length,
        // What the extraction contributed to the curriculum, not just to this
        // page — the caller can say so, and a test can assert it.
        concept_keys: [...new Set(conceptKeys)],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("extract-grammar-points error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
