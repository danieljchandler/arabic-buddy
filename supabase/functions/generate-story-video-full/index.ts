// generate-story-video-full — After admin approves the preview, generate a
// multi-scene "full" video for the story: split the story into ~4 scenes,
// generate a Veo clip per scene, and append each clip URL to
// authentic_stories.story_video_segments.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const VEO_MODEL = "veo-3.1-fast-generate-preview";
const BUCKET = "listen-audio";
const POLL_INTERVAL_MS = 10_000;
const POLL_MAX_MS = 8 * 60_000;
const MAX_SCENES = 4;

type Story = {
  id: string;
  title: string;
  body_english: string | null;
  body_fusha: string | null;
  dialect: string | null;
  story_video_approved: boolean | null;
};

async function planScenes(story: Story): Promise<string[]> {
  const summary = (story.body_english ?? story.body_fusha ?? "").slice(0, 3000);
  const dialect = story.dialect ?? "Arab";
  const sys = `You are a cinematic storyboard artist. Break an Arabic short story into ${MAX_SCENES} sequential visual scenes for a photorealistic short film. Each scene MUST be a self-contained prompt (max 90 words) for a text-to-video model (Google Veo). No on-screen text, no subtitles, no logos. Warm cinematic lighting, ${dialect} cultural setting. Return strict JSON: {"scenes":["...","...","...","..."]}.`;
  const user = `Story title: ${story.title}\n\nStory:\n${summary}`;

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) throw new Error(`scene planning failed: ${resp.status} ${await resp.text()}`);
  const json = await resp.json();
  const content: string = json.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content);
  const scenes: string[] = Array.isArray(parsed.scenes) ? parsed.scenes.filter((s: unknown) => typeof s === "string" && s.length > 10) : [];
  if (scenes.length === 0) throw new Error("no scenes produced");
  return scenes.slice(0, MAX_SCENES);
}

async function generateClip(prompt: string): Promise<Uint8Array> {
  const kickoff = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${VEO_MODEL}:predictLongRunning?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { aspectRatio: "16:9", personGeneration: "allow_all", durationSeconds: 8 },
      }),
    },
  );
  if (!kickoff.ok) throw new Error(`veo kickoff: ${kickoff.status} ${await kickoff.text()}`);
  const { name: opName } = await kickoff.json();
  if (!opName) throw new Error("no operation name");

  const started = Date.now();
  while (Date.now() - started < POLL_MAX_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const opRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${opName}?key=${GEMINI_API_KEY}`,
    );
    if (!opRes.ok) continue;
    const op = await opRes.json();
    if (!op.done) continue;
    if (op.error) throw new Error(`veo error: ${JSON.stringify(op.error)}`);
    const gen = op.response?.generateVideoResponse ?? op.response;
    const sample = gen?.generatedSamples?.[0] ?? gen?.generatedVideos?.[0];
    const uri: string | undefined = sample?.video?.uri;
    if (!uri) throw new Error("no video uri");
    const dlUrl = uri.includes("?") ? `${uri}&key=${GEMINI_API_KEY}` : `${uri}?key=${GEMINI_API_KEY}`;
    const vidRes = await fetch(dlUrl);
    if (!vidRes.ok) throw new Error(`download: ${vidRes.status}`);
    return new Uint8Array(await vidRes.arrayBuffer());
  }
  throw new Error("timeout waiting for Veo");
}

async function runFull(admin: ReturnType<typeof createClient>, story: Story) {
  try {
    const scenes = await planScenes(story);
    console.log("planned scenes", story.id, scenes.length);
    const segments: { url: string; prompt: string; index: number }[] = [];

    for (let i = 0; i < scenes.length; i++) {
      try {
        const bytes = await generateClip(scenes[i]);
        const path = `authentic-stories/${story.id}/full-${i}-${Date.now()}.mp4`;
        const up = await admin.storage.from(BUCKET).upload(path, bytes, {
          contentType: "video/mp4",
          upsert: true,
        });
        if (up.error) throw up.error;
        const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
        segments.push({ url: pub.publicUrl, prompt: scenes[i], index: i });

        // Persist progress after each successful segment
        await admin
          .from("authentic_stories")
          .update({ story_video_segments: segments })
          .eq("id", story.id);
      } catch (segErr) {
        console.error(`scene ${i} failed`, segErr);
      }
    }

    if (segments.length === 0) throw new Error("no segments generated");

    await admin
      .from("authentic_stories")
      .update({ story_video_full_status: "ready", story_video_full_error: null })
      .eq("id", story.id);
    console.log("story full video ready", story.id, segments.length, "segments");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("generate-story-video-full bg failed", story.id, message);
    await admin
      .from("authentic_stories")
      .update({ story_video_full_status: "failed", story_video_full_error: message.slice(0, 500) })
      .eq("id", story.id);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("Missing LOVABLE_API_KEY");

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
      .select("id, title, body_english, body_fusha, dialect, story_video_approved")
      .eq("id", story_id)
      .single();
    if (storyErr || !story) {
      return new Response(JSON.stringify({ error: "story_not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!(story as Story).story_video_approved) {
      return new Response(JSON.stringify({ error: "preview_not_approved" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin
      .from("authentic_stories")
      .update({
        story_video_full_status: "generating",
        story_video_full_error: null,
        story_video_segments: [],
      })
      .eq("id", story_id);

    // @ts-ignore EdgeRuntime provided by Supabase edge runtime
    EdgeRuntime.waitUntil(runFull(admin, story as Story));

    return new Response(JSON.stringify({ status: "generating" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("generate-story-video-full error", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
