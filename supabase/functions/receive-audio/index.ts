import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EXPECTED_SECRET = "VkXg2vi3k6W_cEwzFSCZxI5hTnGApUPUfeIw-SsOXt0";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const auth = req.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${EXPECTED_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const form = await req.formData();
  const audioFile = form.get("audio") as File;
  const video_id = form.get("video_id") as string;
  const source_url = form.get("source_url") as string;
  const title = form.get("title") as string;
  const duration = form.get("duration") as string;
  const thumbnail = form.get("thumbnail") as string;
  const channel = form.get("channel") as string;

  if (!audioFile || !video_id) {
    return new Response(JSON.stringify({ error: "Missing audio or video_id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const storagePath = `${video_id}.opus`;
  const audioBytes = await audioFile.arrayBuffer();

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

  const { data: urlData } = supabase.storage
    .from("audio")
    .getPublicUrl(storagePath);

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

  return new Response(
    JSON.stringify({ storage_url: urlData.publicUrl }),
    { headers: { "Content-Type": "application/json" } }
  );
});
