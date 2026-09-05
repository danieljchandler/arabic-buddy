import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FIXTURE_ENV, jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `process-approved-video` — the transcription pipeline behind the Discover
 * admin's Approve button, and at 1643 lines the largest edge function in the
 * repo.
 *
 * It acquires audio (staged upload → cached extraction → download-media), runs
 * six ASR engines in parallel, picks a primary, records provenance, hands the
 * result to analyze-gulf-arabic, aligns the merged lines back onto the audio
 * timeline, and finally asks rate-video-cefr for a CEFR band. All of it after
 * the 202, inside `EdgeRuntime.waitUntil`.
 *
 * The engines are deliberately left routed to their default fixtures in most
 * tests. Each leg catches its own failures and degrades to `{ text: null }`, so
 * what is worth asserting is not any single engine's parsing — that belongs to
 * the transcribe specs — but that the pipeline still reaches a terminal status,
 * that the row is never left mid-flight, and that provenance records what
 * actually happened.
 *
 * One branch is not covered here and deliberately so: the "no HTTP response and
 * no direct persist" fallback polls the row 24 times at ten-second intervals, so
 * exercising it costs four minutes of real sleeping. Every test below keeps the
 * pipeline out of it.
 */

const VIDEO = "cccccccc-0000-4000-8000-000000000000";
const SERVICE_ROLE = "e2e-service-role-not-a-real-secret";
const ANON = "e2e-anon-key-not-a-real-secret";

/** A few KB of "audio" — small enough that no engine chunks it. */
const AUDIO_B64 = btoa(String.fromCharCode(...new Uint8Array(2048)));

const aVideo = (over: Record<string, unknown> = {}) => ({
  id: VIDEO,
  source_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  title: "Untitled Video",
  title_arabic: null,
  dialect: "Gulf",
  duration_seconds: 30,
  is_meme: false,
  engines_used: null,
  ...over,
});

const aResult = (over: Record<string, unknown> = {}) => ({
  lines: [
    { id: "l1", arabic: "شلونك اليوم", translation: "How are you today" },
    { id: "l2", arabic: "الحمد لله بخير", translation: "Fine, thank God" },
  ],
  vocabulary: [{ arabic: "شلونك", english: "how are you" }],
  grammarPoints: [{ point: "question particle" }],
  culturalContext: "A everyday Gulf greeting.",
  dialect: "Gulf",
  difficulty: "Beginner",
  title: "A Gulf greeting",
  titleArabic: "تحية خليجية",
  ...over,
});

/**
 * Storage that holds nothing.
 *
 * `download()` is tried against six extensions before the pipeline gives up and
 * calls download-media, and `createSignedUrl` is tried against the same six for
 * the multimodal handoff. A 404 for both is the "URL-sourced video, nothing
 * staged" case, which is the common one.
 */
const emptyStorage: UpstreamHandler = () => json({ error: "Object not found" }, 404);

/**
 * Storage that remembers the pipeline's checkpoint and nothing else.
 *
 * Each stage writes `<id>.pipeline.json` before handing over, and the next
 * request reads it back. Backing that one object with memory is what lets a
 * test follow a run across several requests; everything else falls through to
 * the test's own storage handler.
 */
function withCheckpointStore(
  base: UpstreamHandler,
  store: Map<string, string> = new Map(),
): { handler: UpstreamHandler; store: Map<string, string> } {
  const handler: UpstreamHandler = async (request) => {
    const marker = "/object/video-audio/";
    const at = request.url.indexOf(marker);
    if (at >= 0) {
      const path = request.url.slice(at + marker.length).split("?")[0];
      if (path.endsWith(".pipeline.json")) {
        if (request.method === "GET") {
          const stored = store.get(path);
          return stored === undefined
            ? json({ error: "Object not found" }, 404)
            : new Response(stored, { status: 200, headers: { "content-type": "application/json" } });
        }
        // supabase-js wraps a Blob upload in multipart form data, under an
        // empty part name that Deno's parser drops — so the JSON object is
        // lifted out of the raw body instead.
        const raw = await request.text();
        const object = raw.match(/\{[\s\S]*\}/)?.[0] ?? "";
        store.set(path, object);
        return json({ Key: `video-audio/${path}` }, 200);
      }
    }
    return base(request);
  };
  return { handler, store };
}

/** What a run left in its checkpoint, if anything. */
const storedCheckpoint = (store: Map<string, string>): Record<string, unknown> | null => {
  const raw = store.get(`${VIDEO}.pipeline.json`);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
};

/**
 * The test-time clock for the analysis wait. The real pipeline polls every ten
 * seconds and treats an analysis as possibly still running for the platform's
 * whole 400s wall clock; a test cannot sit through that, and does not need to.
 */
const FAST_PIPELINE_ENV = {
  PIPELINE_POLL_INTERVAL_MS: "1",
  PIPELINE_ANALYZE_MAX_RUN_MS: "5",
};

function backend(
  options: {
    video?: Record<string, unknown> | null;
    videoStatus?: number;
    /** What the row reads back as in step 3, after analyze has had its turn. */
    refreshed?: Record<string, unknown>;
    download?: UpstreamHandler;
    analyze?: UpstreamHandler;
    storage?: UpstreamHandler;
    extra?: Record<string, UpstreamHandler>;
  } = {},
): Record<string, UpstreamHandler> {
  const {
    video = aVideo(),
    videoStatus = 200,
    refreshed,
    download = () => json({ audioBase64: AUDIO_B64, contentType: "audio/mp4", duration: 31.4 }),
    analyze = () => json({ success: true, result: aResult() }),
    storage = emptyStorage,
    extra = {},
  } = options;

  return {
    "/auth/v1/user": () => json({ id: "00000000-0000-4000-8000-000000000001", aud: "authenticated" }),
    "/rest/v1/user_roles": () => json([{ role: "content_reviewer" }]),

    "/rest/v1/discover_videos": (request) => {
      // A write answers with the row it touched, as PostgREST does for
      // `.select()` after an update — the finalising write reads that back to
      // learn whether it was the request that claimed the row.
      if (request.method !== "GET") return json([{ id: VIDEO }], 200);
      // Three different reads hit this table. The handler's opening `select=*`
      // fetches the row; step 2 re-reads only `engines_used` to merge
      // provenance; step 3 re-reads the analysis columns to see whether
      // analyze-gulf-arabic persisted directly. Serving one shape to all three
      // would make the direct-persist branch fire in every test.
      const url = request.url;
      if (url.includes("select=engines_used")) return json({ engines_used: null }, 200);
      if (url.includes("transcription_status")) {
        return json(refreshed ?? { transcription_status: "processing" }, 200);
      }
      return json(video, videoStatus);
    },

    // No previously extracted audio to reuse.
    "/rest/v1/audio_files": () => json(null, 200),
    // Fanar meters itself with a head:true count, which supabase-js reads off
    // content-range rather than the body.
    "/rest/v1/fanar_usage": (request) =>
      request.method === "HEAD"
        ? new Response(null, {
            status: 200,
            headers: {
              "content-range": "0-0/0",
              "access-control-expose-headers": "content-range",
            },
          })
        : json([], 200),

    "/storage/v1": storage,

    "/functions/v1/download-media": download,
    "/functions/v1/analyze-gulf-arabic": analyze,
    "/functions/v1/rate-video-cefr": () => json({ success: true, cefr: "A2" }),
    // The function hands each stage to itself as a new request. Refusing the
    // hop here makes the stage run inline, so a test sees the whole run in one
    // background task; the tests that follow a run across hops route this to
    // the real handler instead.
    "/functions/v1/process-approved-video": () => json({ error: "hops are not routed in this test" }, 503),

    ...extra,
  };
}

interface Result {
  status: number;
  body: Record<string, unknown>;
  calls: string[];
  bodies: Array<string | null>;
  patches: Record<string, unknown>[];
}

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: {
    jwt?: string | null;
    env?: Record<string, string | undefined>;
    settle?: boolean;
  } = {},
): Promise<Result> {
  const fn = await loadFunction("process-approved-video", {
    upstreams,
    env: { ...FAST_PIPELINE_ENV, ...(opts.env ?? {}) },
  });
  try {
    const response = await fn.handler(
      jsonRequest(
        "process-approved-video",
        body,
        opts.jwt === undefined ? { jwt: SERVICE_ROLE } : { jwt: opts.jwt },
      ),
    );
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // The status assertion carries the failure.
    }

    if (opts.settle !== false) await fn.background();

    return {
      status: response.status,
      body: parsed,
      calls: fn.calls.map((c) => c.url),
      bodies: fn.calls.map((c) => c.body),
      patches: fn.calls
        .filter((c) => c.url.includes("discover_videos") && c.method === "PATCH")
        .map((c) => JSON.parse(c.body ?? "{}") as Record<string, unknown>),
    };
  } finally {
    fn.restore();
  }
}

/** The last patch that set a terminal or in-flight status. */
const finalStatus = (result: Result): unknown =>
  result.patches.filter((p) => "transcription_status" in p).at(-1)?.transcription_status;

const lastPatchWith = (result: Result, key: string): Record<string, unknown> | undefined =>
  result.patches.filter((p) => key in p).at(-1);

