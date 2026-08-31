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
      if (request.method !== "GET") return json([], 200);
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
  const fn = await loadFunction("process-approved-video", { upstreams, env: opts.env });
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
    assertEquals(await response.json(), { success: true, message: "Processing started" });

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
  const provenance = lastPatchWith(result, "engines_used")?.engines_used as
    | Record<string, Record<string, unknown>>
    | undefined;

  assert(provenance, "expected engines_used to be written");
  const asr = provenance.asr as Record<string, Record<string, unknown>>;
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
  const asr = (lastPatchWith(result, "engines_used")?.engines_used as
    Record<string, Record<string, Record<string, unknown>>>).asr;

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
      "ai.gateway.lovable.dev": () => new Response("rate limited", { status: 429 }),
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
  let patches = 0;
  const result = await call({ videoId: VIDEO }, backend({
    extra: {
      "/rest/v1/discover_videos": (request) => {
        if (request.method === "GET") {
          if (request.url.includes("select=engines_used")) return json({ engines_used: null });
          if (request.url.includes("transcription_status")) return json({ transcription_status: "processing" });
          return json(aVideo());
        }
        patches += 1;
        // Let "processing", the duration and the provenance through; reject the
        // one that carries the transcript.
        return patches >= 4 && patches < 6
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
