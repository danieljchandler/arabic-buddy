// Diagnostic: hit Munsit with a specific audio file from storage and return the raw response.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const url = new URL(req.url);
    const videoId = url.searchParams.get("videoId") ?? "2b5c2c39-4d71-4238-9382-31c9f1c2b8e7";
    const model = url.searchParams.get("model") ?? "munsit";

    const KEY = Deno.env.get("MUNSIT_API_KEY")!;
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: signed, error: signErr } = await supabase.storage
      .from("video-audio")
      .createSignedUrl(`${videoId}.mp3`, 300);
    if (signErr || !signed?.signedUrl) throw new Error(`sign: ${signErr?.message}`);

    const audioRes = await fetch(signed.signedUrl);
    const bytes = new Uint8Array(await audioRes.arrayBuffer());
    const sizeMB = bytes.byteLength / (1024 * 1024);

    const fd = new FormData();
    fd.append("file", new File([bytes], "audio.mp3", { type: "audio/mpeg" }));
    fd.append("model", model);

    const t0 = Date.now();
    const resp = await fetch("https://api.munsit.com/api/v1/audio/transcribe", {
      method: "POST",
      headers: { "x-api-key": KEY },
      body: fd,
    });
    const elapsed = Date.now() - t0;
    const body = await resp.text();

    return new Response(
      JSON.stringify({
        sizeMB: Number(sizeMB.toFixed(3)),
        keyLength: KEY?.length ?? 0,
        keyPreview: KEY ? `${KEY.slice(0, 4)}...${KEY.slice(-4)}` : "MISSING",
        model,
        status: resp.status,
        elapsedMs: elapsed,
        contentType: resp.headers.get("content-type"),
        body: body.slice(0, 4000),
      }, null, 2),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