/**
 * The ASR provenance write.
 *
 * `engines_used` carries two unrelated things: the per-engine outcome written
 * once after the fan-out, and the pipeline's progress note, rewritten on every
 * stage boundary and heartbeat. "The last engines_used patch" is therefore
 * almost always the progress note, so provenance is picked out by its own key.
 */
const asrProvenance = (result: Result): Record<string, Record<string, unknown>> | undefined => {
  const patch = result.patches
    .filter((p) => {
      const used = p.engines_used as Record<string, unknown> | undefined;
      return !!used && typeof used === "object" && "asr" in used;
    })
    .at(-1);
  return (patch?.engines_used as { asr?: Record<string, Record<string, unknown>> } | undefined)?.asr;
};

/** The pipeline's own progress note, as an admin page would read it. */
const progressNote = (result: Result): Record<string, unknown> | undefined => {
  const patch = result.patches
    .filter((p) => {
      const used = p.engines_used as Record<string, unknown> | undefined;
      return !!used && typeof used === "object" && "pipeline" in used;
    })
    .at(-1);
  return (patch?.engines_used as { pipeline?: Record<string, unknown> } | undefined)?.pipeline;
};

/** The body sent to one of the sibling edge functions. */
function bodySentTo(result: Result, name: string): Record<string, unknown> {
  const index = result.calls.findIndex((u) => u.includes(name));
  return index < 0 ? {} : (JSON.parse(result.bodies[index] ?? "{}") as Record<string, unknown>);
}

// ── The way in ───────────────────────────────────────────────────────────────

Deno.test("process-approved-video answers the preflight", async () => {
  const fn = await loadFunction("process-approved-video", { upstreams: backend() });
  try {
    const response = await fn.handler(optionsRequest("process-approved-video"));
    assertEquals(response.status, 200);
    assert(response.headers.get("access-control-allow-origin"));
  } finally {
    fn.restore();
  }
});

Deno.test("process-approved-video refuses a request with no Authorization header", async () => {
  const result = await call({ videoId: VIDEO }, backend(), { jwt: null });

  assertEquals(result.status, 401);
  assertEquals(result.body.error, "auth_required");
});

Deno.test("process-approved-video refuses a header that is not a bearer token", async () => {
  const fn = await loadFunction("process-approved-video", { upstreams: backend() });
  try {
    const response = await fn.handler(
      jsonRequest("process-approved-video", { videoId: VIDEO }, {
        jwt: null,
        headers: { authorization: "Basic abc123" },
      }),
    );
    assertEquals(response.status, 401);
  } finally {
    fn.restore();
  }
});

Deno.test("process-approved-video refuses anything merely shaped like a publishable key", async () => {
  // This was pinned as a known hole and is now closed. The old check accepted
  // three things without ever asking the auth server: the service-role key, the
  // anon key, and — via `looksLikePublishable` — *any* string starting with
  // "sb_publishable_", compared against nothing. The first is a secret; the
  // other two are public, and the third was not even a comparison. That made
  // the most expensive job in the system (six ASR engines plus an LLM ensemble)
  // an unauthenticated trigger on any guessable video id.
  // The auth server is what decides now, and it does not know this token.
  const result = await call({ videoId: VIDEO }, {
    ...backend(),
    "/auth/v1/user": () => json({ error: "invalid claim" }, 401),
  }, { jwt: "sb_publishable_not_a_real_key" });

  assertEquals(result.status, 401);
});

Deno.test("process-approved-video refuses the anon key", async () => {
  // The anon key ships in the browser bundle. Whatever the admin form used to
  // send, a public key is not a credential.
  const result = await call({ videoId: VIDEO }, {
    ...backend(),
    "/auth/v1/user": () => json({ error: "invalid claim" }, 401),
  }, { jwt: ANON });

  assertEquals(result.status, 401);
});

Deno.test("process-approved-video accepts a content manager's token", async () => {
  const result = await call({ videoId: VIDEO }, backend(), { jwt: "a.real.looking.jwt" });

  assertEquals(result.status, 202);
  // The role came from the database, not from the token.
  assertEquals(result.calls.some((u) => u.includes("/auth/v1/user")), true);
  assertEquals(result.calls.some((u) => u.includes("/rest/v1/user_roles")), true);
});

Deno.test("process-approved-video refuses a signed-in learner with no staff role", async () => {
  const result = await call({ videoId: VIDEO }, {
    ...backend(),
    "/rest/v1/user_roles": () => json([]),
  }, { jwt: "a.real.looking.jwt" });

  assertEquals(result.status, 403);
  assertEquals(result.body.error, "forbidden");
});

Deno.test("process-approved-video still accepts the internal service-role call", async () => {
  const result = await call({ videoId: VIDEO }, backend(), {
    jwt: FIXTURE_ENV.SUPABASE_SERVICE_ROLE_KEY,
  });

  assertEquals(result.status, 202);
  // The internal path short-circuits before any auth-server round trip.
  assertEquals(result.calls.some((u) => u.includes("/auth/v1/user")), false);
});

Deno.test("process-approved-video refuses a user token the auth server rejects", async () => {
  const result = await call({ videoId: VIDEO }, {
    ...backend(),
    "/auth/v1/user": () => json({ error: "bad jwt" }, 401),
  }, { jwt: "a.real.looking.jwt" });

  assertEquals(result.status, 401);
  assertEquals(result.body.error, "auth_required");
});

Deno.test("process-approved-video rejects a body that is not JSON", async () => {
  const fn = await loadFunction("process-approved-video", { upstreams: backend() });
  try {
    const response = await fn.handler(
      new Request("https://e2e.supabase.co/functions/v1/process-approved-video", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://hakiya.app",
          authorization: `Bearer ${SERVICE_ROLE}`,
        },
        body: "{ not json",
      }),
    );
    assertEquals(response.status, 400);
    assertEquals((await response.json()).error, "Invalid JSON body");
  } finally {
    fn.restore();
  }
});

Deno.test("process-approved-video needs a video id", async () => {
  const result = await call({}, backend());

  assertEquals(result.status, 400);
  assertEquals(result.body.error, "videoId is required");
});

Deno.test("process-approved-video says so when the video does not exist", async () => {
  const result = await call({ videoId: VIDEO }, backend({ video: null, videoStatus: 406 }));

  assertEquals(result.status, 404);
  assertEquals(result.body.error, "Video not found");
  // Nothing was started, so no status was written either.
  assertEquals(result.patches.length, 0);
});

Deno.test("process-approved-video marks the row processing before it answers", async () => {
  const fn = await loadFunction("process-approved-video", { upstreams: backend() });
  try {
    const response = await fn.handler(
      jsonRequest("process-approved-video", { videoId: VIDEO }, { jwt: SERVICE_ROLE }),
    );

    // The 202 is a receipt for work that has not started. The status write
    // happens first so the admin list shows a spinner the moment the button is
    // clicked, rather than after the first engine answers.
    assertEquals(response.status, 202);
    const receipt = await response.json() as Record<string, unknown>;
    assertEquals(receipt.success, true);
    assertEquals(receipt.message, "Processing started");
    assertEquals(receipt.stage, "asr");
    // The build marker rides on every reply so a caller can tell a deployed
    // copy of this function from an older one still being served.
    assert(typeof receipt.build === "string" && receipt.build.length > 0);

    const patches = fn.calls
      .filter((c) => c.url.includes("discover_videos") && c.method === "PATCH")
      .map((c) => JSON.parse(c.body ?? "{}") as Record<string, unknown>);
    assertEquals(patches[0].transcription_status, "processing");
    assertEquals(patches[0].transcription_error, null);
    assertEquals(fn.callsTo("analyze-gulf-arabic").length, 0);

    await fn.background();
    assertEquals(fn.callsTo("analyze-gulf-arabic").length, 1);
  } finally {
    fn.restore();
  }
});

// ── Step 1: finding the audio ────────────────────────────────────────────────

Deno.test("process-approved-video prefers staged audio over downloading again", async () => {
  const result = await call({ videoId: VIDEO }, backend({
    storage: (request) => {
      // The `.wav` the admin form stages is tried first: already extracted,
      // already 16 kHz mono, and free.
      if (request.url.includes(`${VIDEO}.wav`) && request.method === "GET") {
        return new Response(new Uint8Array(2048), {
          status: 200,
          headers: { "content-type": "audio/wav" },
        });
      }
      if (request.url.includes("/object/sign/")) return json({ signedURL: "/object/sign/x" });
      return json({ error: "Object not found" }, 404);
    },
  }));

  assertEquals(result.calls.some((u) => u.includes("download-media")), false);
  assertEquals(finalStatus(result), "completed");
});

Deno.test("process-approved-video reuses an already extracted clip before downloading", async () => {
  const result = await call({ videoId: VIDEO }, backend({
    extra: {
      "/rest/v1/audio_files": () => json({ storage_path: "extracted/clip.opus" }, 200),
    },
    storage: (request) => {
      if (request.url.includes("extracted/clip.opus")) {
        return new Response(new Uint8Array(2048), {
          status: 200,
          headers: { "content-type": "audio/ogg" },
        });
      }
      return json({ error: "Object not found" }, 404);
    },
  }));

  // The Transcribe page extracts audio into its own bucket; the pipeline looks
  // there before paying for a second download of the same source.
  assertEquals(result.calls.some((u) => u.includes("download-media")), false);
  assertEquals(finalStatus(result), "completed");
});

