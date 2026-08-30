import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `resync-transcript-timing` — the forced-alignment pass that locks a
 * transcript's timings to the audio after a reviewer has corrected the text.
 *
 * What carries the feature:
 *
 *   1. The role gate — re-timing rewrites catalogue timings, so it is limited
 *      to the transcript-editor roles (with the service-role bypass for the
 *      backfill job).
 *   2. Preview by default — the editor shows the proposal through its diff
 *      view and persists via transcript-review, so a bare call must write
 *      nothing.
 *   3. `persist: true` writes the lines AND logs the timing diff with source
 *      "resync", because a timing rewrite is still a change to the record.
 *   4. The trust gate — audio that does not fit the transcript must be
 *      refused, not written.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const VIDEO = "44444444-4444-4444-8444-444444444444";
const SERVICE_ROLE = "e2e-service-role-not-a-real-secret";

const STORED_LINES = [
  { id: "line-1", arabic: "شلونك اليوم", translation: "How are you today", startMs: 0, endMs: 3000 },
  { id: "line-2", arabic: "الحمد لله بخير", translation: "Fine, thank God", startMs: 3000, endMs: 6000 },
];

const VIDEO_ROW = {
  id: VIDEO,
  source_url: "https://www.youtube.com/watch?v=abc",
  duration_seconds: 30,
  transcript_lines: STORED_LINES,
};

/** The aligner hears the stored text exactly, with a 3.4s pause mid-way. */
const ALIGNED_WORDS = {
  words: [
    { text: "شلونك", start: 0.5, end: 1.0, loss: 0.1 },
    { text: "اليوم", start: 1.1, end: 1.6, loss: 0.1 },
    { text: "الحمد", start: 5.0, end: 5.4, loss: 0.1 },
    { text: "لله", start: 5.5, end: 5.8, loss: 0.1 },
    { text: "بخير", start: 5.9, end: 6.4, loss: 0.1 },
  ],
};

function upstreams(
  options: {
    role?: string;
    video?: Record<string, unknown> | null;
    storage?: UpstreamHandler;
    align?: UpstreamHandler;
    extra?: Record<string, UpstreamHandler>;
  } = {},
): Record<string, UpstreamHandler> {
  const {
    role = "transcriber",
    video = VIDEO_ROW,
    storage = () =>
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "audio/wav" },
      }),
    align = () => json(ALIGNED_WORDS),
    extra = {},
  } = options;

  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated" }),
    "/rest/v1/user_roles": () => json(role ? [{ role }] : []),
    "/rest/v1/discover_videos": (request) =>
      request.method === "GET" ? json(video) : new Response(null, { status: 204 }),
    "/rest/v1/transcript_line_revisions": () => json(null, 201),
    "/storage/v1": storage,
    "api.elevenlabs.io": align,
    ...extra,
  };
}

interface CallResult {
  status: number;
  body: Record<string, unknown>;
  patches: Record<string, unknown>[];
  revisionPosts: Record<string, unknown>[];
}

async function call(
  body: unknown,
  routes = upstreams(),
  jwt: string | null = "user-jwt",
): Promise<CallResult> {
  const fn = await loadFunction("resync-transcript-timing", { upstreams: routes });
  try {
    const response = await fn.handler(jsonRequest("resync-transcript-timing", body, { jwt }));
    const text = await response.text();
    return {
      status: response.status,
      body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
      patches: fn
        .callsTo("discover_videos")
        .filter((c) => c.method === "PATCH")
        .map((c) => JSON.parse(c.body ?? "{}") as Record<string, unknown>),
      revisionPosts: fn
        .callsTo("transcript_line_revisions")
        .filter((c) => c.method === "POST")
        .flatMap((c) => {
          const parsed = JSON.parse(c.body ?? "null");
          return (Array.isArray(parsed) ? parsed : [parsed]) as Record<string, unknown>[];
        }),
    };
  } finally {
    fn.restore();
  }
}

Deno.test("resync-transcript-timing refuses a caller with no editor role", async () => {
  const result = await call({ videoId: VIDEO }, upstreams({ role: "" }));
  assertEquals(result.status, 403);
});

