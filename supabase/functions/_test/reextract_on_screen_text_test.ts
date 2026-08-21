import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `reextract-on-screen-text` — reading a video's screen again, after the fact.
 *
 * The first read happens in the admin's browser at upload time, off the file
 * they still have in hand. That leaves two gaps nothing else could close: a
 * video added before the vision pass existed has no screen text at all, and a
 * pass that came back empty — a low-contrast caption, a punchline on a frame
 * the sampler stepped over — leaves a meme whose joke is invisible. By then
 * nobody has the file any more, so this fetches the video back and reads the
 * whole thing rather than a handful of stills.
 *
 * Two paths behind one endpoint: `frames` from a caller that still has the file
 * (the cheap one, through the Lovable gateway), and a download plus a native
 * video read through the Gemini API (the one an admin gets from the video list).
 */

const USER = "00000000-0000-4000-8000-000000000001";
const VIDEO = "22222222-0000-4000-8000-000000000000";
const SERVICE_ROLE = "e2e-service-role-not-a-real-secret";

const aVideo = (over: Record<string, unknown> = {}) => ({
  id: VIDEO,
  source_url: "https://www.tiktok.com/@x/video/123",
  title: "A meme",
  duration_seconds: 12,
  is_meme: true,
  transcript_lines: [],
  cultural_context: "Existing notes about this video.",
  ...over,
});

const OCR = {
  onScreenTextSegments: [
    { text: "لما تصحى بدري", translation: "when you wake up early", startSeconds: 0, endSeconds: 3, confidence: "high" },
  ],
  sceneContext: "One person in bed.",
  culturalContext: "",
  detectedDialectCues: [],
};

/** Gemini's own API shape, which is not the OpenAI one the gateway mimics. */
const geminiReply = (payload: unknown): UpstreamHandler => () =>
  json({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] });

function backend(
  options: {
    video?: Record<string, unknown> | null;
    isAdmin?: boolean;
    download?: UpstreamHandler;
    gemini?: UpstreamHandler;
    gateway?: UpstreamHandler;
    extra?: Record<string, UpstreamHandler>;
  } = {},
): Record<string, UpstreamHandler> {
  const {
    video = aVideo(),
    isAdmin = true,
    download = () => json({
      mediaBase64: btoa("fake mp4"),
      contentType: "video/mp4",
      size: 1024 * 512,
    }),
    gemini = geminiReply(OCR),
    gateway = () => chatCompletion(JSON.stringify(OCR)),
    extra = {},
  } = options;

  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/rpc/is_admin": () => json(isAdmin),
    // A PATCH with no `select()` answers 204, and a 204 may not carry a body —
    // `json({}, 204)` would throw inside the stub and surface as a save failure.
    "/rest/v1/discover_videos": (request) =>
      request.method === "GET" ? json(video) : new Response(null, { status: 204 }),
    "/storage/v1/object/video-audio": () => json({ Key: "video-audio/x" }),
    "/functions/v1/download-media": download,
    "generativelanguage.googleapis.com": gemini,
    "ai.gateway.lovable.dev": gateway,
    ...extra,
  };
}

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null; env?: Record<string, string | undefined> } = {},
) {
  const fn = await loadFunction("reextract-on-screen-text", { upstreams, env: opts.env });
  try {
    const response = await fn.handler(
      jsonRequest("reextract-on-screen-text", body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
    );
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // The status assertion carries the failure.
    }
    return {
      status: response.status,
      body: parsed,
      calls: fn.calls.map((c) => c.url),
      update: JSON.parse(
        fn.calls.find((c) => c.url.includes("discover_videos") && c.method === "PATCH")?.body ?? "{}",
      ) as Record<string, unknown>,
    };
  } finally {
    fn.restore();
  }
}

const aFrame = (seconds: number) => ({ dataUri: btoa("fake jpeg"), timestampSeconds: seconds });

// ── The way in ───────────────────────────────────────────────────────────────

Deno.test("reextract-on-screen-text turns away a caller with no credentials", async () => {
  const { status, calls } = await call({ videoId: VIDEO }, backend(), { jwt: null });

  assertEquals(status, 401);
  assert(!calls.some((url) => url.includes("discover_videos")));
});