Deno.test("process-approved-video looks up extracted audio by YouTube id", async () => {
  const result = await call({ videoId: VIDEO }, backend());

  // The same clip is stored under a bare video id, so matching on the full
  // source URL alone would miss every re-share of the same video.
  const lookup = result.calls.find((u) => u.includes("audio_files")) ?? "";
  assertStringIncludes(decodeURIComponent(lookup), "video_id=eq.dQw4w9WgXcQ");
});

Deno.test("process-approved-video falls back to the source URL for a non-YouTube video", async () => {
  const result = await call({ videoId: VIDEO }, backend({
    video: aVideo({ source_url: "https://www.tiktok.com/@someone/video/123" }),
  }));

  const lookups = result.calls.filter((u) => u.includes("audio_files")).map(decodeURIComponent);
  assertEquals(lookups.length, 1);
  assertStringIncludes(lookups[0], "source_url=eq.https://www.tiktok.com");
});

Deno.test("process-approved-video downloads the media when nothing is staged", async () => {
  const result = await call({ videoId: VIDEO }, backend());

  assertEquals(bodySentTo(result, "download-media").url, aVideo().source_url);
  assertEquals(finalStatus(result), "completed");
});

Deno.test("process-approved-video records the duration the download reported", async () => {
  const result = await call({ videoId: VIDEO }, backend());

  // Rounded, and written on its own so a later pipeline failure still leaves
  // the duration behind for the player.
  assertEquals(lastPatchWith(result, "duration_seconds")?.duration_seconds, 31);
});

Deno.test("process-approved-video short-circuits on a cached transcription", async () => {
  const result = await call({ videoId: VIDEO }, backend({
    download: () =>
      json({
        cached: true,
        transcriptionData: {
          lines: [{ id: "l1", arabic: "شلونك" }],
          vocabulary: [],
          grammarPoints: [],
          culturalContext: "cached",
          dialect: "Egyptian",
          difficulty: "Advanced",
        },
      }),
  }));

  // The same clip transcribed twice costs six ASR calls and an LLM ensemble for
  // an answer that already exists.
  assertEquals(finalStatus(result), "completed");
  assertEquals(lastPatchWith(result, "dialect")?.dialect, "Egyptian");
  assertEquals(result.calls.some((u) => u.includes("analyze-gulf-arabic")), false);
  assertEquals(result.calls.some((u) => u.includes("elevenlabs")), false);
});

Deno.test("process-approved-video fails the row when the download fails", async () => {
  const result = await call({ videoId: VIDEO }, backend({
    download: () => new Response("no downloader available", { status: 502 }),
  }));

  assertEquals(finalStatus(result), "failed");
  assertStringIncludes(String(lastPatchWith(result, "transcription_error")?.transcription_error), "Download failed (502)");
});

Deno.test("process-approved-video fails the row when the download returns no audio", async () => {
  const result = await call({ videoId: VIDEO }, backend({
    // A 200 with an empty payload is what a blocked or geo-restricted source
    // looks like, and it must not read as silence.
    download: () => json({ contentType: "audio/mp4" }),
  }));

  assertEquals(finalStatus(result), "failed");
  assertStringIncludes(
    String(lastPatchWith(result, "transcription_error")?.transcription_error),
    "No audio data received",
  );
});

// ── Step 2: the engines ──────────────────────────────────────────────────────

Deno.test("process-approved-video runs every configured engine", async () => {
  const result = await call({ videoId: VIDEO }, backend());

  // Six legs, all fired concurrently off one audio buffer. Any of them may
  // fail; the point is that none is skipped when its key is present.
  for (const host of [
    "api.elevenlabs.io",
    "api.cohere.com",
    "api.fanar.qa",
    "api.soniox.com",
    "api.munsit.com",
    // Azure's batch transcription lives on the Cognitive Services host, not the
    // `*.speech.microsoft.com` one the TTS legs elsewhere in the app use.
    "cognitive.microsoft.com",
  ]) {
    assert(
      result.calls.some((u) => u.includes(host)),
      `expected a call to ${host}, saw:\n${result.calls.join("\n")}`,
    );
  }
});

Deno.test("process-approved-video skips an engine whose key is absent", async () => {
  const result = await call({ videoId: VIDEO }, backend(), {
    env: { COHERE_API_KEY: undefined, ELEVENLABS_API_KEY: undefined },
  });

  // An unset key is a pilot that has not been switched on, not a failure — the
  // leg returns null text and the pipeline still completes.
  assertEquals(result.calls.some((u) => u.includes("api.cohere.com")), false);
  assertEquals(result.calls.some((u) => u.includes("api.elevenlabs.io")), false);
  assertEquals(finalStatus(result), "completed");
});

Deno.test("process-approved-video completes when a single engine is down", async () => {
  const result = await call({ videoId: VIDEO }, {
    ...backend(),
    "api.soniox.com": () => new Response("service unavailable", { status: 503 }),
  });

  // Every leg catches its own errors, so one outage costs a transcript
  // alternate and nothing else.
  assertEquals(finalStatus(result), "completed");
});

Deno.test("process-approved-video meters Fanar against its daily budget", async () => {
  const result = await call({ videoId: VIDEO }, backend());

  // The Fanar STT quota is shared with the Transcribe page. This leg used to
  // bypass the counter entirely and drain it silently.
  const usage = result.calls.filter((u) => u.includes("fanar_usage"));
  assert(usage.length > 0, "expected fanar_usage to be consulted");
});

Deno.test("process-approved-video leaves Fanar alone once the day's budget is spent", async () => {
  const result = await call({ videoId: VIDEO }, backend({
    extra: {
      "/rest/v1/fanar_usage": (request) =>
        request.method === "HEAD"
          ? new Response(null, {
              status: 200,
              headers: {
                "content-range": "0-0/99",
                "access-control-expose-headers": "content-range",
              },
            })
          : json([], 200),
    },
  }));

  assertEquals(result.calls.some((u) => u.includes("api.fanar.qa")), false);
  assertEquals(finalStatus(result), "completed");
});

Deno.test("process-approved-video records what each engine returned", async () => {
  const result = await call({ videoId: VIDEO }, backend());
  const asr = asrProvenance(result);

  assert(asr, "expected ASR provenance to be written");
  // Provenance in the row rather than only in the logs is what makes an engine
  // swap A/B-able after the fact.
  for (const engine of ["munsit", "soniox", "fanar", "scribe", "azure", "cohere"]) {
    assert(engine in asr, `expected ${engine} in ASR provenance`);
    assert("chars" in asr[engine], `expected a char count for ${engine}`);
    assert("latency_ms" in asr[engine], `expected a latency for ${engine}`);
  }
  assert("primary" in asr);
  assert("alignment_source" in asr);
});

Deno.test("process-approved-video records a failing engine's error in provenance", async () => {
  const result = await call({ videoId: VIDEO }, {
    ...backend(),
    "api.soniox.com": () => new Response("service unavailable", { status: 503 }),
  });
  const asr = asrProvenance(result);

  assert(asr, "expected ASR provenance to be written");
  assertEquals(asr.soniox.ok, false);
  assert(String(asr.soniox.error).length > 0, "expected the Soniox failure to be recorded");
});

Deno.test("process-approved-video keeps provenance loss from failing the run", async () => {
  const result = await call({ videoId: VIDEO }, backend({
    extra: {
      // The read-merge that precedes the provenance write is the fragile part;
      // losing the record of which engine won is not worth failing a transcript
      // that otherwise succeeded.
      "/rest/v1/discover_videos?select=engines_used": () => json({ error: "gone" }, 500),
    },
  }));

  assertEquals(finalStatus(result), "completed");
});

Deno.test("process-approved-video resolves a country onto its dialect module", async () => {
  const result = await call({ videoId: VIDEO }, backend({ video: aVideo({ dialect: "Kuwaiti" }) }));

  // `discover_videos.dialect` holds countries as often as modules. Kuwaiti is
  // inside Gulf; matching the string exactly would route it to the fallback.
  assertEquals(bodySentTo(result, "analyze-gulf-arabic").dialectModule, "Gulf");
});

Deno.test("process-approved-video keeps Egyptian and Yemeni as their own modules", async () => {
  for (const dialect of ["Egyptian", "Yemeni"]) {
    const result = await call({ videoId: VIDEO }, backend({ video: aVideo({ dialect }) }));
    assertEquals(bodySentTo(result, "analyze-gulf-arabic").dialectModule, dialect);
  }
});

// ── Step 3: analysis and finalisation ────────────────────────────────────────

Deno.test("process-approved-video sends the alternates alongside the primary transcript", async () => {
  const result = await call({ videoId: VIDEO }, backend());
  const sent = bodySentTo(result, "analyze-gulf-arabic");

  // The merge step is the reason six engines run at all — it needs every
  // reading, not just the one that scored highest.
  assertEquals(sent.videoId, VIDEO);
  assert("transcript" in sent);
  assert("primaryEngine" in sent);
  assert(
    ["fanarTranscript", "sonioxTranscript", "munsitTranscript", "azureTranscript", "scribeTranscript", "cohereTranscript"]
      .some((key) => key in sent),
    `expected at least one alternate transcript, got ${Object.keys(sent).join(",")}`,
  );
});

