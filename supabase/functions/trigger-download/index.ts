import { corsHeaders } from "../_shared/cors.ts";

const DEFAULT_RUNPOD_ENDPOINT = "https://api.runpod.ai/v2/up6r2cq58yg74u/run";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const RUNPOD_API_KEY = Deno.env.get("RUNPOD_API_KEY");
  const RUNPOD_ENDPOINT_OVERRIDE = Deno.env.get("RUNPOD_ENDPOINT_URL")?.trim();
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const CALLBACK_SECRET = Deno.env.get("RUNPOD_CALLBACK_SECRET");

  if (!RUNPOD_API_KEY) {
    return new Response(
      JSON.stringify({ error: "RUNPOD_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!SUPABASE_URL || !CALLBACK_SECRET) {
    return new Response(
      JSON.stringify({ error: "RUNPOD callback configuration missing" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { youtube_url, video_id, discover_video_id } = await req.json();

  if (!youtube_url || !video_id) {
    return new Response(
      JSON.stringify({ error: "Missing youtube_url or video_id" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const callbackUrl = `${SUPABASE_URL}/functions/v1/receive-audio`;

  const runpodPayload = {
    input: {
      youtube_url,
      video_id,
      discover_video_id: discover_video_id ?? null,
      callback_url: callbackUrl,
      callback_secret: CALLBACK_SECRET,
    },
  };

  const endpointCandidates = [RUNPOD_ENDPOINT_OVERRIDE, DEFAULT_RUNPOD_ENDPOINT].filter(
    (value, index, arr): value is string => !!value && arr.indexOf(value) === index
  );

  let lastFailure: unknown = null;

  for (const endpoint of endpointCandidates) {
    try {
      const runpodRes = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RUNPOD_API_KEY}`,
        },
        body: JSON.stringify(runpodPayload),
      });

      const raw = await runpodRes.text();
      let runpodData: any = null;
      try {
        runpodData = raw ? JSON.parse(raw) : null;
      } catch {
        runpodData = { raw };
      }

      if (!runpodRes.ok) {
        lastFailure = { endpoint, status: runpodRes.status, details: runpodData };
        continue;
      }

      return new Response(
        JSON.stringify({ job_id: runpodData?.id, status: runpodData?.status }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (error) {
      lastFailure = { endpoint, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  return new Response(
    JSON.stringify({ error: "RunPod request failed", details: lastFailure }),
    { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
