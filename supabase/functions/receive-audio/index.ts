import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const callbackSecret = Deno.env.get("RUNPOD_CALLBACK_SECRET");
  if (!callbackSecret) {
    return jsonResponse({ error: "RUNPOD_CALLBACK_SECRET not configured" }, 500);
  }

  const auth = req.headers.get("Authorization")?.trim() ?? "";
  const expectedAuth = `Bearer ${callbackSecret}`.trim();

  if (auth !== expectedAuth) {
    console.warn("receive-audio: unauthorized callback", {
      authPrefix: auth.slice(0, 20),
      hasAuthHeader: Boolean(auth),
    });
    return new Response("Unauthorized", { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let form: FormData;
  try {
    form = await req.formData();
  } catch (error) {
    console.error("receive-audio: invalid form payload", error);
    return jsonResponse({ error: "Invalid form-data payload" }, 400);
  }

  const audioFile = form.get("audio") as File | null;
  const video_id = (form.get("video_id") as string | null)?.trim() || "";
  const source_url = (form.get("source_url") as string | null) ?? null;
  const title = (form.get("title") as string | null) ?? null;
  const duration = (form.get("duration") as string | null) ?? null;
  const thumbnail = (form.get("thumbnail") as string | null) ?? null;
  const channel = (form.get("channel") as string | null) ?? null;
  const discover_video_id = (form.get("discover_video_id") as string | null)?.trim() || null;

  if (!audioFile || !video_id) {
    console.error("receive-audio: missing required fields", {
      hasAudio: Boolean(audioFile),
      hasVideoId: Boolean(video_id),
    });
    return jsonResponse({ error: "Missing audio or video_id" }, 400);
  }

  console.log(
    `receive-audio: callback received (video_id=${video_id}, discover_video_id=${discover_video_id ?? "none"}, size=${audioFile.size})`,
  );

  const audioBytes = await audioFile.arrayBuffer();
  const storagePath = `${video_id}.opus`;

  const { error: uploadError } = await supabase.storage
    .from("audio")
    .upload(storagePath, audioBytes, {
      contentType: "audio/ogg; codecs=opus",
      upsert: true,
    });

  if (uploadError) {
    console.error("receive-audio: failed audio bucket upload", uploadError.message);
    return jsonResponse({ error: uploadError.message }, 500);
  }

  const { data: urlData } = supabase.storage.from("audio").getPublicUrl(storagePath);

  const { error: dbError } = await supabase.from("audio_files").insert({
    video_id,
    source_url,
    title,
    duration: duration ? parseInt(duration) : null,
    thumbnail,
    channel,
    storage_path: storagePath,
    status: "ready",
  });

  if (dbError) {
    console.error("receive-audio: failed audio_files insert", dbError.message);
    return jsonResponse({ error: dbError.message }, 500);
  }

  let targetDiscoverVideoId: string | null = discover_video_id || null;

  if (!targetDiscoverVideoId) {
    const { data: matchedVideo } = await supabase
      .from("discover_videos")
      .select("id")
      .ilike("source_url", `%${video_id}%`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    targetDiscoverVideoId = matchedVideo?.id ?? null;
  }

  let processingTriggered = false;
  let processingError: string | null = null;

  const markVideoFailed = async (message: string) => {
    if (!targetDiscoverVideoId) return;

    await supabase.from("discover_videos").update({
      transcription_status: "failed",
      transcription_error: message,
    }).eq("id", targetDiscoverVideoId);
  };

  if (targetDiscoverVideoId) {
    await supabase.from("discover_videos").update({
      transcription_status: "pending",
      transcription_error: null,
    }).eq("id", targetDiscoverVideoId);

    const ingestionPath = `${targetDiscoverVideoId}.mp4`;

    const { error: stagingError } = await supabase.storage
      .from("video-audio")
      .upload(ingestionPath, audioBytes, {
        contentType: audioFile.type || "audio/ogg; codecs=opus",
        upsert: true,
      });

    if (!stagingError) {
      try {
        const pipelineRes = await fetch(`${supabaseUrl}/functions/v1/process-approved-video`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ videoId: targetDiscoverVideoId }),
          signal: AbortSignal.timeout(60_000),
        });

        if (!pipelineRes.ok) {
          const pipelineErr = await pipelineRes.text();
          processingError = `process-approved-video failed (${pipelineRes.status}): ${pipelineErr}`;
          console.error("receive-audio:", processingError);
          await markVideoFailed(processingError);
        } else {
          await pipelineRes.text().catch(() => "");
          processingTriggered = true;
          console.log(`receive-audio: process-approved-video triggered for ${targetDiscoverVideoId}`);
        }
      } catch (err) {
        processingError = `process-approved-video trigger error: ${err instanceof Error ? err.message : String(err)}`;
        console.error("receive-audio:", processingError);
        await markVideoFailed(processingError);
      }
    } else {
      processingError = `failed to stage file in video-audio: ${stagingError.message}`;
      console.error("receive-audio:", processingError);
      await markVideoFailed(processingError);
    }
  } else {
    processingError = `No matching discover video found for callback video_id=${video_id}`;
    console.error("receive-audio:", processingError);

    await supabase.from("discover_videos").update({
      transcription_status: "failed",
      transcription_error: processingError,
    }).ilike("source_url", `%${video_id}%`).eq("transcription_status", "pending");
  }

  return jsonResponse({
    storage_url: urlData.publicUrl,
    discover_video_id: targetDiscoverVideoId,
    processing_triggered: processingTriggered,
    processing_error: processingError,
  });
});