Deno.test("process-approved-video calls analysis with the service role, not the caller's token", async () => {
  const fn = await loadFunction("process-approved-video", { upstreams: backend() });
  try {
    await fn.handler(
      jsonRequest("process-approved-video", { videoId: VIDEO }, { jwt: ANON }),
    );
    await fn.background();

    // The pipeline outlives the request, so a user JWT can expire mid-run — and
    // the anon key the admin form sends has no rights to the sibling functions
    // at all.
    const analyze = fn.callsTo("analyze-gulf-arabic")[0];
    assertEquals(analyze.headers.authorization, `Bearer ${SERVICE_ROLE}`);
  } finally {
    fn.restore();
  }
});

Deno.test("process-approved-video downloads media with the service role, not the caller's token", async () => {
  const fn = await loadFunction("process-approved-video", { upstreams: backend() });
  try {
    await fn.handler(
      jsonRequest("process-approved-video", { videoId: VIDEO }, { jwt: ANON }),
    );
    await fn.background();

    // download-media accepts the service-role key or a real user JWT and
    // nothing else. Forwarding the anon key the admin form sends made every
    // URL-sourced acquisition — TikTok links included — die on a 401 before it
    // ever reached the downloader.
    const download = fn.callsTo("download-media")[0];
    assertEquals(download.headers.authorization, `Bearer ${SERVICE_ROLE}`);
  } finally {
    fn.restore();
  }
});

Deno.test("process-approved-video finalises from the HTTP result when analysis answers in time", async () => {
  const result = await call({ videoId: VIDEO }, backend());
  const final = lastPatchWith(result, "transcription_status");

  assertEquals(final?.transcription_status, "completed");
  assertEquals(final?.dialect, "Gulf");
  assertEquals(final?.difficulty, "Beginner");
  assertEquals((final?.vocabulary as unknown[]).length, 1);
});

Deno.test("process-approved-video prefers what analysis wrote to the row directly", async () => {
  const result = await call({ videoId: VIDEO }, backend({
    // The gateway drops the response at ~150s but the function keeps running
    // and persists directly, which is the common outcome for a long clip.
    analyze: () => new Response("gateway timeout", { status: 504 }),
    refreshed: {
      transcription_status: "analysis_complete",
      transcript_lines: [{ id: "l1", arabic: "شلونك اليوم" }],
      cultural_context: "persisted directly",
      title: "From the direct persist",
      title_arabic: "من الحفظ المباشر",
    },
  }));

  const final = lastPatchWith(result, "transcription_status");
  assertEquals(final?.transcription_status, "completed");
  assertEquals(final?.title, "From the direct persist");
  assertEquals(final?.cultural_context, "persisted directly");
});

Deno.test("process-approved-video times lines from real ASR word timestamps", async () => {
  // Soniox hears the fixture's two lines word for word, with a 3.4-second
  // silence between them — somebody nodding, a cut, a laugh.
  const soniox: UpstreamHandler = (request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/files")) return json({ id: "file_fixture" });
    if (path.endsWith("/transcript")) {
      return json({
        text: "شلونك اليوم الحمد لله بخير",
        tokens: [
          { text: " شلونك", start_ms: 500, end_ms: 1000 },
          { text: " اليوم", start_ms: 1100, end_ms: 1600 },
          { text: " الحمد", start_ms: 5000, end_ms: 5400 },
          { text: " لله", start_ms: 5500, end_ms: 5800 },
          { text: " بخير", start_ms: 5900, end_ms: 6400 },
        ],
      });
    }
    return json({ id: "tr_fixture", status: "completed" });
  };
  const result = await call({ videoId: VIDEO }, backend({ extra: { "api.soniox.com": soniox } }));
  const lines = lastPatchWith(result, "transcript_lines")?.transcript_lines as Array<{
    startMs: number;
    endMs: number;
    words: Array<{ surface: string; startMs: number; endMs: number; matched: boolean }>;
  }>;

  // The pause between the lines survives. Proportional allocation — the old
  // behaviour — made every line contiguous with the next, so any real silence
  // became drift for the rest of the clip.
  assertEquals(lines[0].startMs, 500);
  assertEquals(lines[0].endMs, 1600);
  assertEquals(lines[1].startMs, 5000);
  assertEquals(lines[1].endMs, 6400);

  // Per-word timings persist so the editor and a later re-sync pass can build
  // on real times instead of re-fabricating uniform ones.
  assertEquals(lines[0].words.map((w) => w.surface), ["شلونك", "اليوم"]);
  assertEquals(lines[0].words[0].startMs, 500);
  assertEquals(lines[0].words[0].endMs, 1000);
  assert(lines.every((l) => l.words.every((w) => w.matched)), "expected every word matched");
});

Deno.test("process-approved-video gives every line a place on the audio timeline", async () => {
  const result = await call({ videoId: VIDEO }, backend());
  const lines = lastPatchWith(result, "transcript_lines")?.transcript_lines as
    Array<Record<string, number>>;

  // The default fixtures give the aligner nothing to match ("مرحبا" is not in
  // any line), so this is the fallback path: timings allocated proportionally
  // by line length, contiguous by construction.
  assertEquals(lines.length, 2);
  assertEquals(lines[0].startMs, 0);
  assert(lines[0].endMs > lines[0].startMs, "expected the first line to span time");
  assertEquals(lines[1].startMs, lines[0].endMs);
});

Deno.test("process-approved-video spreads lines across the whole clip when word timings are useless", async () => {
  const result = await call({ videoId: VIDEO }, backend());
  const lines = lastPatchWith(result, "transcript_lines")?.transcript_lines as
    Array<Record<string, number>>;

  // 31 seconds came back from the download. A degenerate word span collapses
  // every line onto one instant, so the duration is the fallback.
  assertEquals(lines.at(-1)?.endMs, 31_000);
});

Deno.test("process-approved-video tokenizes a line the analyser left untokenized", async () => {
  const result = await call({ videoId: VIDEO }, backend());
  const lines = lastPatchWith(result, "transcript_lines")?.transcript_lines as
    Array<{ tokens: Array<{ surface: string }> }>;

  // The reader taps individual words, so a line with no tokens is a line with
  // nothing to tap.
  assertEquals(lines[0].tokens.map((t) => t.surface), ["شلونك", "اليوم"]);
});

Deno.test("process-approved-video names a video the admin never titled", async () => {
  const result = await call({ videoId: VIDEO }, backend());
  const final = lastPatchWith(result, "title");

  // "Untitled Video" is the placeholder the approve form leaves behind.
  assertEquals(final?.title, "A Gulf greeting");
  assertEquals(final?.title_arabic, "تحية خليجية");
});

Deno.test("process-approved-video keeps a title the admin chose", async () => {
  const result = await call({ videoId: VIDEO }, backend({
    video: aVideo({ title: "Ahmed at the souq", title_arabic: "أحمد في السوق" }),
  }));
  const final = lastPatchWith(result, "title");

  assertEquals(final?.title, "Ahmed at the souq");
  assertEquals(final?.title_arabic, "أحمد في السوق");
});

Deno.test("process-approved-video falls back to the first line for a missing title", async () => {
  const result = await call({ videoId: VIDEO }, backend({
    analyze: () => json({ success: true, result: aResult({ title: null, titleArabic: null }) }),
    extra: {
      // The AI namer is tried first and is allowed to fail.
      "generativelanguage.googleapis.com/v1beta/openai": () => new Response("rate limited", { status: 429 }),
    },
  }));
  const final = lastPatchWith(result, "title");

  assertEquals(final?.title, "How are you today");
  assertEquals(final?.title_arabic, "شلونك اليوم");
});

Deno.test("process-approved-video asks for a CEFR band once the transcript is saved", async () => {
  const result = await call({ videoId: VIDEO }, backend());

  assertEquals(bodySentTo(result, "rate-video-cefr").videoId, VIDEO);
  // Ordering matters: rating reads the transcript, so it has to run after the
  // finalising write, not alongside it.
  const rateAt = result.calls.findIndex((u) => u.includes("rate-video-cefr"));
  const finalAt = result.calls.map((u) => u.includes("discover_videos")).lastIndexOf(true);
  assert(rateAt > 0 && rateAt < result.calls.length);
  assert(finalAt < rateAt, "expected the transcript to be persisted before rating");
});

Deno.test("process-approved-video completes even when the rating fails", async () => {
  const result = await call({ videoId: VIDEO }, {
    ...backend(),
    "/functions/v1/rate-video-cefr": () => new Response("rater down", { status: 500 }),
  });

  // The transcript is already persisted by this point; a missing difficulty
  // band is an admin nudge, not a failed transcription.
  assertEquals(finalStatus(result), "completed");
});

