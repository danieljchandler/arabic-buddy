// generate-listen-line-audio — On-demand single-line TTS for a Listen episode.
// Caches result in listen_line_audio so subsequent listeners hit storage only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Voice maps per dialect — mirror Conversation Simulator / Live Voice mapping.
// Slot index selected by speaker_role.
const VOICE_MAP: Record<string, string[]> = {
  Gulf: ["ar-AE-HamdanNeural", "ar-AE-FatimaNeural", "ar-SA-HamedNeural", "ar-SA-ZariyahNeural"],
  Egyptian: ["ar-EG-ShakirNeural", "ar-EG-SalmaNeural", "ar-EG-ShakirNeural", "ar-EG-SalmaNeural"],
  Yemeni: ["ar-YE-MaryamNeural", "ar-YE-SalehNeural", "ar-YE-MaryamNeural", "ar-YE-SalehNeural"],
};

function pickVoice(dialect: string, role: string, index: number): string {
  const voices = VOICE_MAP[dialect] ?? VOICE_MAP.Gulf;
  const r = (role || "").toLowerCase();
  let slot = 0;
  if (r.includes("host_b") || r === "guest" || r === "character") slot = 1;
  else if (r === "narrator") slot = 2;
  else if (r === "speaker") slot = 0;
  else slot = index % 2;
  return voices[slot % voices.length];
}

async function synthesizeAzure(text: string, voice: string): Promise<Uint8Array> {
  const key = Deno.env.get("AZURE_SPEECH_KEY");
  const endpoint = Deno.env.get("AZURE_SPEECH_ENDPOINT");
  const region = Deno.env.get("AZURE_SPEECH_REGION") ?? "eastus";
  if (!key) throw new Error("AZURE_SPEECH_KEY missing");
  const ttsUrl = endpoint
    ? `${endpoint.replace(/\/$/, "")}/tts/cognitiveservices/v1`
    : `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const locale = voice.split("-").slice(0, 2).join("-");
  const ssml = `<speak version='1.0' xml:lang='${locale}'><voice name='${voice}'>${escapeXml(text)}</voice></speak>`;
  const resp = await fetch(ttsUrl, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "lahja-listen",
    },
    body: ssml,
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Azure TTS ${resp.status}: ${err.slice(0, 200)}`);
  }
  return new Uint8Array(await resp.arrayBuffer());
}

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { episodeId, lineIndex } = await req.json();
    if (!episodeId || typeof lineIndex !== "number") {
      return new Response(JSON.stringify({ error: "bad_request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Cache check
    const { data: cached } = await admin
      .from("listen_line_audio")
      .select("audio_url")
      .eq("episode_id", episodeId)
      .eq("line_index", lineIndex)
      .maybeSingle();
    if (cached?.audio_url) {
      return new Response(JSON.stringify({ audio_url: cached.audio_url, cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: episode, error: epErr } = await admin
      .from("listen_episodes")
      .select("dialect, script")
      .eq("id", episodeId)
      .maybeSingle();
    if (epErr || !episode) {
      return new Response(JSON.stringify({ error: "episode_not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const script = (episode.script as any[]) ?? [];
    const line = script[lineIndex];
    if (!line?.arabic) {
      return new Response(JSON.stringify({ error: "line_not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const voice = pickVoice(episode.dialect, line.speaker_role ?? "", lineIndex);
    const mp3 = await synthesizeAzure(line.arabic, voice);

    const path = `episodes/${episodeId}/line-${lineIndex}.mp3`;
    const { error: upErr } = await admin.storage
      .from("listen-audio")
      .upload(path, mp3, { contentType: "audio/mpeg", upsert: true });
    if (upErr) throw new Error(`upload: ${upErr.message}`);

    const { data: pub } = admin.storage.from("listen-audio").getPublicUrl(path);
    const audioUrl = pub.publicUrl;

    await admin.from("listen_line_audio").upsert(
      {
        episode_id: episodeId,
        line_index: lineIndex,
        speaker: line.speaker ?? null,
        audio_url: audioUrl,
      },
      { onConflict: "episode_id,line_index" },
    );

    return new Response(JSON.stringify({ audio_url: audioUrl, cached: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("generate-listen-line-audio fatal", e);
    return new Response(JSON.stringify({ error: "internal", detail: String(e?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
