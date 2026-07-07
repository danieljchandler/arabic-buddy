// generate-story-video — Generates an admin-review preview for an authentic
// story. Veo is used for visuals only; exact Arabic narration is generated
// separately via TTS and stored on video_preview_url so the video model never
// gets to improvise English speech.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { estimateSeconds, planProvider, synthesizeLine } from "../_shared/listenTts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;

const VEO_MODEL = "veo-3.1-fast-generate-preview";
// listen-audio is the project's public media bucket; story-videos is private and
// workspace policy blocks flipping it to public, so we reuse listen-audio for playback.
const BUCKET = "listen-audio";
const POLL_INTERVAL_MS = 10_000;
const POLL_MAX_MS = 10 * 60_000; // 10 min
const NEGATIVE = "English speech, English text, Latin letters, captions, subtitles, signs, logos, watermarks, talking, dialogue, narration, voices, mouth speaking, on-screen text of any language";

type Story = {
  id: string;
  title: string;
  title_arabic: string | null;
  body_english: string | null;
  body_fusha: string | null;
  dialect: string | null;
};

type StoryLine = {
  arabic: string | null;
  arabic_vocalized: string | null;
  dialect: string | null;
  dialect_vocalized: string | null;
};

function hasLatin(text: string): boolean {
  return /[A-Za-z]/.test(text);
}

function normalizeArabicText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function firstWords(text: string, maxWords: number): string {
  return normalizeArabicText(text).split(/\s+/).slice(0, maxWords).join(" ");
}

function pickLineText(line: StoryLine): string {
  return normalizeArabicText(
    line.dialect_vocalized || line.arabic_vocalized || line.dialect || line.arabic || "",
  );
}

function buildNarrationText(story: Story, lines: StoryLine[]): string {
  const fromLines = lines.map(pickLineText).find(Boolean);
  const source = fromLines || story.body_fusha || "";
  const firstSentence = normalizeArabicText(source).split(/(?<=[.!?؟。])\s+/)[0] || source;
  const narration = firstWords(firstSentence, 26);
  if (!narration) throw new Error("No Arabic script found for preview narration");
  if (hasLatin(narration)) throw new Error("Preview narration contains Latin/English characters");
  return narration;
}

async function synthesizePreviewNarration(
  admin: ReturnType<typeof createClient>,
  story: Story,
  lines: StoryLine[],
): Promise<{ url: string; text: string; duration: number }> {
  const text = buildNarrationText(story, lines);
  const plan = await planProvider(story.dialect || "Gulf");
  const bytes = await synthesizeLine(text, "narrator", 0, plan);
  const path = `authentic-stories/${story.id}/preview-narration-${Date.now()}.${plan.ext}`;
  const up = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: plan.contentType,
    upsert: true,
  });
  if (up.error) throw up.error;
  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  return { url: pub.publicUrl, text, duration: estimateSeconds(bytes.byteLength, plan) };
}

function buildPrompt(story: Story, narrationText: string): string {
  const arabicScript = normalizeArabicText(story.body_fusha || narrationText).slice(0, 1400);
  const dialectCtx = story.dialect
    ? ` The setting reflects an authentic ${story.dialect} Arab cultural context.`
    : "";
  return `Create an 8-second silent cinematic visual preview for this Arabic story.${dialectCtx}

Arabic story title: ${story.title_arabic || story.title}
Exact Arabic script excerpt to depict visually, without changing the events:
${arabicScript}

The separate narration audio will say exactly: «${narrationText}»

Visual requirements: match the Arabic script excerpt precisely; show the characters, setting, and action implied by the Arabic text. Warm cinematic lighting, authentic Arab cultural details, gentle camera movement, photorealistic.

Audio/text constraints for the generated video: visuals only. No speech, no voices, no dialogue, no narration, no lip-sync, no subtitles, no captions, no on-screen text, no logos, no signs. Never include English or Latin letters.`;
}