Deno.test("process-approved-video fails the row when the finalising write is rejected", async () => {
  const result = await call({ videoId: VIDEO }, backend({
    extra: {
      "/rest/v1/discover_videos": async (request) => {
        if (request.method === "GET") {
          if (request.url.includes("select=engines_used")) return json({ engines_used: null });
          if (request.url.includes("transcription_status")) return json({ transcription_status: "processing" });
          return json(aVideo());
        }
        // Reject the write that carries the transcript and let every other one
        // through. Picked out by its content rather than by counting writes:
        // the run makes several (status, duration, provenance, progress
        // notes), and a count breaks the moment one is added.
        const body = await request.text();
        return body.includes("transcript_lines")
          ? json({ message: "value too long for type character varying" }, 400)
          : json([], 200);
      },
    },
  }));

  // A rejected save must not leave the row saying "completed" with no lines.
  assertEquals(finalStatus(result), "failed");
});

// ── Memes ────────────────────────────────────────────────────────────────────

Deno.test("process-approved-video will not transcribe a meme with no screen-text pass", async () => {
  const result = await call({ videoId: VIDEO }, backend({ video: aVideo({ is_meme: true }) }));

  // A meme's joke is usually the on-screen text, so audio alone produces a
  // confident and wrong analysis. Better to stop and ask for the video file.
  assertEquals(finalStatus(result), "failed");
  assertStringIncludes(
    String(lastPatchWith(result, "transcription_error")?.transcription_error),
    "Meme screen-text extraction is missing",
  );
});

Deno.test("process-approved-video feeds a meme's on-screen text into the analysis", async () => {
  const visual = {
    sceneContext: "Two men arguing in a majlis",
    onScreenTextSegments: [
      { text: "لما تقول لأمك", translation: "when you tell your mum", startSeconds: 0, endSeconds: 2 },
      { text: "بطلع مع الشباب", translation: "I'm going out with the lads", startSeconds: 2, endSeconds: 4 },
    ],
  };
  const result = await call({ videoId: VIDEO }, backend({
    video: aVideo({ is_meme: true }),
    storage: (request) =>
      request.url.includes(".visual.json")
        ? new Response(JSON.stringify(visual), { status: 200, headers: { "content-type": "application/json" } })
        : json({ error: "Object not found" }, 404),
  }));

  const sent = bodySentTo(result, "analyze-gulf-arabic");
  assertEquals(sent.isMeme, true);
  assertEquals((sent.onScreenTextSegments as unknown[]).length, 2);
  assertStringIncludes(String(sent.visualContext), "لما تقول لأمك");
  assertStringIncludes(String(sent.visualContext), "Two men arguing in a majlis");
  assertEquals(finalStatus(result), "completed");
});

// ── On-screen text is not transcript ─────────────────────────────────────────

/** Storage that serves one `<id>.visual.json` and nothing else. */
const visualStorage = (visual: unknown): UpstreamHandler => (request) =>
  request.url.includes(".visual.json")
    ? new Response(JSON.stringify(visual), { status: 200, headers: { "content-type": "application/json" } })
    : json({ error: "Object not found" }, 404);

const A_MEME_SCREEN = {
  sceneContext: "Two men arguing in a majlis",
  onScreenTextSegments: [
    { text: "لما تقول لأمك", translation: "when you tell your mum", startSeconds: 0, endSeconds: 2 },
    { text: "بطلع مع الشباب", translation: "I'm going out with the lads", startSeconds: 2, endSeconds: 4 },
  ],
};

Deno.test("process-approved-video keeps on-screen text out of the transcript", async () => {
  const result = await call({ videoId: VIDEO }, backend({
    video: aVideo({ is_meme: true }),
    storage: visualStorage(A_MEME_SCREEN),
  }));

  const saved = lastPatchWith(result, "transcript_lines")?.transcript_lines as Array<Record<string, unknown>>;
  // The overlays used to be appended here, which made a caption indistinguishable
  // from something a speaker said — line-by-line playback would try to play
  // audio that was never recorded at that timestamp.
  assertEquals(saved.map((l) => l.arabic), ["شلونك اليوم", "الحمد لله بخير"]);
  assert(!saved.some((l) => l.source === "on_screen"));
});

Deno.test("process-approved-video stores on-screen text in its own column", async () => {
  const result = await call({ videoId: VIDEO }, backend({
    video: aVideo({ is_meme: true }),
    storage: visualStorage(A_MEME_SCREEN),
  }));

  const timeline = lastPatchWith(result, "visual_timeline")?.visual_timeline as Array<Record<string, unknown>>;
  assertEquals(timeline.length, 2);
  assertEquals(timeline[0].text, "لما تقول لأمك");
  assertEquals(timeline[0].startSeconds, 0);
  // The scene the vision pass described rides on the first moment, so the tutor
  // can say what is on screen as well as what it reads.
  assertEquals(timeline[0].scene, "Two men arguing in a majlis");
});

Deno.test("process-approved-video strips on-screen lines the analysis folded in", async () => {
  const result = await call({ videoId: VIDEO }, backend({
    analyze: () => json({
      success: true,
      result: aResult({
        lines: [
          { id: "l1", arabic: "شلونك اليوم", translation: "How are you today" },
          { id: "l2", arabic: "POV: تروح الدوام", translation: "POV: you go to work", source: "on_screen" },
          { id: "l3", arabic: "زين والله", translation: "Good, honestly", segmentType: "text_overlay" },
        ],
      }),
    }),
  }));

  const saved = lastPatchWith(result, "transcript_lines")?.transcript_lines as Array<Record<string, unknown>>;
  // The prompt tells the model not to do this. The pipeline does not take its
  // word for it — one slip would put a caption back in a speaker's mouth.
  assertEquals(saved.map((l) => l.arabic), ["شلونك اليوم"]);
});

Deno.test("process-approved-video rescues overlays an older run left in the transcript", async () => {
  const result = await call({ videoId: VIDEO }, backend({
    analyze: () => json({
      success: true,
      result: aResult({
        lines: [
          { id: "l1", arabic: "شلونك اليوم", translation: "How are you today" },
          {
            id: "l2",
            arabic: "POV: تروح الدوام",
            translation: "POV: you go to work",
            source: "on_screen",
            startMs: 2000,
            endMs: 5000,
          },
        ],
      }),
    }),
  }));

  // With no visual pass for this row, the transcript is the only copy of that
  // caption — stripping it without moving it across would delete it.
  const timeline = lastPatchWith(result, "visual_timeline")?.visual_timeline as Array<Record<string, unknown>>;
  assertEquals(timeline.length, 1);
  assertEquals(timeline[0].text, "POV: تروح الدوام");
  assertEquals(timeline[0].startSeconds, 2);
});

Deno.test("process-approved-video writes no timeline when there is nothing to write", async () => {
  const result = await call({ videoId: VIDEO }, backend());

  // An empty array here would wipe a timeline that a separate re-read had just
  // filled in, so the column is left alone instead.
  assertEquals(lastPatchWith(result, "visual_timeline"), undefined);
});

Deno.test("process-approved-video reads on-screen text for an ordinary video too", async () => {
  const result = await call({ videoId: VIDEO }, backend({
    storage: visualStorage({
      sceneContext: "A woman driving",
      onScreenTextSegments: [{ text: "الزحمة قاتلة", startSeconds: 0, endSeconds: 3 }],
    }),
  }));

  // Captions, POV lines and title cards are not a meme-only phenomenon; this
  // used to run only when the meme box was ticked.
  const sent = bodySentTo(result, "analyze-gulf-arabic");
  assertStringIncludes(String(sent.visualContext), "الزحمة قاتلة");
  const timeline = lastPatchWith(result, "visual_timeline")?.visual_timeline as unknown[];
  assertEquals(timeline.length, 1);
});

Deno.test("process-approved-video tells the analysis the screen text is not speech", async () => {
  const result = await call({ videoId: VIDEO }, backend({
    video: aVideo({ is_meme: true }),
    storage: visualStorage(A_MEME_SCREEN),
  }));

  const sent = bodySentTo(result, "analyze-gulf-arabic");
  assertStringIncludes(String(sent.visualContext), "context only, NOT spoken");
});

Deno.test("process-approved-video does not stop an ordinary video that has no screen-text pass", async () => {
  // Only a meme is refused without one — its joke is usually the text itself.
  const result = await call({ videoId: VIDEO }, backend());

  assertEquals(finalStatus(result), "completed");
});

// ── Audio that is not Arabic ─────────────────────────────────────────────────

const refusedAudio: UpstreamHandler = () => json({
  success: true,
  result: { rawTranscriptArabic: "", lines: [], vocabulary: [], grammarPoints: [] },
  noArabicSpeech: true,
  audio: { verdict: "non_arabic", reason: "the engines disagree completely over a pop track" },
});

Deno.test("process-approved-video completes a video whose audio is not Arabic", async () => {
  const result = await call({ videoId: VIDEO }, backend({ analyze: refusedAudio }));

  // Not a failure: the video is fine, the audio just is not Arabic. Failing it
  // would hide a meme whose text on screen is the whole lesson.
  assertEquals(finalStatus(result), "completed");
  const saved = lastPatchWith(result, "transcript_lines")?.transcript_lines as unknown[];
  assertEquals(saved.length, 0);
});

