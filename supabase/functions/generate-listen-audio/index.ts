// generate-listen-audio — Generates full-episode audio by synthesizing every
// line via Azure TTS, caching per-line clips, and concatenating into one MP3
// (simple sequential MP3 byte stitch — works because Azure returns CBR MP3).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function synthesize(text: string, voice: string): Promise<Uint8Array> {
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

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// Rough MP3 duration estimate from byte size at 48 kbps CBR.
function estimateSeconds(bytes: number): number {
  return Math.round((bytes * 8) / 48000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { episodeId } = await req.json();
    if (!episodeId) {
      return new Response(JSON.stringify({ error: "episodeId_required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: episode, error: epErr } = await admin
      .from("listen_episodes")
      .select("*")
      .eq("id", episodeId)
      .maybeSingle();
    if (epErr || !episode) {
      return new Response(JSON.stringify({ error: "episode_not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin.from("listen_episodes").update({ audio_status: "pending" }).eq("id", episodeId);

    const script = (episode.script as any[]) ?? [];
    const parts: Uint8Array[] = [];
    const lineDurations: number[] = [];
    let runningSeconds = 0;

    for (let i = 0; i < script.length; i++) {
      const line = script[i];
      if (!line?.arabic) {
        lineDurations.push(0);
        continue;
      }
      const voice = pickVoice(episode.dialect, line.speaker_role ?? "", i);
      const bytes = await synthesize(line.arabic, voice);
      parts.push(bytes);
      const seconds = estimateSeconds(bytes.length);
      lineDurations.push(seconds);
      runningSeconds += seconds;

      // Cache per-line clip too (so tap-to-hear is free after full generation)
      const linePath = `episodes/${episodeId}/line-${i}.mp3`;
      await admin.storage.from("listen-audio").upload(linePath, bytes, {
        contentType: "audio/mpeg",
        upsert: true,
      });
      const { data: pub } = admin.storage.from("listen-audio").getPublicUrl(linePath);
      await admin.from("listen_line_audio").upsert(
        {
          episode_id: episodeId,
          line_index: i,
          speaker: line.speaker ?? null,
          audio_url: pub.publicUrl,
          duration_seconds: seconds,
        },
        { onConflict: "episode_id,line_index" },
      );
    }

    const fullBytes = concatBytes(parts);
    const fullPath = `episodes/${episodeId}/full.mp3`;
    const { error: upErr } = await admin.storage
      .from("listen-audio")
      .upload(fullPath, fullBytes, { contentType: "audio/mpeg", upsert: true });
    if (upErr) throw new Error(`full upload: ${upErr.message}`);
    const { data: fullPub } = admin.storage.from("listen-audio").getPublicUrl(fullPath);

    await admin
      .from("listen_episodes")
      .update({
        full_audio_url: fullPub.publicUrl,
        line_durations: lineDurations,
        duration_seconds: runningSeconds,
        audio_status: "ready",
      })
      .eq("id", episodeId);

    return new Response(
      JSON.stringify({ ok: true, audio_url: fullPub.publicUrl, duration_seconds: runningSeconds }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("generate-listen-audio fatal", e);
    try {
      const body = await req.clone().json().catch(() => ({}));
      if (body?.episodeId) {
        const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
        await admin.from("listen_episodes").update({ audio_status: "failed" }).eq("id", body.episodeId);
      }
    } catch {}
    return new Response(JSON.stringify({ error: "internal", detail: String(e?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