Deno.test("resync-transcript-timing refuses an unauthenticated caller", async () => {
  const result = await call({ videoId: VIDEO }, upstreams(), null);
  assertEquals(result.status, 401);
});

Deno.test("resync-transcript-timing answers the preflight", async () => {
  const fn = await loadFunction("resync-transcript-timing", { upstreams: upstreams() });
  try {
    const response = await fn.handler(
      new Request("http://localhost/functions/v1/resync-transcript-timing", {
        method: "OPTIONS",
        headers: { origin: "https://hakiya.app" },
      }),
    );
    assertEquals(response.status, 200);
    assert(response.headers.get("access-control-allow-origin"));
  } finally {
    fn.restore();
  }
});

Deno.test("resync-transcript-timing re-times lines from the forced alignment", async () => {
  const result = await call({ videoId: VIDEO });
  assertEquals(result.status, 200);

  const lines = result.body.lines as Array<{
    id: string;
    startMs: number;
    endMs: number;
    words: Array<{ surface: string; matched: boolean }>;
  }>;
  // The stored timings were contiguous guesses; the aligned ones carry the
  // real 3.4-second pause between the greeting and the reply.
  assertEquals(lines[0].startMs, 500);
  assertEquals(lines[0].endMs, 1600);
  assertEquals(lines[1].startMs, 5000);
  assertEquals(lines[1].endMs, 6400);
  assertEquals(lines[0].words.map((w) => w.surface), ["شلونك", "اليوم"]);
  assert(lines.every((l) => l.words.every((w) => w.matched)));
  // Everything else on the line rides along untouched.
  assertEquals(lines[0].id, "line-1");
});

Deno.test("resync-transcript-timing writes nothing unless asked to persist", async () => {
  const result = await call({ videoId: VIDEO });
  assertEquals(result.status, 200);
  assertEquals(result.patches.length, 0);
  assertEquals(result.revisionPosts.length, 0);
});

Deno.test("resync-transcript-timing persists and logs the timing diff as a resync", async () => {
  const result = await call({ videoId: VIDEO, persist: true }, upstreams(), SERVICE_ROLE);
  assertEquals(result.status, 200);
  assertEquals(result.body.saved, true);

  const patch = result.patches.find((p) => "transcript_lines" in p);
  assert(patch, "expected transcript_lines to be written");
  const lines = patch.transcript_lines as Array<{ startMs: number }>;
  assertEquals(lines[1].startMs, 5000);

  // The revision log records what changed and who the change came from — a
  // machine pass, distinguishable from a native speaker's judgement.
  assert(result.revisionPosts.length > 0, "expected timing revisions to be logged");
  assert(result.revisionPosts.every((r) => r.source === "resync"));
  assert(result.revisionPosts.some((r) => r.field === "timing"));
});

Deno.test("resync-transcript-timing refuses audio that does not fit the transcript", async () => {
  // The aligner heard something else entirely — wrong staged file, music, a
  // different clip. Writing those timings would be worse than doing nothing.
  const result = await call(
    { videoId: VIDEO, persist: true },
    upstreams({
      align: () =>
        json({
          words: [
            { text: "مرحبا", start: 0.1, end: 0.5 },
            { text: "بالعالم", start: 0.6, end: 1.0 },
          ],
        }),
    }),
  );
  assertEquals(result.status, 422);
  assertEquals(result.body.error, "alignment_rejected");
  assertEquals(result.patches.length, 0);
});

Deno.test("resync-transcript-timing reports a video with nothing staged and nothing to download", async () => {
  const result = await call(
    { videoId: VIDEO },
    upstreams({
      video: { ...VIDEO_ROW, source_url: null },
      storage: () => json({ error: "Object not found" }, 404),
    }),
  );
  assertEquals(result.status, 409);
  assertEquals(result.body.error, "no_audio");
});

Deno.test("resync-transcript-timing reports a missing transcript", async () => {
  const result = await call(
    { videoId: VIDEO },
    upstreams({ video: { ...VIDEO_ROW, transcript_lines: [] } }),
  );
  assertEquals(result.status, 400);
  assertEquals(result.body.error, "no_transcript");
});
