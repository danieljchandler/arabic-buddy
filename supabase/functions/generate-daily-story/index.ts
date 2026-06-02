// Generate (or fetch) the user's personalized ~200-word daily story.
// Uses up to ~15 mature SRS words from their My Words deck + 5 NEW words
// for the active dialect. Cached per (user, date, dialect) in
// `daily_vocab_stories`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { askBrain } from "../_shared/aiBrain.ts";
import type { Dialect } from "../_shared/dialectHelpers.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface VocabRow {
  word_arabic: string;
  word_english: string;
  stage: string;
  interval_days: number;
}

function todayUtc(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Free-tier daily cap
  const cap = await enforceDailyCap(req, "generate-daily-story", 5, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const dialect: string = (body?.dialect as string) || "Gulf";
    const force: boolean = !!body?.force;
    const today = todayUtc();

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 1. Return cached if exists & not forced
    if (!force) {
      const { data: existing } = await admin
        .from("daily_vocab_stories")
        .select("*")
        .eq("user_id", user.id)
        .eq("story_date", today)
        .eq("dialect", dialect)
        .maybeSingle();
      if (existing) {
        return new Response(JSON.stringify({ story: existing, cached: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 2. Pick vocab from the user's deck
    const { data: matureRows } = await admin
      .from("user_vocabulary")
      .select("word_arabic, word_english, stage, interval_days")
      .eq("user_id", user.id)
      .eq("dialect", dialect)
      .gte("interval_days", 7)
      .order("interval_days", { ascending: false })
      .limit(15);

    const { data: newRows } = await admin
      .from("user_vocabulary")
      .select("word_arabic, word_english, stage, interval_days")
      .eq("user_id", user.id)
      .eq("dialect", dialect)
      .eq("stage", "NEW")
      .order("created_at", { ascending: false })
      .limit(5);

    const mature = (matureRows ?? []) as VocabRow[];
    const fresh = (newRows ?? []) as VocabRow[];

    if (mature.length + fresh.length < 3) {
      return new Response(
        JSON.stringify({
          error: "not_enough_vocab",
          message: "Add a few more words to your deck to unlock your daily story.",
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const matureList = mature.map((w) => `${w.word_arabic} (${w.word_english})`).join(", ");
    const newList = fresh.map((w) => `${w.word_arabic} (${w.word_english})`).join(", ");

    // 3. Ask the brain for a ~200-word story (draft_critic strategy, dialect-guarded)
    const systemExtra = `You are a creative Arabic short-story writer.
Write a vivid, self-contained micro-story of about 180-220 Arabic words.
Weave in as many of the learner's MATURE words as feels natural, and gently introduce each of the NEW words at least once (use them in context so meaning is inferable).
Reading level: late beginner to intermediate. Short sentences, concrete imagery, one clear arc.
Return ONLY the structured fields via the provided tool.`;

    const userPrompt = `MATURE words (review-anchored): ${matureList || "(none yet)"}\nNEW words to gently introduce: ${newList || "(none yet)"}`;

    let brain;
    try {
      brain = await askBrain<{
        title: string;
        body_arabic: string;
        body_english: string;
        used_mature: string[];
        used_new: string[];
      }>({
        purpose: "story",
        dialect: dialect as Dialect,
        strategy: "draft_critic",
        systemPromptExtra: systemExtra,
        userPrompt,
        maxTokens: 2048,
        temperature: 0.7,
        arabicTextPath: (p: any) => p?.body_arabic ?? "",
        tool: {
          name: "emit_story",
          description: "Return the daily vocabulary story in the target dialect.",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "Short evocative Arabic title" },
              body_arabic: { type: "string", description: "Story in target dialect, ~200 Arabic words" },
              body_english: { type: "string", description: "Faithful English translation" },
              used_mature: { type: "array", items: { type: "string" } },
              used_new: { type: "array", items: { type: "string" } },
            },
            required: ["title", "body_arabic", "body_english", "used_mature", "used_new"],
          },
        },
      });
    } catch (e: any) {
      console.error("daily-story brain error", e?.status, e?.message);
      return new Response(
        JSON.stringify({ error: "ai_failed", detail: String(e?.message ?? e).slice(0, 400) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (brain.msaLeaks.leaks.length > 0) {
      console.warn("daily-story MSA leaks after repair", brain.msaLeaks.leaks, "repairs:", brain.msaRepairs);
    }

    const parsed = brain.output;


    const title = String(parsed.title ?? "").slice(0, 160) || "قصة اليوم";
    const bodyArabic = String(parsed.body_arabic ?? "").trim();
    const bodyEnglish = String(parsed.body_english ?? "").trim();
    if (!bodyArabic) {
      return new Response(
        JSON.stringify({ error: "empty_story", raw: brain.raw.slice(0, 400) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const vocabUsed = Array.isArray(parsed.used_mature) ? parsed.used_mature : [];
    const newUsed = Array.isArray(parsed.used_new) ? parsed.used_new : [];

    // 4. Upsert
    const { data: saved, error: saveErr } = await admin
      .from("daily_vocab_stories")
      .upsert(
        {
          user_id: user.id,
          story_date: today,
          dialect,
          title,
          body_arabic: bodyArabic,
          body_english: bodyEnglish || null,
          vocab_used: vocabUsed,
          new_words: newUsed,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,story_date,dialect" },
      )
      .select("*")
      .single();

    if (saveErr) {
      console.error("daily-story save error", saveErr);
      return new Response(
        JSON.stringify({ error: "save_failed", detail: saveErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ story: saved, cached: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-daily-story unexpected", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
