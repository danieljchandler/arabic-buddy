// generate-listen-line-audio — On-demand single-line TTS for a Listen episode.
// Uses Munsit for Gulf episodes, Azure for Egyptian/Yemeni. Caches per-line.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { planProvider, slotsNeeded, synthesizeLine } from "../_shared/listenTts.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";


const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Paid TTS on a learner-facing endpoint. The result is cached per
    // (episode, line) and the text comes from the episode's own script, so this
    // cannot be steered into synthesising arbitrary content — but a first
    // generation is a real spend, and nothing was counting them.
    const cap = await enforceDailyCap(req, "listen-line-audio", 200, corsHeaders);
    if (cap.limited) return cap.response;

    const { episodeId, lineIndex } = await req.json();
    if (!episodeId || typeof lineIndex !== "number") {
      return new Response(JSON.stringify({ error: "bad_request" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

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
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const script = (episode.script as any[]) ?? [];
    const line = script[lineIndex];
    if (!line?.arabic) {
      return new Response(JSON.stringify({ error: "line_not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Derived from the whole script, not this one line: planning per line could
    // land line 0 and line 1 on different rungs, and a WAV clip and an MP3 clip
    // cannot be concatenated into one episode.
    const plan = await planProvider(episode.dialect, {
      minVoices: slotsNeeded(script.map((l) => String(l?.speaker_role ?? ""))),
    });
    const bytes = await synthesizeLine(line.arabic, line.speaker_role ?? "", lineIndex, plan);

    const path = `episodes/${episodeId}/line-${lineIndex}.${plan.ext}`;
    const { error: upErr } = await admin.storage
      .from("listen-audio")
      .upload(path, bytes, { contentType: plan.contentType, upsert: true });
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

    return new Response(JSON.stringify({ audio_url: audioUrl, cached: false, provider: plan.provider }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("generate-listen-line-audio fatal", e);
    return new Response(JSON.stringify({ error: "internal", detail: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
