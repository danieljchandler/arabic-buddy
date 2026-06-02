/**
 * generate-scene-audio — generate per-word Arabic TTS clips for every hotspot
 * in a picture scene that doesn't yet have audio. Routes to munsit-tts for
 * Gulf and azure-tts for Egyptian/Yemeni, mirroring useAzureTTS on the client.
 *
 * Auth: admin only.
 * Body: { sceneId: string, force?: boolean }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DIALECT_VOICE: Record<string, { fn: string; voice?: string }> = {
  Gulf: { fn: "munsit-tts" },
  Egyptian: { fn: "azure-tts", voice: "ar-EG-ShakirNeural" },
  Yemeni: { fn: "azure-tts", voice: "ar-YE-MaryamNeural" },
};

async function synthOne(
  baseUrl: string,
  apiKey: string,
  fn: string,
  text: string,
  voice?: string,
): Promise<Uint8Array> {
  const res = await fetch(`${baseUrl}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      apikey: apiKey,
    },
    body: JSON.stringify(voice ? { text, voice } : { text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const fallback = "azure-tts";
    if (fn === fallback) {
      throw new Error(`${fn} failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    // Fall back to azure-tts
    const fb = await fetch(`${baseUrl}/functions/v1/${fallback}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        apikey: apiKey,
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!fb.ok) throw new Error(`TTS fallback failed ${fb.status}`);
    const buf = await fb.arrayBuffer();
    return new Uint8Array(buf);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: roles } = await supabaseAuth
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    if (!roles?.some((r: { role: string }) => r.role === "admin")) {
      return new Response(JSON.stringify({ error: "Admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { sceneId, force } = await req.json();
    if (!sceneId) {
      return new Response(JSON.stringify({ error: "sceneId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(baseUrl, serviceKey);

    const { data: scene } = await admin
      .from("picture_scenes")
      .select("id, dialect")
      .eq("id", sceneId)
      .single();
    if (!scene) throw new Error("Scene not found");

    const dialectCfg = DIALECT_VOICE[(scene as { dialect: string }).dialect] || DIALECT_VOICE.Gulf;

    let query = admin
      .from("picture_scene_hotspots")
      .select("id, word_arabic, word_audio_url")
      .eq("scene_id", sceneId);
    if (!force) {
      query = query.is("word_audio_url", null);
    }
    const { data: hotspots, error: hsErr } = await query;
    if (hsErr) throw hsErr;
    if (!hotspots || hotspots.length === 0) {
      return new Response(JSON.stringify({ success: true, generated: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let generated = 0;
    const errors: string[] = [];

    for (const h of hotspots as Array<{ id: string; word_arabic: string }>) {
      try {
        const audio = await synthOne(baseUrl, serviceKey, dialectCfg.fn, h.word_arabic, dialectCfg.voice);
        const ext = dialectCfg.fn === "munsit-tts" ? "wav" : "mp3";
        const path = `picture-scenes/${sceneId}/${h.id}.${ext}`;
        const contentType = ext === "wav" ? "audio/wav" : "audio/mpeg";
        const { error: upErr } = await admin.storage
          .from("flashcard-audio")
          .upload(path, audio, { contentType, upsert: true });
        if (upErr) throw upErr;
        const { data: urlData } = admin.storage.from("flashcard-audio").getPublicUrl(path);
        const url = `${urlData.publicUrl}?t=${Date.now()}`;
        await admin.from("picture_scene_hotspots")
          .update({ word_audio_url: url })
          .eq("id", h.id);
        generated++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`Hotspot ${h.id} (${h.word_arabic}) failed: ${msg}`);
        errors.push(`${h.word_arabic}: ${msg}`);
      }
    }

    return new Response(
      JSON.stringify({ success: true, generated, errors: errors.slice(0, 10) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("generate-scene-audio error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