async function pollAndStore(admin: ReturnType<typeof createClient>, storyId: string, opName: string) {
  const started = Date.now();
  try {
    while (Date.now() - started < POLL_MAX_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const opRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${opName}?key=${GEMINI_API_KEY}`,
      );
      if (!opRes.ok) {
        const txt = await opRes.text();
        console.error("veo poll error", opRes.status, txt);
        continue;
      }
      const op = await opRes.json();
      if (!op.done) continue;

      if (op.error) {
        throw new Error(`Veo failed: ${JSON.stringify(op.error)}`);
      }

      const gen = op.response?.generateVideoResponse ?? op.response;
      const sample = gen?.generatedSamples?.[0] ?? gen?.generatedVideos?.[0];
      const uri: string | undefined = sample?.video?.uri;
      if (!uri) throw new Error(`No video uri in response: ${JSON.stringify(op.response).slice(0, 400)}`);

      // Download the MP4 (Google requires the API key)
      const dlUrl = uri.includes("?") ? `${uri}&key=${GEMINI_API_KEY}` : `${uri}?key=${GEMINI_API_KEY}`;
      const vidRes = await fetch(dlUrl);
      if (!vidRes.ok) throw new Error(`download failed: ${vidRes.status}`);
      const bytes = new Uint8Array(await vidRes.arrayBuffer());

      const path = `authentic-stories/${storyId}/preview-${Date.now()}.mp4`;
      const up = await admin.storage.from(BUCKET).upload(path, bytes, {
        contentType: "video/mp4",
        upsert: true,
      });
      if (up.error) throw up.error;

      const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
      await admin
        .from("authentic_stories")
        .update({
          story_video_url: pub.publicUrl,
          story_video_status: "ready",
          story_video_error: null,
        })
        .eq("id", storyId);
      console.log("story video ready", storyId, pub.publicUrl);
      return;
    }
    throw new Error("timeout waiting for Veo");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("generate-story-video bg failed", storyId, message);
    await admin
      .from("authentic_stories")
      .update({ story_video_status: "failed", story_video_error: message.slice(0, 500) })
      .eq("id", storyId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { story_id } = await req.json();
    if (!story_id) {
      return new Response(JSON.stringify({ error: "missing story_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: story, error: storyErr } = await admin
      .from("authentic_stories")
      .select("id, title, title_arabic, body_english, body_fusha, dialect")
      .eq("id", story_id)
      .single();
    if (storyErr || !story) {
      return new Response(JSON.stringify({ error: "story_not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: lines } = await admin
      .from("authentic_story_lines")
      .select("arabic, arabic_vocalized, dialect, dialect_vocalized")
      .eq("story_id", story_id)
      .order("line_index", { ascending: true })
      .limit(3);

    const narration = await synthesizePreviewNarration(admin, story as Story, (lines ?? []) as StoryLine[]);
    const prompt = buildPrompt(story as Story, narration.text);
    console.log("veo prompt", story_id, prompt.slice(0, 200));

    // Persist the deterministic Arabic narration immediately. Video kickoff can
    // fail because of upstream quota/rate limits, but the admin should still be
    // able to review the Arabic preview audio that was already generated.
    await admin
      .from("authentic_stories")
      .update({
        video_preview_url: narration.url,
        line_durations: [narration.duration],
        video_status: "preview_audio_generated",
      })
      .eq("id", story_id);

    // Kick off Veo long-running generation
    const kickoff = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${VEO_MODEL}:predictLongRunning?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: {
            aspectRatio: "16:9",
            personGeneration: "allow_all",
            durationSeconds: 8,
            negativePrompt: NEGATIVE,
          },
        }),
      },
    );

    if (!kickoff.ok) {
      const txt = await kickoff.text();
      console.error("veo kickoff failed", kickoff.status, txt);
      const quotaExhausted = kickoff.status === 429 || txt.includes("RESOURCE_EXHAUSTED");
      const videoError = quotaExhausted
        ? "Video quota exhausted. Arabic preview audio was generated successfully; try preview video again later."
        : txt.slice(0, 500);
      await admin
        .from("authentic_stories")
        .update({ story_video_status: "failed", story_video_error: videoError })
        .eq("id", story_id);

      if (quotaExhausted) {
        return new Response(JSON.stringify({
          status: "audio_ready_video_quota_exhausted",
          preview_url: narration.url,
          detail: videoError,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "veo_kickoff_failed", detail: txt }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const opJson = await kickoff.json();
    const opName: string | undefined = opJson.name;
    if (!opName) throw new Error(`no operation name: ${JSON.stringify(opJson)}`);

    await admin
      .from("authentic_stories")
      .update({
        story_video_status: "generating",
        story_video_operation: opName,
        story_video_error: null,
        story_video_approved: false,
        video_preview_url: narration.url,
        line_durations: [narration.duration],
      })
      .eq("id", story_id);

    // @ts-ignore EdgeRuntime is provided by Deno Deploy in Supabase edge functions
    EdgeRuntime.waitUntil(pollAndStore(admin, story_id, opName));

    return new Response(
      JSON.stringify({ status: "generating", operation: opName }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("generate-story-video error", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