Deno.test("process-approved-video says why it transcribed nothing", async () => {
  const result = await call({ videoId: VIDEO }, backend({
    video: aVideo({ is_meme: true }),
    storage: visualStorage(A_MEME_SCREEN),
    analyze: refusedAudio,
  }));

  const note = String(lastPatchWith(result, "transcription_error")?.transcription_error);
  assertStringIncludes(note, "not Arabic");
  assertStringIncludes(note, "pop track");
  // The reviewer needs to know the video still teaches something.
  assertStringIncludes(note, "on-screen text was kept");
});

Deno.test("process-approved-video keeps a meme's screen text when its audio is refused", async () => {
  const result = await call({ videoId: VIDEO }, backend({
    video: aVideo({ is_meme: true }),
    storage: visualStorage(A_MEME_SCREEN),
    analyze: refusedAudio,
  }));

  const timeline = lastPatchWith(result, "visual_timeline")?.visual_timeline as unknown[];
  assertEquals(timeline.length, 2);
});

Deno.test("process-approved-video notes the refusal on the direct-persist path too", async () => {
  // The production path: analyze-gulf-arabic writes the empty transcript itself
  // and the pipeline reads `analysis_complete` back off the row. The refusal has
  // to survive that hand-off, or the row completes with an empty transcript and
  // no reason given.
  const result = await call({ videoId: VIDEO }, backend({
    analyze: refusedAudio,
    refreshed: { transcription_status: "analysis_complete", transcript_lines: [], cultural_context: null },
  }));

  assertEquals(finalStatus(result), "completed");
  assertStringIncludes(
    String(lastPatchWith(result, "transcription_error")?.transcription_error),
    "not Arabic",
  );
});

Deno.test("process-approved-video leaves no note on an ordinary successful run", async () => {
  const result = await call({ videoId: VIDEO }, backend());

  // A stale error keeps a video out of the publishable queue forever.
  assertEquals(lastPatchWith(result, "transcription_error")?.transcription_error, null);
});

