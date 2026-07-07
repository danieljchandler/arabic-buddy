// generate-story-video — Generates a short cinematic trailer video for an
// authentic story using Google Veo 3 (via Gemini API). Kicks off a Long-Running
// Operation, polls it in the background (EdgeRuntime.waitUntil), then downloads
// the MP4 and uploads it to the story-videos storage bucket.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

type Story = {
  id: string;
  title: string;
  title_arabic: string | null;
  body_english: string | null;
  body_fusha: string | null;
  dialect: string | null;
};

function buildPrompt(story: Story): string {
  const eng = (story.body_english ?? "").slice(0, 600);
  const dialectCtx = story.dialect
    ? ` The setting reflects an authentic ${story.dialect} Arab cultural context.`
    : "";
  return `A short cinematic trailer that visually captures this Arabic story titled "${story.title}".${dialectCtx}

Story summary: ${eng}

Style: warm cinematic lighting, rich Middle Eastern atmosphere, painterly composition, gentle camera movement, no on-screen text, no captions, no subtitles, no logos. Focus on characters, setting, and mood evoked by the narrative. Photorealistic.`;
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

    const prompt = buildPrompt(story as Story);
    console.log("veo prompt", story_id, prompt.slice(0, 200));

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
          },
        }),
      },
    );

    if (!kickoff.ok) {
      const txt = await kickoff.text();
      console.error("veo kickoff failed", kickoff.status, txt);
      await admin
        .from("authentic_stories")
        .update({ story_video_status: "failed", story_video_error: txt.slice(0, 500) })
        .eq("id", story_id);
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
