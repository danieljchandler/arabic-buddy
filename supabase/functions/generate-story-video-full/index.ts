// generate-story-video-full — After admin approves the preview, generate a
// coherent multi-scene film for the story. The planner reads the ENTIRE script
// once and returns a shared style anchor + character sheet + ordered scenes.
// Every Veo prompt is prefixed with that shared context so all clips feel like
// one continuous film. English text / speech / signage is explicitly forbidden.

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
const MIN_SCENES = 3;
const MAX_SCENES = 6;

const NEGATIVE = "no english text, no latin letters, no subtitles, no captions, no watermarks, no logos, no western signage, no modern anachronisms, no cartoon or anime style, no on-screen text of any language";

type Story = {
  id: string;
  title: string;
  title_arabic: string | null;
  body_english: string | null;
  body_fusha: string | null;
  dialect: string | null;
  story_video_approved: boolean | null;
};

type Plan = {
  style_anchor: string;
  characters: { id: string; appearance: string }[];
  scenes: {
    index: number;
    arabic_beat: string;
    visual_prompt: string;
    characters_in_scene: string[];
  }[];
};

function culturalSetting(dialect: string | null): string {
  const d = (dialect ?? "").toLowerCase();
  if (d.includes("gulf") || d.includes("khaleeji") || d.includes("emirati") || d.includes("saudi")) return "authentic Gulf Arab (Khaleeji) setting: kanduras, ghutras, traditional souq or majlis architecture, desert or coastal palette";
  if (d.includes("egypt")) return "authentic Egyptian setting: Cairo streets, galabiyas, distinctive Egyptian architecture and warm tones";
  if (d.includes("yemen")) return "authentic Yemeni setting: Sana'a tower houses, jambiya belts, mountain terrain";
  if (d.includes("levant") || d.includes("syria") || d.includes("lebanon") || d.includes("palest") || d.includes("jordan")) return "authentic Levantine setting: old-city stone architecture, Damascus/Beirut street life";
  return "authentic Arab cultural setting matching the story's origin";
}

async function planFilm(story: Story): Promise<Plan> {
  const fullArabic = story.body_fusha ?? "";
  const fullEnglish = story.body_english ?? "";
  const setting = culturalSetting(story.dialect);

  const system = `You are a cinematic director planning a short photorealistic film that adapts an Arabic story with total fidelity to the script. You will read the ENTIRE story before responding. You will design a coherent visual world so every shot feels like one continuous film.

Return STRICT JSON with this exact shape:
{
  "style_anchor": "one paragraph (<= 60 words) describing shared cinematic style: lighting, color palette, era, film grain, camera lens feel, and the ${setting}",
  "characters": [
    { "id": "short_slug", "appearance": "concrete visual description: age, build, face, hair, exact clothing, distinguishing features" }
  ],
  "scenes": [
    {
      "index": 0,
      "arabic_beat": "the Arabic sentence(s) from the story this scene depicts, quoted verbatim",
      "visual_prompt": "8-second single continuous shot description. Describe WHAT HAPPENS in the frame that visually matches the arabic_beat. Include camera framing and motion. Do NOT include style/setting/character descriptions here (those are prepended automatically). Do NOT include dialogue or narration. No on-screen text.",
      "characters_in_scene": ["character_id_slug", ...]
    }
  ]
}

Hard rules:
- Between ${MIN_SCENES} and ${MAX_SCENES} scenes, ordered start-to-end, covering the WHOLE story with no gaps.
- Every scene MUST correspond to real content from the provided Arabic script. Do not invent events not in the story.
- Characters listed once with consistent appearance; reused across scenes by id.
- Scene visual_prompt must be a SINGLE continuous camera shot (no cuts, no split-screen, no montage).
- ${NEGATIVE}.
- Setting: ${setting}.
- Output valid JSON only, no prose, no markdown fences.`;

  const user = `STORY TITLE: ${story.title}${story.title_arabic ? ` / ${story.title_arabic}` : ""}
DIALECT: ${story.dialect ?? "unspecified"}

ARABIC SCRIPT (authoritative — every scene must match this):
${fullArabic}

${fullEnglish ? `ENGLISH REFERENCE TRANSLATION (context only, do NOT use English words in prompts):\n${fullEnglish}` : ""}`;

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Lovable-API-Key": LOVABLE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) throw new Error(`film planning failed: ${resp.status} ${await resp.text()}`);
  const json = await resp.json();
  const content: string = json.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as Plan;
  if (!parsed.style_anchor || !Array.isArray(parsed.scenes) || parsed.scenes.length < MIN_SCENES) {
    throw new Error("planner produced invalid plan");
  }
  return {
    style_anchor: parsed.style_anchor,
    characters: Array.isArray(parsed.characters) ? parsed.characters : [],
    scenes: parsed.scenes.slice(0, MAX_SCENES),
  };
}

function buildScenePrompt(plan: Plan, sceneIdx: number): string {
  const scene = plan.scenes[sceneIdx];
  const cast = (scene.characters_in_scene ?? [])
    .map((id) => plan.characters.find((c) => c.id === id))
    .filter(Boolean)
    .map((c) => `- ${c!.id}: ${c!.appearance}`)
    .join("\n");
  const continuity = sceneIdx === 0
    ? "OPENING SHOT of the film."
    : `Scene ${sceneIdx + 1} of ${plan.scenes.length}. Maintain visual continuity with prior scenes (same style, same characters, same world).`;

  return [
    `CINEMATIC STYLE (constant across the film): ${plan.style_anchor}`,
    cast ? `CHARACTERS IN THIS SHOT (keep their appearance identical to prior scenes):\n${cast}` : "",
    continuity,
    `ACTION (this shot must visually depict this exact story beat): ${scene.arabic_beat}`,
    `SHOT: ${scene.visual_prompt}`,
    `CONSTRAINTS: ${NEGATIVE}. No spoken dialogue. Ambient sound only.`,
  ].filter(Boolean).join("\n\n");
}

async function generateClip(prompt: string): Promise<Uint8Array> {
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
          generateAudio: false,
          negativePrompt: NEGATIVE,
        },
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

async function runFull(admin: ReturnType<typeof createClient>, story: Story, plan: Plan) {
  try {
    const segments: { url: string; prompt: string; index: number; arabic_beat: string }[] = [];

    for (let i = 0; i < plan.scenes.length; i++) {
      try {
        const prompt = buildScenePrompt(plan, i);
        const bytes = await generateClip(prompt);
        const path = `authentic-stories/${story.id}/full-${i}-${Date.now()}.mp4`;
        const up = await admin.storage.from(BUCKET).upload(path, bytes, {
          contentType: "video/mp4",
          upsert: true,
        });
        if (up.error) throw up.error;
        const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
        segments.push({
          url: pub.publicUrl,
          prompt,
          index: i,
          arabic_beat: plan.scenes[i].arabic_beat,
        });

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
      .select("id, title, title_arabic, body_english, body_fusha, dialect, story_video_approved")
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

    const plan = await planFilm(story as Story);
    console.log("planned film", story_id, "scenes:", plan.scenes.length, "chars:", plan.characters.length);

    await admin
      .from("authentic_stories")
      .update({
        story_video_full_status: "generating",
        story_video_full_error: null,
        story_video_segments: [],
      })
      .eq("id", story_id);

    // @ts-ignore EdgeRuntime provided by Supabase edge runtime
    EdgeRuntime.waitUntil(runFull(admin, story as Story, plan));

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
