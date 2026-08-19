// generate-story-cover — Admin-only. Generate (or regenerate) the cover
// illustration for one interactive story and store it on
// interactive_stories.cover_image_url.
//
// Body: { story_id, prompt_extra? }
//   - prompt_extra, when present, is appended to the built prompt so an admin
//     can steer a regeneration ("make it a night scene") without replacing
//     the house style.
//
// The style block matches the committed brand illustrations
// (src/assets/illustrations) so generated covers sit in the same visual
// family as the static art.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const IMAGE_MODEL = "google/gemini-3.1-flash-image";
// Story media convention: everything story-shaped lives in listen-audio,
// same as the story video/scene functions.
const BUCKET = "listen-audio";

const STYLE = `Warm storybook watercolor illustration, hand-painted feel with
soft watercolor washes and gentle paper grain. Palette anchored to warm sand
beige #E2C5A6, terracotta desert red #8C4135, deep desert green #44663D,
charcoal #323A36 and cream #F9F4EA. Soft warm light, cozy and inviting mood.
Full-bleed composition painted edge to edge, no white border. Absolutely no
text, no lettering, no captions, no watermark.`;

function culturalSetting(dialect: string | null): string {
  switch ((dialect ?? "").toLowerCase()) {
    case "egyptian":
      return "Egyptian setting: Cairo streets, mashrabiya balconies, the Nile, ahwa cafés, felucca boats.";
    case "yemeni":
      return "Yemeni setting: Old Sana'a tower houses with white gypsum trim and qamariya windows, terraced mountains.";
    case "levantine":
      return "Levantine setting: stone alleys, courtyard houses with citrus trees, hills of the Levant.";
    default:
      return "Gulf Arabian setting: coastal majlis, dhow boats, palm groves, sadu-weave textiles, kanduras and ghutras.";
  }
}

async function generateImage(prompt: string): Promise<Uint8Array> {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Lovable-API-Key": LOVABLE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!resp.ok) throw new Error(`image gen failed: ${resp.status} ${await resp.text()}`);
  const json = await resp.json();
  const b64: string | undefined = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error("no image in response");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!LOVABLE_API_KEY) throw new Error("Missing LOVABLE_API_KEY");

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: canManage } = await admin.rpc("can_manage_content");
    if (!canManage) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { story_id, prompt_extra } = await req.json();
    if (!story_id) {
      return new Response(JSON.stringify({ error: "missing story_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: story, error: storyErr } = await admin
      .from("interactive_stories")
      .select("id, title, title_arabic, description, dialect, difficulty")
      .eq("id", story_id)
      .single();
    if (storyErr || !story) throw new Error("story not found");

    const prompt = [
      STYLE,
      culturalSetting(story.dialect),
      `Book-cover scene for a short interactive story titled "${story.title}".`,
      story.description ? `The story: ${story.description}` : "",
      "One clear focal moment from the story's premise, landscape composition.",
      typeof prompt_extra === "string" && prompt_extra.trim() ? prompt_extra.trim() : "",
    ].filter(Boolean).join("\n");

    const bytes = await generateImage(prompt);

    const path = `interactive-stories/${story_id}/cover-${Date.now()}.png`;
    const up = await admin.storage.from(BUCKET).upload(path, bytes, {
      contentType: "image/png",
      upsert: true,
    });
    if (up.error) throw up.error;
    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);

    const { error: updateErr } = await admin
      .from("interactive_stories")
      .update({ cover_image_url: pub.publicUrl })
      .eq("id", story_id);
    if (updateErr) throw updateErr;

    return new Response(JSON.stringify({ ok: true, cover_image_url: pub.publicUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("generate-story-cover error", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