Deno.test("process-approved-video flags a meme whose screen text came back empty", async () => {
  const result = await call({ videoId: VIDEO }, backend({
    video: aVideo({ is_meme: true }),
    storage: (request) =>
      request.url.includes(".visual.json")
        ? new Response(JSON.stringify({ sceneContext: "a still frame", onScreenTextSegments: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        : json({ error: "Object not found" }, 404),
  }));

  // The extraction ran and found nothing, which is a different thing from not
  // having run — it completes, but carries a warning into the review queue.
  const final = lastPatchWith(result, "transcription_status");
  assertEquals(final?.transcription_status, "completed");
  assertStringIncludes(String(final?.transcription_error), "no readable on-screen text");
});

// ── Stages, checkpoints and resumption ───────────────────────────────────────
//
// The platform's wall clock belongs to the worker, not the request, so a run
// can be torn down at any point with no error raised. What these tests pin is
// that the run is cut at stage boundaries it can be resumed from, that a
// resume never repeats paid work, and that an analysis whose worker died is
// started again rather than waited on forever.

/**
 * Drive a run through the real handler across every hop, the way the platform
 * does: each `{ videoId, stage }` request the function sends itself lands back
 * on the handler as a new request with its own background task.
 */
async function callAcrossHops(
  body: unknown,
  options: Parameters<typeof backend>[0] = {},
  env: Record<string, string | undefined> = {},
): Promise<Result & { store: Map<string, string>; hops: string[] }> {
  const { handler: storage, store } = withCheckpointStore(options.storage ?? emptyStorage);
  let self: ((request: Request) => Promise<Response>) | null = null;
  const hops: string[] = [];
  const upstreams = backend({
    ...options,
    storage,
    extra: {
      ...(options.extra ?? {}),
      "/functions/v1/process-approved-video": async (request) => {
        const parsed = JSON.parse(await request.text()) as { stage?: string };
        hops.push(parsed.stage ?? "?");
        // Re-enter the handler with the same headers the hop sent (the
        // service-role bearer), exactly as the gateway would.
        return await self!(new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(parsed) }));
      },
    },
  });
  const fn = await loadFunction("process-approved-video", {
    upstreams,
    env: { ...FAST_PIPELINE_ENV, ...env },
  });
  self = fn.handler;
  try {
    const response = await fn.handler(jsonRequest("process-approved-video", body, { jwt: SERVICE_ROLE }));
    const parsed = JSON.parse(await response.text()) as Record<string, unknown>;
    await fn.background();
    return {
      status: response.status,
      body: parsed,
      calls: fn.calls.map((c) => c.url),
      bodies: fn.calls.map((c) => c.body),
      patches: fn.calls
        .filter((c) => c.url.includes("discover_videos") && c.method === "PATCH")
        .map((c) => JSON.parse(c.body ?? "{}") as Record<string, unknown>),
      store,
      hops,
    };
  } finally {
    fn.restore();
  }
}

/** A checkpoint as the ASR stage leaves it: engines done, analysis not yet started. */
const afterAsrCheckpoint = (over: Record<string, unknown> = {}) => ({
  version: 1,
  stage: "analyze",
  startedAt: "2026-09-04T10:00:00.000Z",
  updatedAt: "2026-09-04T10:01:00.000Z",
  analyzeAttempts: 0,
  asr: {
    primaryText: "شلونك اليوم الحمد لله بخير",
    primaryEngine: "Soniox",
    dialectModule: "Gulf",
    downloadDuration: 31,
    texts: { scribe: "", fanar: "", soniox: "شلونك اليوم الحمد لله بخير", munsit: "", azure: "", cohere: "" },
    sonioxTranslation: null,
    alignmentWords: [
      { text: "شلونك", start: 0.5, end: 1.0 },
      { text: "اليوم", start: 1.1, end: 1.6 },
      { text: "الحمد", start: 2.0, end: 2.4 },
      { text: "لله", start: 2.5, end: 2.8 },
      { text: "بخير", start: 3.0, end: 3.5 },
    ],
    alignmentSource: "Soniox",
  },
  ...over,
});

Deno.test("process-approved-video runs as three requests, one per stage", async () => {
  const result = await callAcrossHops({ videoId: VIDEO });

  // ASR hands to analyze, analyze hands to finalize; nothing runs inline.
  assertEquals(result.hops, ["analyze", "finalize"]);
  assertEquals(finalStatus(result), "completed");
  assertEquals(storedCheckpoint(result.store)?.stage, "done");
});

Deno.test("process-approved-video checkpoints the ASR results before handing over", async () => {
  const result = await callAcrossHops({ videoId: VIDEO });

  // The hop is the first thing the checkpoint has to survive: whatever the
  // engines produced is on disk before the analysis is asked for.
  const store = result.store;
  const writes = result.calls.filter((u) => u.includes(`${VIDEO}.pipeline.json`));
  const firstHop = result.calls.findIndex((u) => u.includes("/functions/v1/process-approved-video"));
  const firstWrite = result.calls.findIndex((u) => u.includes(`${VIDEO}.pipeline.json`));
  assert(writes.length > 0, "expected a checkpoint write");
  assert(firstWrite < firstHop, "expected the checkpoint written before the first hop");

  const cp = storedCheckpoint(store) as { asr?: { primaryText?: string; alignmentSource?: string } };
  assert(cp?.asr?.primaryText, "expected the primary transcript in the checkpoint");
  assert(cp?.asr?.alignmentSource, "expected the alignment source in the checkpoint");
});

Deno.test("process-approved-video keeps going inline when the checkpoint cannot be written", async () => {
  // Storage down for the checkpoint only. The run must not fail over a
  // missing safety net — it runs as one task, exactly as it used to.
  const result = await call({ videoId: VIDEO }, backend({
    extra: {
      "/functions/v1/process-approved-video": () => {
        throw new Error("no hop should be attempted without a checkpoint");
      },
    },
  }));

  assertEquals(finalStatus(result), "completed");
  assertEquals(bodySentTo(result, "rate-video-cefr").videoId, VIDEO);
});

Deno.test("process-approved-video runs the next stage inline when the hop is refused", async () => {
  const { handler: storage } = withCheckpointStore(emptyStorage);
  const result = await call({ videoId: VIDEO }, backend({
    storage,
    extra: {
      "/functions/v1/process-approved-video": () => new Response("boom", { status: 503 }),
    },
  }));

  // A refused hop is a lost stage boundary, not a lost run.
  assertEquals(finalStatus(result), "completed");
});

Deno.test("process-approved-video resumes from the checkpoint without paying for the engines again", async () => {
  const { handler: storage, store } = withCheckpointStore(emptyStorage);
  store.set(`${VIDEO}.pipeline.json`, JSON.stringify(afterAsrCheckpoint()));

  const result = await call({ videoId: VIDEO, resume: true }, backend({
    video: aVideo({ transcription_status: "processing" }),
    storage,
  }));

  assertEquals(result.status, 202);
  assertEquals(result.body.stage, "analyze");
  // No download, no engine: the checkpoint already holds the transcripts.
  assertEquals(result.calls.some((u) => u.includes("download-media")), false);
  assertEquals(result.calls.some((u) => u.includes("elevenlabs") || u.includes("soniox") || u.includes("munsit")), false);
  // The checkpointed primary is what the analysis receives.
  assertEquals(bodySentTo(result, "analyze-gulf-arabic").transcript, "شلونك اليوم الحمد لله بخير");
  assertEquals(finalStatus(result), "completed");
});

Deno.test("process-approved-video resumes a row the analysis already wrote by finalising it", async () => {
  const { handler: storage, store } = withCheckpointStore(emptyStorage);
  store.set(`${VIDEO}.pipeline.json`, JSON.stringify(afterAsrCheckpoint({ analyzeAttempts: 1 })));

  const result = await call({ videoId: VIDEO, resume: true }, backend({
    video: aVideo({ transcription_status: "analysis_complete" }),
    storage,
    refreshed: {
      transcription_status: "analysis_complete",
      transcript_lines: [{ id: "l1", arabic: "شلونك اليوم" }, { id: "l2", arabic: "الحمد لله بخير" }],
      cultural_context: "persisted directly",
      title: "From the direct persist",
      title_arabic: null,
    },
  }));

  assertEquals(result.body.stage, "finalize");
  assertEquals(result.calls.some((u) => u.includes("analyze-gulf-arabic")), false);
  const final = lastPatchWith(result, "transcription_status");
  assertEquals(final?.transcription_status, "completed");
  // Real alignment from the checkpointed words, not the reaper's promotion
  // that skips it: line two starts where its first word does.
  const lines = final?.transcript_lines as Array<{ startMs: number }>;
  assertEquals(lines[1].startMs, 2000);
});

Deno.test("process-approved-video leaves a finished or failed row alone on resume", async () => {
  for (const status of ["completed", "failed", "manual"]) {
    const result = await call({ videoId: VIDEO, resume: true }, backend({
      video: aVideo({ transcription_status: status }),
    }));
    assertEquals(result.status, 200, status);
    assertEquals(result.body.resumed, false, status);
    assertEquals(result.patches.length, 0, `expected no write for a ${status} row`);
  }
});

Deno.test("process-approved-video resumes a stale pending row from the start", async () => {
  // A kickoff that was lost before the engines ran: nothing to checkpoint,
  // so the resume is a fresh run — and the row moves to processing so the
  // admin page stops calling it queued.
  const result = await call({ videoId: VIDEO, resume: true }, backend({
    video: aVideo({ transcription_status: "pending" }),
  }));

  assertEquals(result.body.stage, "asr");
  assertEquals(result.patches[0].transcription_status, "processing");
  assertEquals(result.calls.some((u) => u.includes("download-media")), true);
  assertEquals(finalStatus(result), "completed");
});

Deno.test("process-approved-video finalises on the analysis's own callback, even with no checkpoint", async () => {
  // analyze-gulf-arabic calls `{ stage: "finalize" }` after it persists. If the
  // pipeline's checkpoint is gone (storage hiccup, older run), the transcript
  // still completes — with proportional timing, since there are no words to
  // align against.
  const result = await call({ videoId: VIDEO, stage: "finalize" }, backend({
    video: aVideo({ transcription_status: "analysis_complete", duration_seconds: 10 }),
    refreshed: {
      transcription_status: "analysis_complete",
      transcript_lines: [{ id: "l1", arabic: "شلونك" }, { id: "l2", arabic: "الحمد لله" }],
      cultural_context: null,
      title: "Persisted",
      title_arabic: "محفوظ",
    },
  }));

  assertEquals(result.status, 202);
  assertEquals(result.calls.some((u) => u.includes("analyze-gulf-arabic")), false);
  const final = lastPatchWith(result, "transcription_status");
  assertEquals(final?.transcription_status, "completed");
  const lines = final?.transcript_lines as Array<{ startMs: number; endMs: number }>;
  assertEquals(lines[0].startMs, 0);
  assertEquals(lines[lines.length - 1].endMs, 10_000);
  assertEquals(bodySentTo(result, "rate-video-cefr").videoId, VIDEO);
});

Deno.test("process-approved-video refuses a hop it has no checkpoint for", async () => {
  const result = await call({ videoId: VIDEO, stage: "analyze" }, backend());
  assertEquals(result.status, 409);
});

Deno.test("process-approved-video rejects a stage it does not have", async () => {
  const result = await call({ videoId: VIDEO, stage: "teleport" }, backend());
  assertEquals(result.status, 400);
});

Deno.test("process-approved-video does not rate a row another request finalised first", async () => {
  // The finalising write is conditional on the row still being where this
  // stage expects it. Zero rows back means the other finaliser won.
  const result = await call({ videoId: VIDEO, stage: "finalize" }, backend({
    video: aVideo({ transcription_status: "analysis_complete" }),
    refreshed: { transcription_status: "analysis_complete", transcript_lines: [{ id: "l1", arabic: "شلونك" }] },
    extra: {
      "/rest/v1/discover_videos": (request) => {
        if (request.method === "PATCH") return json([], 200);
        if (request.url.includes("transcription_status")) {
          return json({ transcription_status: "analysis_complete", transcript_lines: [{ id: "l1", arabic: "شلونك" }] }, 200);
        }
        return json(aVideo({ transcription_status: "analysis_complete" }), 200);
      },
    },
  }));

  assertEquals(finalStatus(result), "completed");
  assertEquals(result.calls.some((u) => u.includes("rate-video-cefr")), false);
});

Deno.test("process-approved-video starts the analysis again once its worker must be dead", async () => {
  // The first analysis answers nothing and never writes the row: the shape of
  // a worker torn down mid-run. Past the platform's wall clock (5ms here) it is
  // started again, and the second one lands.
  let analyzeCalls = 0;
  const result = await call({ videoId: VIDEO }, backend({
    analyze: () => {
      analyzeCalls++;
      return new Response("gateway timeout", { status: 504 });
    },
    extra: {
      "/rest/v1/discover_videos": (request) => {
        if (request.method !== "GET") return json([{ id: VIDEO }], 200);
        if (request.url.includes("select=engines_used")) return json({ engines_used: null }, 200);
        if (request.url.includes("transcription_status")) {
          return analyzeCalls >= 2
            ? json({ transcription_status: "analysis_complete", transcript_lines: [{ id: "l1", arabic: "شلونك اليوم" }], cultural_context: null, title: "Second try", title_arabic: null }, 200)
            : json({ transcription_status: "processing" }, 200);
        }
        return json(aVideo(), 200);
      },
    },
  }));

  assertEquals(analyzeCalls, 2);
  const final = lastPatchWith(result, "transcription_status");
  assertEquals(final?.transcription_status, "completed");
  assertEquals(final?.title, "Second try");
});

Deno.test("process-approved-video gives up on the analysis after two dead starts", async () => {
  let analyzeCalls = 0;
  const result = await call({ videoId: VIDEO }, backend({
    analyze: () => {
      analyzeCalls++;
      return new Response("gateway timeout", { status: 504 });
    },
  }));

  assertEquals(analyzeCalls, 2);
  assertEquals(finalStatus(result), "failed");
  const error = String(lastPatchWith(result, "transcription_error")?.transcription_error);
  assertStringIncludes(error, "started 2 times");
  assertStringIncludes(error, "Download & Re-transcribe");
});

Deno.test("process-approved-video waits on an analysis that may still be running rather than restarting it", async () => {
  // A resumed run whose analysis was fired seconds ago (well inside the wall
  // clock, which the env sets to a generous value here) must not fire a second
  // one on top of it — it polls the row, and finalises when the result lands.
  const { handler: storage, store } = withCheckpointStore(emptyStorage);
  store.set(`${VIDEO}.pipeline.json`, JSON.stringify(afterAsrCheckpoint({
    analyzeAttempts: 1,
    analyzeFiredAt: new Date().toISOString(),
  })));
  let reads = 0;
  const result = await call({ videoId: VIDEO, resume: true }, backend({
    video: aVideo({ transcription_status: "processing" }),
    storage,
    extra: {
      "/rest/v1/discover_videos": (request) => {
        if (request.method !== "GET") return json([{ id: VIDEO }], 200);
        if (request.url.includes("select=engines_used")) return json({ engines_used: null }, 200);
        if (request.url.includes("transcription_status")) {
          reads++;
          return reads >= 3
            ? json({ transcription_status: "analysis_complete", transcript_lines: [{ id: "l1", arabic: "شلونك اليوم" }], cultural_context: null, title: null, title_arabic: null }, 200)
            : json({ transcription_status: "processing" }, 200);
        }
        return json(aVideo({ transcription_status: "processing" }), 200);
      },
    },
  }), { env: { PIPELINE_ANALYZE_MAX_RUN_MS: "60000" } });

  assertEquals(result.calls.some((u) => u.includes("analyze-gulf-arabic")), false);
  assertEquals(finalStatus(result), "completed");
});

Deno.test("process-approved-video stops when the analysis has recorded its own failure", async () => {
  // A rejected save is written to the row by analyze-gulf-arabic with the
  // reason. The pipeline must not overwrite that with a vaguer message, and
  // must not start the analysis again.
  let analyzeCalls = 0;
  const result = await call({ videoId: VIDEO }, backend({
    analyze: () => {
      analyzeCalls++;
      return new Response("gateway timeout", { status: 504 });
    },
    refreshed: { transcription_status: "failed" },
  }));

  assertEquals(analyzeCalls, 1);
  assertEquals(finalStatus(result), "processing");
});

Deno.test("process-approved-video starts a fresh run's checkpoint over before the engines run", async () => {
  // A checkpoint left by an earlier run — here one that exhausted its
  // analysis starts — must not be what a resume of *this* run finds if the
  // engines die before writing their own.
  const { handler: storage, store } = withCheckpointStore(emptyStorage);
  store.set(`${VIDEO}.pipeline.json`, JSON.stringify(afterAsrCheckpoint({ analyzeAttempts: 3 })));

  // The download is the first paid step after the reset, so what the
  // checkpoint holds when it is asked for is what a death during the engines
  // would leave behind.
  let atDownload: Record<string, unknown> | null = null;
  const result = await call({ videoId: VIDEO }, backend({
    storage,
    download: () => {
      atDownload = storedCheckpoint(store);
      return json({ audioBase64: AUDIO_B64, contentType: "audio/mp4", duration: 31.4 });
    },
  }));

  const early = atDownload as { stage: string; analyzeAttempts: number; asr?: unknown } | null;
  assert(early, "expected the checkpoint to have been rewritten before the download");
  assertEquals(early.stage, "asr");
  assertEquals(early.analyzeAttempts, 0);
  assertEquals(early.asr, undefined);
  assertEquals(finalStatus(result), "completed");
  assertEquals(storedCheckpoint(store)?.stage, "done");
});

// ── Saying where the run got to ──────────────────────────────────────────────
//
// The pipeline runs where nobody can watch it, so "the transcription spins
// forever" is the same report whether the cause is a dead worker, a refused
// stage hop, a slow analysis, or an older copy of the function still being
// served. These pin the notes that tell those apart from the admin page.

Deno.test("process-approved-video says which step it is on, and which build is running", async () => {
  const result = await call({ videoId: VIDEO }, backend());
  const note = progressNote(result);

  assert(note, "expected a progress note on the row");
  assert(typeof note.build === "string" && note.build, "expected the build marker");
  assert(typeof note.at === "string" && note.at, "expected a timestamp");
  // Every stage announces itself, so a stall has a location and not just a
  // duration.
  const steps = result.patches
    .map((p) => (p.engines_used as { pipeline?: { stage?: unknown } } | undefined)?.pipeline?.stage)
    .filter((stage): stage is string => typeof stage === "string");
  assert(steps.includes("asr"), `expected an asr note, got ${steps.join(", ")}`);
  assert(steps.includes("analyze"), `expected an analyze note, got ${steps.join(", ")}`);
  assert(steps.includes("finalize"), `expected a finalize note, got ${steps.join(", ")}`);
});

Deno.test("process-approved-video records that a stage had to run inline", async () => {
  // Running inline is the old, fragile shape — one long task a worker teardown
  // kills silently. A run that falls back to it every time is a run whose
  // stage boundaries are not working, which has to be visible rather than
  // inferred from the symptoms.
  const { handler: storage } = withCheckpointStore(emptyStorage);
  const result = await call({ videoId: VIDEO }, backend({
    storage,
    extra: { "/functions/v1/process-approved-video": () => new Response("nope", { status: 401 }) },
  }));

  const hops = result.patches
    .map((p) => (p.engines_used as { pipeline?: { hop?: unknown } } | undefined)?.pipeline?.hop)
    .filter((hop): hop is string => typeof hop === "string");
  assert(hops.some((h) => h.startsWith("inline")), `expected an inline note, got ${hops.join(", ")}`);
  assertEquals(finalStatus(result), "completed");
});

Deno.test("process-approved-video says why it failed, on the row's progress note too", async () => {
  const result = await call({ videoId: VIDEO }, backend({
    download: () => new Response("gone", { status: 410 }),
  }));

  assertEquals(finalStatus(result), "failed");
  assert(String(progressNote(result)?.note).startsWith("failed:"));
});

// ── An analysis that answers with an error ───────────────────────────────────

Deno.test("process-approved-video stops immediately when the analysis rejects the request", async () => {
  // A 4xx is the analysis saying "this request is wrong" — a bad transcript, a
  // refused auth. It is not running any more and a retry would be rejected the
  // same way, so waiting out the platform's wall clock three times over is
  // pure delay in front of a certain failure.
  let analyzeCalls = 0;
  const result = await call({ videoId: VIDEO }, backend({
    analyze: () => {
      analyzeCalls++;
      return json({ error: "Missing or invalid transcript" }, 400);
    },
  }));

  assertEquals(analyzeCalls, 1);
  assertEquals(finalStatus(result), "failed");
  const error = String(lastPatchWith(result, "transcription_error")?.transcription_error);
  assertStringIncludes(error, "400");
  assertStringIncludes(error, "Missing or invalid transcript");
});

Deno.test("process-approved-video starts the analysis again at once when it fails outright", async () => {
  // A 500 means it finished and broke, rather than that it is still running,
  // so the next start is owed immediately — not after the wall clock the
  // "might still be running" case has to wait out.
  let analyzeCalls = 0;
  const result = await call({ videoId: VIDEO }, backend({
    analyze: () => {
      analyzeCalls++;
      return analyzeCalls === 1
        ? json({ error: "Internal server error" }, 500)
        : json({ success: true, result: aResult() });
    },
  }), { env: { PIPELINE_ANALYZE_MAX_RUN_MS: "600000" } });

  assertEquals(analyzeCalls, 2);
  assertEquals(finalStatus(result), "completed");
});

Deno.test("process-approved-video treats a gateway timeout as the analysis still running", async () => {
  // 504 is the gateway answering on the function's behalf while it works on.
  // Restarting then would run two analyses over the same audio.
  let analyzeCalls = 0;
  const result = await call({ videoId: VIDEO }, backend({
    analyze: () => {
      analyzeCalls++;
      return new Response("gateway timeout", { status: 504 });
    },
    refreshed: {
      transcription_status: "analysis_complete",
      transcript_lines: [{ id: "l1", arabic: "شلونك اليوم" }],
      cultural_context: null,
      title: null,
      title_arabic: null,
    },
  }), { env: { PIPELINE_ANALYZE_MAX_RUN_MS: "600000" } });

  assertEquals(analyzeCalls, 1);
  assertEquals(finalStatus(result), "completed");
});

Deno.test("process-approved-video starts the analysis again when it reports failure in band", async () => {
  // analyze-gulf-arabic reports failure as `success: false` with a 200, which
  // a status check alone would read as a result.
  let analyzeCalls = 0;
  const result = await call({ videoId: VIDEO }, backend({
    analyze: () => {
      analyzeCalls++;
      return analyzeCalls === 1
        ? json({ success: false, error: "the ensemble came back empty" })
        : json({ success: true, result: aResult() });
    },
  }), { env: { PIPELINE_ANALYZE_MAX_RUN_MS: "600000" } });

  assertEquals(analyzeCalls, 2);
  assertEquals(finalStatus(result), "completed");
});

// ── Not waiting on the slowest engine ────────────────────────────────────────

Deno.test("process-approved-video moves on without an engine that will not finish", async () => {
  // Six engines run in parallel and the stage takes the slowest, so one having
  // a bad day used to set the pace for the whole run. The merge downstream
  // arbitrates between whatever it is given, so a straggler is dropped.
  let hungResolved = false;
  const result = await call({ videoId: VIDEO }, {
    ...backend(),
    "api.soniox.com": () =>
      new Promise<Response>((resolve) => {
        setTimeout(() => { hungResolved = true; resolve(json({ id: "never" })); }, 60_000);
      }),
  }, { env: { PIPELINE_ASR_FANOUT_MS: "50" } });

  assertEquals(finalStatus(result), "completed");
  assertEquals(hungResolved, false, "expected the run not to have waited for the hung engine");
  // The transcript still reaches the analysis, from the engines that answered.
  assert(String(bodySentTo(result, "analyze-gulf-arabic").transcript ?? "").length > 0);
});

Deno.test("process-approved-video waits rather than failing when no engine has answered yet", async () => {
  // With nothing in hand there is nothing to move on with, so the deadline
  // must not turn a slow run into "all transcription engines failed".
  const slowly = (body: unknown): UpstreamHandler => () =>
    new Promise<Response>((resolve) => setTimeout(() => resolve(json(body)), 60));

  const result = await call({ videoId: VIDEO }, {
    ...backend(),
    "api.elevenlabs.io": slowly({ text: "شلونك اليوم", words: [] }),
    "api.cohere.com": slowly({ text: "شلونك اليوم" }),
    "api.fanar.qa": slowly({ text: "شلونك اليوم" }),
    "api.munsit.com": slowly({ data: { transcription: "شلونك اليوم" } }),
    "api.soniox.com": slowly({ id: "f", status: "completed", text: "شلونك اليوم", tokens: [] }),
    "cognitiveservices": slowly({ combinedPhrases: [{ text: "شلونك اليوم" }] }),
  }, { env: { PIPELINE_ASR_FANOUT_MS: "1" } });

  assertEquals(finalStatus(result), "completed");
});
