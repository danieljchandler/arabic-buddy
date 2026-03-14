import { corsHeaders } from "../_shared/cors.ts";

const RUNPOD_ENDPOINT = "https://api.runpod.ai/v2/up6r2cq58yg74u/run";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const RUNPOD_API_KEY = Deno.env.get("RUNPOD_API_KEY");
  if (!RUNPOD_API_KEY) {
    return new Response(
      JSON.stringify({ error: "RUNPOD_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { youtube_url, video_id } = await req.json();

  if (!youtube_url || !video_id) {
    return new Response(
      JSON.stringify({ error: "Missing youtube_url or video_id" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const CALLBACK_SECRET = Deno.env.get("RUNPOD_CALLBACK_SECRET")!;

  const callbackUrl = `${SUPABASE_URL}/functions/v1/receive-audio`;

  const runpodPayload = {
    input: {
      youtube_url,
      video_id,
      callback_url: callbackUrl,
      callback_secret: CALLBACK_SECRET,
    },
  };

  const runpodRes = await fetch(RUNPOD_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
    },
    body: JSON.stringify(runpodPayload),
  });

  const runpodData = await runpodRes.json();

  if (!runpodRes.ok) {
    return new Response(
      JSON.stringify({ error: "RunPod request failed", details: runpodData }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ job_id: runpodData.id, status: runpodData.status }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
