// generate-listen-script — Creates a podcast/TED/interview/story script in dialect
// and inserts it into listen_episodes. Returns the new episode row.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { askBrain } from "../_shared/aiBrain.ts";
import { primeDialectPrompt, type Dialect } from "../_shared/dialectHelpers.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Format = "podcast" | "ted" | "interview" | "story";
type Length = "short" | "medium" | "long";

const LENGTH_TARGETS: Record<Length, { lines: string; words: string }> = {
  short: { lines: "10-14", words: "150-250" },
  medium: { lines: "18-28", words: "400-600" },
  long: { lines: "32-48", words: "800-1200" },
};

const FORMAT_FRAMING: Record<Format, string> = {
  podcast: `Format: a warm, conversational podcast between TWO hosts (Host A and Host B).
Structure: a quick intro/hook → 2-3 segments exploring the topic with personal anecdotes, jokes, light disagreement, and concrete examples → a short outro.
Tone: natural, spontaneous, peppered with discourse markers (يعني، شوف، صح، والله، طيب) appropriate to the dialect.
Alternate speakers naturally; each line is one short turn (no long monologues).`,
  ted: `Format: a SOLO TED-style talk delivered by one speaker (Speaker).
Structure: a striking opening hook → a personal story or vivid example → the core idea/insight → practical implications → a memorable closing line / call to action.
Tone: passionate, intimate, well-crafted; vary sentence rhythm; use rhetorical questions sparingly.
Every line is one beat of the talk (one short paragraph).`,
  interview: `Format: an INTERVIEW between a Host and a Guest expert (Host and Guest).
Structure: short context intro → 4-7 sharp, specific questions → substantive answers with concrete examples, numbers, or stories → a quick wrap.
Alternate Host (question) and Guest (answer). Questions are curious and probing, not generic. Answers feel lived-in.`,
  story: `Format: a NARRATIVE short story.
Structure: setup (character, place, ordinary moment) → inciting moment → escalation → twist or revelation → quiet resolution.
Use a Narrator for prose lines and named character speakers (e.g., "أم سالم", "خالد") for dialogue. Mix narration with vivid dialogue. Concrete sensory detail. Avoid moralizing.`,
};

interface ScriptLine {
  speaker: string;
  speaker_role: string;
  arabic: string;
  english: string;
  transliteration?: string;
}

interface BrainPayload {
  title: string;
  summary: string;
  script: ScriptLine[];
  key_vocabulary: Array<{ arabic: string; english: string; note?: string }>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const cap = await enforceDailyCap(req, "listen_generate", 5, corsHeaders);
    if (cap.limited) return cap.response;
    const userId = cap.userId;

    const body = await req.json().catch(() => ({}));
    const dialect = (body?.dialect as Dialect) || "Gulf";
    const format = (body?.format as Format) || "podcast";
    const topic = String(body?.topic ?? "").trim();
    const topicCategory = body?.topicCategory ? String(body.topicCategory) : null;
    const length = (body?.length as Length) || "medium";
    const audioMode = (body?.audioMode as "full" | "on_demand") || "on_demand";

