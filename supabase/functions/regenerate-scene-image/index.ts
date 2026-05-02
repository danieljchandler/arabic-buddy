/**
 * regenerate-scene-image — generate (or regenerate) the themed image for a
 * picture-scene plus locate every vocabulary word inside it.
 *
 * Auth: admin only (JWT verified, then user_roles checked).
 *
 * Request body:
 *   { sceneId: string, customInstructions?: string, regenerateHotspots?: boolean }
 *
 * Behaviour:
 *   1. Loads the scene + hotspots from the DB.
 *   2. Renders a single themed PNG with google/gemini-3-pro-image-preview
 *      via the Lovable AI gateway.
 *   3. Uploads the PNG to flashcard-images/picture-scenes/{sceneId}.png.
 *   4. Asks google/gemini-2.5-pro (multimodal) to locate each Arabic word in
 *      the rendered image as { x_pct, y_pct } centres (0–100). Words that
 *      cannot be located are returned with x_pct = null so the admin can
 *      place them manually. This step only runs when there are no existing
 *      hotspots with coordinates OR `regenerateHotspots` is true.
 *   5. Updates picture_scenes.image_url and picture_scene_hotspots.{x_pct,y_pct}.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

interface SceneRow {
  id: string;
  dialect: string;
  theme: string;
  title: string;
  title_arabic: string;
  description: string | null;
}

interface HotspotRow {
  id: string;
  word_arabic: string;
  word_english: string;
  x_pct: number | null;
  y_pct: number | null;
}

function buildImagePrompt(scene: SceneRow, words: HotspotRow[], extra?: string): string {
  const wordList = words.map((w) => `- ${w.word_english} (${w.word_arabic})`).join("\n");
  const base = `A single wide horizontal scene illustration depicting "${scene.theme}" for a vocabulary learning flashcard.

The image MUST clearly show ALL of the following objects, each visually distinct, well-separated from the others, and easy to identify and tap on a phone screen:
${wordList}

STYLE GUIDE — follow exactly:
- Photo-realistic style with a slightly painterly / soft-illustrated finish
- Warm neutral background palette (sand, cream, soft beige, warm wood)
- Soft diffused natural lighting, gentle shadows, no harsh highlights
- Clean composition, objects arranged so none significantly overlaps another
- Each object roughly 8-15% of the frame width, fully visible (no cropping)
- Wide 4:3 landscape framing, eye-level perspective
- No text, labels, watermarks, captions or signage of any kind
- No people, no faces, no hands
- Cohesive single scene (e.g. "kitchen counter top" not a collage of cutouts)
- Matte finish, no glossy or specular highlights`;

  return extra ? `${base}\n\nAdditional instructions: ${extra}` : base;
}

async function generateImage(prompt: string, apiKey: string): Promise<string> {
  // Try the higher-quality pro image model first; fall back to flash-image if unavailable.
  const models = [
    "google/gemini-3-pro-image-preview",
    "google/gemini-3.1-flash-image-preview",
    "google/gemini-2.5-flash-image",
  ];
  let lastErr = "";
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(LOVABLE_GATEWAY, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            modalities: ["image", "text"],
          }),
          signal: AbortSignal.timeout(120_000),
        });
        if (res.status === 429) throw new Error("RATE_LIMIT");
        if (res.status === 402) throw new Error("PAYMENT_REQUIRED");
        if (!res.ok) {
          lastErr = `${model} ${res.status} ${(await res.text()).slice(0, 200)}`;
          continue;
        }
        const data = await res.json();
        const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
        if (url) return url;
        lastErr = `${model}: empty image`;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === "RATE_LIMIT" || msg === "PAYMENT_REQUIRED") throw e;
        lastErr = `${model} threw: ${msg}`;
      }
    }
  }
  throw new Error(`All image models failed. Last: ${lastErr}`);
}

interface LocatedWord {
  word_arabic: string;
  x_pct: number | null;
  y_pct: number | null;
}

async function locateWords(
  imageDataUrl: string,
  words: HotspotRow[],
  apiKey: string,
): Promise<LocatedWord[]> {
  const wordList = words.map((w, i) => `${i + 1}. ${w.word_arabic} — ${w.word_english}`).join("\n");
  const systemMsg = `You are a vision model that locates objects in images. The user provides an image and a list of vocabulary words. For each word, return the centre point of the matching object as percentages of image width (x_pct) and image height (y_pct), where 0,0 is top-left and 100,100 is bottom-right. If you cannot find an object that matches, return null for both. Respond ONLY by calling the locate_objects tool.`;

  const res = await fetch(LOVABLE_GATEWAY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: systemMsg },
        {
          role: "user",
          content: [
            { type: "text", text: `Locate these objects in the image:\n${wordList}` },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "locate_objects",
            description: "Return centre coordinates for each requested word.",
            parameters: {
              type: "object",
              properties: {
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      word_arabic: { type: "string" },
                      x_pct: { type: ["number", "null"] },
                      y_pct: { type: ["number", "null"] },
                    },
                    required: ["word_arabic", "x_pct", "y_pct"],
                  },
                },
              },
              required: ["items"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "locate_objects" } },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    console.warn(`locate-words failed ${res.status} ${(await res.text()).slice(0, 200)}`);
    return words.map((w) => ({ word_arabic: w.word_arabic, x_pct: null, y_pct: null }));
  }

  const data = await res.json();
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) {
    return words.map((w) => ({ word_arabic: w.word_arabic, x_pct: null, y_pct: null }));
  }
  try {
    const args = JSON.parse(call.function?.arguments ?? "{}");
    const items = Array.isArray(args.items) ? args.items : [];
    return words.map((w) => {
      const match = items.find(
        (it: { word_arabic?: string }) => it.word_arabic === w.word_arabic,
      );
      const xRaw = match?.x_pct;
      const yRaw = match?.y_pct;
      const x = typeof xRaw === "number" ? Math.max(2, Math.min(98, xRaw)) : null;
      const y = typeof yRaw === "number" ? Math.max(2, Math.min(98, yRaw)) : null;
      return { word_arabic: w.word_arabic, x_pct: x, y_pct: y };
    });
  } catch {
    return words.map((w) => ({ word_arabic: w.word_arabic, x_pct: null, y_pct: null }));
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: roles } = await supabaseAuth
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    if (!roles?.some((r: { role: string }) => r.role === "admin")) {
      return new Response(JSON.stringify({ error: "Admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { sceneId, customInstructions, regenerateHotspots } = await req.json();
    if (!sceneId) {
      return new Response(JSON.stringify({ error: "sceneId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: scene, error: sceneErr } = await admin
      .from("picture_scenes")
      .select("id, dialect, theme, title, title_arabic, description")
      .eq("id", sceneId)
      .single();
    if (sceneErr || !scene) throw new Error(`Scene not found: ${sceneErr?.message}`);

    const { data: hotspots, error: hsErr } = await admin
      .from("picture_scene_hotspots")
      .select("id, word_arabic, word_english, x_pct, y_pct")
      .eq("scene_id", sceneId)
      .order("display_order");
    if (hsErr) throw hsErr;
    if (!hotspots || hotspots.length === 0) throw new Error("Scene has no hotspots/words");

    const prompt = buildImagePrompt(scene as SceneRow, hotspots as HotspotRow[], customInstructions);
    console.log(`regenerate-scene-image: scene=${sceneId} words=${hotspots.length}`);

    const imageDataUrl = await generateImage(prompt, apiKey);

    // Decode and upload
    const b64 = imageDataUrl.replace(/^data:image\/\w+;base64,/, "");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const path = `picture-scenes/${sceneId}.png`;
    const { error: upErr } = await admin.storage
      .from("flashcard-images")
      .upload(path, bytes, { contentType: "image/png", upsert: true });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

    const { data: urlData } = admin.storage.from("flashcard-images").getPublicUrl(path);
    const imageUrl = `${urlData.publicUrl}?t=${Date.now()}`;

    await admin.from("picture_scenes").update({ image_url: imageUrl }).eq("id", sceneId);

    // Re-locate hotspots if requested OR if any are missing coordinates
    const needsLocate = regenerateHotspots ||
      (hotspots as HotspotRow[]).some((h) => h.x_pct == null || h.y_pct == null);

    if (needsLocate) {
      const located = await locateWords(imageDataUrl, hotspots as HotspotRow[], apiKey);
      // Distribute words that couldn't be located across a fallback grid
      const unlocated = located.filter((l) => l.x_pct == null || l.y_pct == null);
      const cols = Math.max(1, Math.ceil(Math.sqrt(unlocated.length)));
      let i = 0;
      for (const u of unlocated) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        u.x_pct = ((col + 0.5) * 100) / cols;
        u.y_pct = 88 - row * 8; // place fallback row near the bottom
        i++;
      }

      // Persist
      for (const l of located) {
        const target = (hotspots as HotspotRow[]).find((h) => h.word_arabic === l.word_arabic);
        if (!target) continue;
        await admin.from("picture_scene_hotspots")
          .update({ x_pct: l.x_pct, y_pct: l.y_pct })
          .eq("id", target.id);
      }
    }

    return new Response(
      JSON.stringify({ success: true, imageUrl, relocated: needsLocate }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("regenerate-scene-image error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg === "RATE_LIMIT" ? 429 : msg === "PAYMENT_REQUIRED" ? 402 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
