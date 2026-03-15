import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const callbackSecret = Deno.env.get("RUNPOD_CALLBACK_SECRET");
  if (!callbackSecret) {
    return new Response(JSON.stringify({ error: "RUNPOD_CALLBACK_SECRET not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const auth = req.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${callbackSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const form = await req.formData();
  const audioFile = form.get("audio") as File;
  const video_id = form.get("video_id") as string;
  const source_url = form.get("source_url") as string;
  const title = form.get("title") as string;
  const duration = form.get("duration") as string;
  const thumbnail = form.get("thumbnail") as string;
  const channel = form.get("channel") as string;
  const discover_video_id = form.get("discover_video_id") as string | null;

  if (!audioFile || !video_id) {
    return new Response(JSON.stringify({ error: "Missing audio or video_id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const audioBytes = await audioFile.arrayBuffer();
  const storagePath = `${video_id}.opus`;

  const { error: uploadError } = await supabase.storage
    .from("audio")
    .upload(storagePath, audioBytes, {
      contentType: "audio/ogg; codecs=opus",
      upsert: true,
    });

  if (uploadError) {
    return new Response(JSON.stringify({ error: uploadError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
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
    return new Response(JSON.stringify({ error: dbError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
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
  if (targetDiscoverVideoId) {
    const ingestionPath = `${targetDiscoverVideoId}.mp4`;

    const { error: stagingError } = await supabase.storage
      .from("video-audio")
      .upload(ingestionPath, audioBytes, {
        contentType: audioFile.type || "audio/ogg; codecs=opus",
        upsert: true,
      });

    if (!stagingError) {
      // Fire-and-forget: don't await the pipeline to avoid timeout chains
      fetch(`${supabaseUrl}/functions/v1/process-approved-video`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ videoId: targetDiscoverVideoId }),
      }).then(async (pipelineRes) => {
        if (!pipelineRes.ok) {
          const pipelineErr = await pipelineRes.text();
          console.error("receive-audio: process-approved-video failed", pipelineErr);
        } else {
          console.log("receive-audio: pipeline triggered successfully");
        }
      }).catch((err) => {
        console.error("receive-audio: pipeline fetch error", err);
      });

      processingTriggered = true;
    } else {
      console.error("receive-audio: failed to stage file in video-audio", stagingError.message);
    }
  }

  return new Response(
    JSON.stringify({
      storage_url: urlData.publicUrl,
      discover_video_id: targetDiscoverVideoId,
      processing_triggered: processingTriggered,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});