    if (!topic) {
      return new Response(JSON.stringify({ error: "topic_required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!["podcast", "ted", "interview", "story"].includes(format)) {
      return new Response(JSON.stringify({ error: "invalid_format" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!["short", "medium", "long"].includes(length)) {
      return new Response(JSON.stringify({ error: "invalid_length" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await primeDialectPrompt(dialect).catch(() => {});

    const target = LENGTH_TARGETS[length];
    const framing = FORMAT_FRAMING[format];

    const systemExtra = `You are a creative writer producing engaging spoken-word content in dialect Arabic.

${framing}

LENGTH: Produce ${target.lines} lines, totaling ${target.words} Arabic words across all lines.
TOPIC: "${topic}"

DIALECT RULES (CRITICAL):
- Every Arabic line MUST be in the target dialect — never Modern Standard Arabic.
- No cross-dialect leakage (e.g., do not use Egyptian forms in a Gulf script).
- Speaker labels should be short and natural in the target culture.

OUTPUT:
- title: a short, catchy Arabic title (≤ 60 chars).
- summary: a one-sentence English teaser (≤ 140 chars).
- script: array of lines, each { speaker, speaker_role, arabic, english, transliteration? }.
  - speaker_role: one of "host_a","host_b","speaker","host","guest","narrator","character".
  - arabic: the line in target dialect.
  - english: faithful natural English translation.
  - transliteration: optional simple Latin transliteration.
- key_vocabulary: 8-15 useful words or short phrases drawn from the script: { arabic, english, note? } — pick learner-valuable items, not function words.

Return ONLY the structured fields via the provided tool.`;

    const userPrompt = `Write the ${format} now about: ${topic}. Make it genuinely interesting — surprising angles, concrete details, real emotion.`;

    let brain;
    try {
      brain = await askBrain<BrainPayload>({
        purpose: "story",
        dialect,
        strategy: "draft_critic",
        systemPromptExtra: systemExtra,
        userPrompt,
        maxTokens: 8000,
        temperature: 0.8,
        arabicTextPath: (p: any) =>
          Array.isArray(p?.script) ? p.script.map((l: any) => l?.arabic ?? "").join("\n") : "",
        tool: {
          name: "emit_episode",
          description: "Return the full dialect-Arabic script with translations and key vocabulary.",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string" },
              summary: { type: "string" },
              script: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    speaker: { type: "string" },
                    speaker_role: { type: "string" },
                    arabic: { type: "string" },
                    english: { type: "string" },
                    transliteration: { type: "string" },
                  },
                  required: ["speaker", "speaker_role", "arabic", "english"],
                },
              },
              key_vocabulary: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    arabic: { type: "string" },
                    english: { type: "string" },
                    note: { type: "string" },
                  },
                  required: ["arabic", "english"],
                },
              },
            },
            required: ["title", "summary", "script", "key_vocabulary"],
          },
        },
      });
    } catch (e: any) {
      console.error("listen-script brain error", e?.status, e?.message);
      return new Response(
        JSON.stringify({ error: "ai_failed", detail: String(e?.message ?? e).slice(0, 400) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const parsed = brain.output;
    const script = Array.isArray(parsed.script) ? parsed.script.filter((l) => l?.arabic) : [];
    if (script.length < 4) {
      return new Response(
        JSON.stringify({ error: "empty_script", raw: brain.raw.slice(0, 400) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const title = String(parsed.title ?? "").slice(0, 200) || topic.slice(0, 200);
    const summary = String(parsed.summary ?? "").slice(0, 500);
    const keyVocab = Array.isArray(parsed.key_vocabulary) ? parsed.key_vocabulary.slice(0, 20) : [];

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: episode, error: saveErr } = await admin
      .from("listen_episodes")
      .insert({
        creator_id: userId,
        dialect,
        format,
        topic,
        topic_category: topicCategory,
        length_bucket: length,
        title,
        summary,
        script,
        key_vocabulary: keyVocab,
        audio_mode: audioMode,
        audio_status: audioMode === "full" ? "pending" : "none",
      })
      .select("*")
      .single();

    if (saveErr || !episode) {
      console.error("listen-script save error", saveErr);
      return new Response(
        JSON.stringify({ error: "save_failed", detail: saveErr?.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Kick off full-audio generation as a background task (non-blocking)
    if (audioMode === "full") {
      const authHeader = req.headers.get("Authorization") ?? "";
      // fire and forget
      fetch(`${SUPABASE_URL}/functions/v1/generate-listen-audio`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        },
        body: JSON.stringify({ episodeId: episode.id }),
      }).catch((e) => console.warn("listen-audio dispatch failed:", e?.message));
    }

    return new Response(JSON.stringify({ episode }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("generate-listen-script fatal", e);
    return new Response(JSON.stringify({ error: "internal", detail: String(e?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