Deno.test("reextract-on-screen-text refuses a signed-in learner", async () => {
  const { status, body, calls } = await call({ videoId: VIDEO }, backend({ isAdmin: false }));

  // It rewrites shared content, so it is an admin action even though any
  // learner can see the video it is about.
  assertEquals(status, 403);
  assertStringIncludes(String(body.error), "Admin access required");
  assert(!calls.some((url) => url.includes("generativelanguage")));
});

Deno.test("reextract-on-screen-text lets the pipeline's own service role through", async () => {
  const { status, calls } = await call({ videoId: VIDEO }, backend(), { jwt: SERVICE_ROLE });

  assertEquals(status, 200);
  // No user lookup and no role check: this token IS the role.
  assert(!calls.some((url) => url.includes("/rpc/is_admin")));
});

Deno.test("reextract-on-screen-text needs to be told which video", async () => {
  const { status, body } = await call({}, backend());

  assertEquals(status, 400);
  assertStringIncludes(String(body.error), "videoId is required");
});

Deno.test("reextract-on-screen-text says so when the video is gone", async () => {
  const { status, body } = await call({ videoId: VIDEO }, backend({ video: null }));

  assertEquals(status, 404);
  assertStringIncludes(String(body.error), "not found");
});

// ── Reading the frames a caller still has ────────────────────────────────────

Deno.test("reextract-on-screen-text uses supplied frames instead of downloading", async () => {
  const { status, body, calls } = await call(
    { videoId: VIDEO, frames: [aFrame(0), aFrame(4)] },
    backend(),
  );

  assertEquals(status, 200);
  assertEquals(body.readFrom, "frames");
  // A caller that still holds the file has already paid for the frames; making
  // it download its own video back would be slower and less accurate.
  assert(!calls.some((url) => url.includes("download-media")));
  assert(calls.some((url) => url.includes("ai.gateway.lovable.dev")));
});

// ── Reading the whole video back ─────────────────────────────────────────────

Deno.test("reextract-on-screen-text asks download-media for the pictures", async () => {
  const fn = await loadFunction("reextract-on-screen-text", { upstreams: backend() });
  try {
    await fn.handler(jsonRequest("reextract-on-screen-text", { videoId: VIDEO }));
    const sent = JSON.parse(fn.callsTo("download-media")[0]?.body ?? "{}");
    // The default is audio-only, which is exactly no use to a pass that needs
    // to look at the frames.
    assertEquals(sent.wantVideo, true);
    assertEquals(sent.bypassCache, true);
  } finally {
    fn.restore();
  }
});

Deno.test("reextract-on-screen-text reads the whole video, not sampled stills", async () => {
  const { status, body, calls } = await call({ videoId: VIDEO }, backend());

  assertEquals(status, 200);
  assertEquals(body.readFrom, "video");
  assertEquals(body.onScreenTextCount, 1);
  // Sampled frames are a compromise the browser is stuck with. Given the file,
  // the model watches all of it — which is what catches the caption that only
  // appears between two samples.
  assert(calls.some((url) => url.includes("generativelanguage")));
});

Deno.test("reextract-on-screen-text says plainly when only the audio came back", async () => {
  const { status, body } = await call({ videoId: VIDEO }, backend({
    download: () => json({ mediaBase64: btoa("fake mp3"), contentType: "audio/mpeg", size: 4096 }),
  }));

  // Several of download-media's strategies are audio extractors. Reading a
  // soundtrack for on-screen text would return "no text found" and look like
  // a video with nothing written on it.
  assertEquals(status, 500);
  assertStringIncludes(String(body.error), "Only the audio track");
});

Deno.test("reextract-on-screen-text refuses a video too big to send inline", async () => {
  const { status, body } = await call({ videoId: VIDEO }, backend({
    download: () => json({ mediaBase64: btoa("x"), contentType: "video/mp4", size: 40 * 1024 * 1024 }),
  }));

  assertEquals(status, 500);
  assertStringIncludes(String(body.error), "Re-upload the file");
});

