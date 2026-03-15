import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const DEFAULT_RUNPOD_ENDPOINT = "https://api.runpod.ai/v2/up6r2cq58yg74u/run";
const CALLBACK_WAIT_MS = 3 * 60 * 1000;
const MAX_RUNPOD_ATTEMPTS = 2;

type TriggerPayload = {
  youtube_url?: string;
  video_id?: string;
  discover_video_id?: string | null;
  attempt?: number;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAdminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) return null;

  return {
    supabaseUrl,
    serviceRoleKey,
    client: createClient(supabaseUrl, serviceRoleKey),
  };
}

async function scheduleCallbackWatch(payload: {
  youtubeUrl: string;
  extractedVideoId: string;
  discoverVideoId: string;
  attempt: number;
}) {
  const admin = getAdminClient();
  if (!admin) {
    console.warn("trigger-download: callback watchdog skipped (service role credentials missing)");
    return;
  }

  const { client, supabaseUrl, serviceRoleKey } = admin;
  const { youtubeUrl, extractedVideoId, discoverVideoId, attempt } = payload;

  const run = async () => {
    await wait(CALLBACK_WAIT_MS);

    const { data: videoRow } = await client
      .from("discover_videos")
      .select("id, transcription_status")
      .eq("id", discoverVideoId)
      .maybeSingle();

    if (!videoRow) {
      console.warn(`trigger-download: watchdog could not find video ${discoverVideoId}`);
      return;
    }

    if (videoRow.transcription_status !== "pending") {
      console.log(
        `trigger-download: watchdog exiting for ${discoverVideoId} (status=${videoRow.transcription_status})`,
      );
      return;
    }

    const { data: audioRow } = await client
      .from("audio_files")
      .select("id, created_at")
      .eq("video_id", extractedVideoId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (audioRow?.id) {
      console.log(
        `trigger-download: watchdog found callback output for ${discoverVideoId} (audio_id=${audioRow.id})`,
      );
      return;
    }

    if (attempt < MAX_RUNPOD_ATTEMPTS) {
      const nextAttempt = attempt + 1;
      const retryNote = `RunPod callback timeout on attempt ${attempt}; retrying (attempt ${nextAttempt})`;

      await client
        .from("discover_videos")
        .update({ transcription_error: retryNote })
        .eq("id", discoverVideoId);

      console.warn(`trigger-download: ${retryNote} for ${discoverVideoId}`);

      const retryResp = await fetch(`${supabaseUrl}/functions/v1/trigger-download`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          youtube_url: youtubeUrl,
          video_id: extractedVideoId,
          discover_video_id: discoverVideoId,
          attempt: nextAttempt,
        }),
      });

      if (!retryResp.ok) {
        const retryBody = await retryResp.text().catch(() => "");
        await client
          .from("discover_videos")
          .update({
            transcription_status: "failed",
            transcription_error: `RunPod retry failed (${retryResp.status}): ${retryBody.slice(0, 500)}`,
          })
          .eq("id", discoverVideoId);
      }

      return;
    }

    const failMsg = `RunPod callback timeout after ${attempt} attempts. Please retry import or upload audio file manually.`;
    console.error(`trigger-download: ${failMsg} video=${discoverVideoId}`);

    await client
      .from("discover_videos")
      .update({ transcription_status: "failed", transcription_error: failMsg })
      .eq("id", discoverVideoId);
  };

  try {
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil(run());
  } catch {
    run().catch((err) => console.error("trigger-download watchdog error:", err));
  }
}

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
    return jsonResponse({ error: "RUNPOD_API_KEY not configured" }, 500);
  }

  if (!SUPABASE_URL || !CALLBACK_SECRET) {
    return jsonResponse({ error: "RUNPOD callback configuration missing" }, 500);
  }

  const { youtube_url, video_id, discover_video_id, attempt }: TriggerPayload = await req.json();
  const queueAttempt = Math.max(1, Math.min(MAX_RUNPOD_ATTEMPTS, Number(attempt) || 1));

  if (!youtube_url || !video_id) {
    return jsonResponse({ error: "Missing youtube_url or video_id" }, 400);
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
    (value, index, arr): value is string => !!value && arr.indexOf(value) === index,
  );

  let lastFailure: unknown = null;

  for (const endpoint of endpointCandidates) {
    try {
      console.log(
        `trigger-download: queuing RunPod job (attempt=${queueAttempt}, endpoint=${endpoint}, video_id=${video_id}, discover_video_id=${discover_video_id ?? "none"})`,
      );

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
        console.warn(
          `trigger-download: endpoint failed (status=${runpodRes.status}) ${endpoint}`,
        );
        continue;
      }

      if (!runpodData?.id) {
        lastFailure = { endpoint, status: runpodRes.status, details: runpodData };
        console.warn("trigger-download: RunPod accepted request but returned no job id");
        continue;
      }

      console.log(
        `trigger-download: queued job ${runpodData.id} (status=${runpodData?.status ?? "unknown"})`,
      );

      const discoverVideoId = discover_video_id?.trim();
      if (discoverVideoId) {
        const admin = getAdminClient();
        if (admin) {
          await admin.client
            .from("discover_videos")
            .update({ transcription_status: "pending", transcription_error: null })
            .eq("id", discoverVideoId);
        }

        await scheduleCallbackWatch({
          youtubeUrl: youtube_url,
          extractedVideoId: video_id,
          discoverVideoId,
          attempt: queueAttempt,
        });
      }

      return jsonResponse({ job_id: runpodData.id, status: runpodData?.status, attempt: queueAttempt });
    } catch (error) {
      lastFailure = {
        endpoint,
        error: error instanceof Error ? error.message : "Unknown error",
      };
      console.warn(`trigger-download: endpoint error at ${endpoint}`, lastFailure);
    }
  }

  const discoverVideoId = discover_video_id?.trim();
  if (discoverVideoId) {
    const admin = getAdminClient();
    if (admin) {
      await admin.client
        .from("discover_videos")
        .update({
          transcription_status: "failed",
          transcription_error: `RunPod queue failed after ${queueAttempt} attempt(s): ${JSON.stringify(lastFailure).slice(0, 500)}`,
        })
        .eq("id", discoverVideoId);
    }
  }

  return jsonResponse({ error: "RunPod request failed", details: lastFailure }, 502);
});