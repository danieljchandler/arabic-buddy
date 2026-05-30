// generate-listen-audio — Full-episode audio synthesis.
// Munsit (WAV) for Gulf, Azure (MP3) for others. Concatenates clips into
// one playable file and caches per-line URLs for tap-to-hear.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  planProvider,
  synthesizeLine,
  concatForPlan,
  estimateSeconds,
} from "../_shared/listenTts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { episodeId } = await req.json();
    if (!episodeId) {
      return new Response(JSON.stringify({ error: "episodeId_required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin.from("listen_episodes").update({ audio_status: "pending" }).eq("id", episodeId);

    const plan = await planProvider(episode.dialect);
    console.log(`generate-listen-audio: episode=${episodeId} provider=${plan.provider}`);

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
      const bytes = await synthesizeLine(line.arabic, line.speaker_role ?? "", i, plan);
      parts.push(bytes);
      const seconds = estimateSeconds(bytes.length, plan);
      lineDurations.push(seconds);
      runningSeconds += seconds;

      const linePath = `episodes/${episodeId}/line-${i}.${plan.ext}`;
      await admin.storage.from("listen-audio").upload(linePath, bytes, {
        contentType: plan.contentType, upsert: true,
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

    const fullBytes = concatForPlan(parts, plan);
    const fullPath = `episodes/${episodeId}/full.${plan.ext}`;
    const { error: upErr } = await admin.storage
      .from("listen-audio")
      .upload(fullPath, fullBytes, { contentType: plan.contentType, upsert: true });
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
      JSON.stringify({
        ok: true,
        audio_url: fullPub.publicUrl,
        duration_seconds: runningSeconds,
        provider: plan.provider,
      }),
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
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