Deno.test("reextract-on-screen-text needs a source to fetch from", async () => {
  const { status, body } = await call({ videoId: VIDEO }, backend({
    video: aVideo({ source_url: null }),
  }));

  assertEquals(status, 400);
  assertStringIncludes(String(body.error), "no source URL");
});

// ── What it writes back ──────────────────────────────────────────────────────

Deno.test("reextract-on-screen-text writes the text to the timeline column", async () => {
  const { update } = await call({ videoId: VIDEO }, backend());

  const timeline = update.visual_timeline as Array<Record<string, unknown>>;
  assertEquals(timeline.length, 1);
  assertEquals(timeline[0].text, "لما تصحى بدري");
  assertEquals(timeline[0].scene, "One person in bed.");
});

Deno.test("reextract-on-screen-text stages the blob the pipeline reads", async () => {
  const { calls } = await call({ videoId: VIDEO }, backend());

  // A later re-run of the transcription reads `<id>.visual.json`, so it has to
  // see the same text this run found rather than the old, emptier answer.
  assert(calls.some((url) => url.includes("video-audio")));
});

Deno.test("reextract-on-screen-text pulls captions back out of the transcript", async () => {
  const { body, update } = await call({ videoId: VIDEO }, backend({
    video: aVideo({
      transcript_lines: [
        { id: "l1", arabic: "شلونك" },
        { id: "l2", arabic: "لما تصحى بدري", source: "on_screen" },
      ],
    }),
  }));

  assertEquals(body.removedTranscriptLines, 1);
  // Leaving it would show the learner the same caption twice — once as screen
  // text and once as a line somebody supposedly said.
  assertEquals((update.transcript_lines as Array<Record<string, unknown>>).map((l) => l.id), ["l1"]);
});

Deno.test("reextract-on-screen-text leaves a clean transcript untouched", async () => {
  const { update } = await call({ videoId: VIDEO }, backend({
    video: aVideo({ transcript_lines: [{ id: "l1", arabic: "شلونك" }] }),
  }));

  assertEquals("transcript_lines" in update, false);
});

Deno.test("reextract-on-screen-text refreshes a meme's cultural notes", async () => {
  const { update } = await call({ videoId: VIDEO }, backend());

  // A meme's meaning IS the text on it, so a re-read that found different text
  // has to correct the notes written from the old read.
  assertStringIncludes(String(update.cultural_context), "لما تصحى بدري");
  assertEquals(update.transcription_error, null);
});

Deno.test("reextract-on-screen-text does not overwrite an ordinary video's notes", async () => {
  const { update } = await call({ videoId: VIDEO }, backend({ video: aVideo({ is_meme: false }) }));

  // On any other video `cultural_context` is what the transcript analysis
  // wrote, and this pass replacing it with a caption summary is a straight loss.
  assertEquals("cultural_context" in update, false);
  assertEquals("transcription_error" in update, false);
  assert(Array.isArray(update.visual_timeline));
});

Deno.test("reextract-on-screen-text flags a meme it still could not read", async () => {
  const { body, update } = await call({ videoId: VIDEO }, backend({
    gemini: geminiReply({ ...OCR, onScreenTextSegments: [] }),
  }));

  assertEquals(body.onScreenTextCount, 0);
  assertStringIncludes(String(update.transcription_error), "no readable on-screen text");
});

Deno.test("reextract-on-screen-text reports a model that answered with prose", async () => {
  const { status, body } = await call({ videoId: VIDEO }, backend({
    gemini: () => json({ candidates: [{ content: { parts: [{ text: "I cannot watch videos." }] } }] }),
  }));

  // Failing beats writing "no text found" into the row, which is a claim about
  // the video rather than a report about the run.
  assertEquals(status, 500);
  assertStringIncludes(String(body.error), "Could not parse");
});

Deno.test("reextract-on-screen-text explains a missing Gemini key", async () => {
  const { status, body } = await call({ videoId: VIDEO }, backend(), {
    env: { GEMINI_API_KEY: undefined },
  });

  assertEquals(status, 500);
  assertStringIncludes(String(body.error), "GEMINI_API_KEY");
});
