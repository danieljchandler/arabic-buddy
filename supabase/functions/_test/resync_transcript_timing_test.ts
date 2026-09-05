import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

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

Deno.test("resync-transcript-timing aligns the lines the editor sent, not the stored ones", async () => {
  // The editor keeps unsaved corrections as a local draft; a re-sync must time
  // the text the reviewer is looking at.
  const draft = [
    { id: "draft-1", arabic: "شلونك اليوم الحمد", translation: "" },
    { id: "draft-2", arabic: "لله بخير", translation: "" },
  ];
  const result = await call({ videoId: VIDEO, lines: draft });
  assertEquals(result.status, 200);
  const lines = result.body.lines as Array<{ id: string; startMs: number; endMs: number }>;
  assertEquals(lines.map((l) => l.id), ["draft-1", "draft-2"]);
  assertEquals(lines[0].startMs, 500);
  assertEquals(lines[1].startMs, 5500);
  assertEquals(result.patches.length, 0);
});

Deno.test("resync-transcript-timing refuses to persist client-sent lines", async () => {
  // Direct writes are of the stored transcript only; client text lands through
  // the audited save_lines path or not at all.
  const result = await call(
    { videoId: VIDEO, persist: true, lines: [{ id: "x", arabic: "شلونك" }] },
    upstreams(),
    SERVICE_ROLE,
  );
  assertEquals(result.status, 400);
  assertEquals(result.body.error, "persist_requires_stored_lines");
  assertEquals(result.patches.length, 0);
});

Deno.test("resync-transcript-timing reports a missing transcript", async () => {
  const result = await call(
    { videoId: VIDEO },
    upstreams({ video: { ...VIDEO_ROW, transcript_lines: [] } }),
  );
  assertEquals(result.status, 400);
  assertEquals(result.body.error, "no_transcript");
});

// ── A transcript that came back as one line ──────────────────────────────────
//
// The shape every uploaded video took while the analysis's merge was being
// cut off mid-answer: its punctuation fallback handed the whole clip back as
// a single line. Re-timing that line is not a fix. With real times on every
// word the speaker's pauses are where the lines should break, and the pieces
// need English of their own, because the parent's described the whole chunk.

const CHUNK_WORDS = [
  "شلونك", "اليوم", "الحمد", "لله", "بخير", "وانت", "شخبارك", "والله", "زين",
  "الحين", "وين", "رايح", "بروح", "السوق", "اشتري", "اغراض", "للبيت", "طيب",
  "الله", "يوفقك",
];

/** The aligner hears the chunk word for word, pausing after the 5th and 12th words. */
function chunkAlignment(): Response {
  const pauses: Record<number, number> = { 5: 1.4, 12: 0.9 };
  let at = 0.5;
  return json({
    words: CHUNK_WORDS.map((text, i) => {
      at += pauses[i] ?? 0.08;
      const start = at;
      at += 0.3;
      return { text, start, end: at, loss: 0.1 };
    }),
  });
}

const CHUNK_ROW = {
  ...VIDEO_ROW,
  dialect: "Kuwaiti",
  dialect_subvariety: null,
  transcript_lines: [{
    id: "line-1",
    arabic: CHUNK_WORDS.join(" "),
    translation: "",
    segmentType: "audio",
    startMs: 0,
    endMs: 9_000,
  }],
};

/** What the translation model answers when asked for the pieces' English. */
const draftedEnglish = () =>
  chatCompletion("", {
    lines: [
      { index: 1, translation: "How are you today, fine thank God", literal: "how-you today the-praise to-God well" },
      { index: 2, translation: "And you, how are you? Fine. Where are you off to now?", literal: "and-you what-news-your by-God fine now where going" },
      { index: 3, translation: "I'm going to the market to buy things for the house, okay, God bless you", literal: "I-go the-market I-buy things for-the-house okay God grant-you-success" },
    ],
  });

/** Routes for the brain's own bookkeeping, which the sinks swallow errors on anyway. */
const brainSinks: Record<string, UpstreamHandler> = {
  "/rest/v1/llm_usage_logs": () => json({}, 201),
  "/rest/v1/feature_metrics": () => json({}, 201),
  "/rest/v1/training_examples": () => json({}, 201),
  "/rest/v1/dialect_rule_violations": () => json({}, 201),
};

Deno.test("resync-transcript-timing breaks a one-line transcript at the speaker's pauses", async () => {
  const result = await call(
    { videoId: VIDEO },
    upstreams({
      video: CHUNK_ROW,
      align: chunkAlignment,
      extra: {
        ...brainSinks,
        "openrouter.ai": draftedEnglish,
        "generativelanguage.googleapis.com": draftedEnglish,
      },
    }),
  );
  assertEquals(result.status, 200);
  const lines = result.body.lines as Array<{
    id: string;
    arabic: string;
    translation: string;
    literal?: string;
    startMs: number;
    endMs: number;
    splitFrom?: string;
    words: Array<{ surface: string; matched: boolean }>;
  }>;

  // Three lines where there was one, cut exactly at the two silences, which
  // are still there between them.
  assertEquals(lines.map((l) => l.arabic), [
    CHUNK_WORDS.slice(0, 5).join(" "),
    CHUNK_WORDS.slice(5, 12).join(" "),
    CHUNK_WORDS.slice(12).join(" "),
  ]);
  assertEquals(lines.map((l) => l.id), ["line-1-1", "line-1-2", "line-1-3"]);
  assert(lines.every((l) => l.splitFrom === "line-1"), "each piece names the line it came from");
  assertEquals(lines[1].startMs - lines[0].endMs, 1_400);
  assertEquals(lines[2].startMs - lines[1].endMs, 900);
  assertEquals(lines[1].words.map((w) => w.surface), CHUNK_WORDS.slice(5, 12));
  assert(lines.every((l) => l.words.every((w) => w.matched)));

  // The pieces come with English of their own rather than blanks.
  assertEquals(lines[0].translation, "How are you today, fine thank God");
  assertEquals(lines[2].literal, "I-go the-market I-buy things for-the-house okay God grant-you-success");
  assertEquals(result.body.splitCount, 1);
  assertEquals(result.body.pieceCount, 3);
  assertEquals(result.body.translated, true);
  assertEquals(result.patches.length, 0);
});

Deno.test("resync-transcript-timing leaves the pieces for review when no model can translate them", async () => {
  // The re-sync is a timing pass first. A translation model that is down
  // costs the pieces their English and says so; it does not cost the re-sync.
  const result = await call(
    { videoId: VIDEO },
    upstreams({
      video: CHUNK_ROW,
      align: chunkAlignment,
      extra: {
        ...brainSinks,
        "openrouter.ai": () => json({ error: "upstream down" }, 500),
        "generativelanguage.googleapis.com": () => json({ error: "upstream down" }, 500),
      },
    }),
  );
  assertEquals(result.status, 200);
  const lines = result.body.lines as Array<{ translation: string; needs_review?: boolean; review_reason?: string }>;
  assertEquals(lines.length, 3);
  for (const line of lines) {
    assertEquals(line.translation, "");
    assertEquals(line.needs_review, true);
    assertEquals(line.review_reason, "empty");
  }
  assertEquals(result.body.translated, false);
});

Deno.test("resync-transcript-timing persists split lines without the response-only provenance", async () => {
  const result = await call(
    { videoId: VIDEO, persist: true },
    upstreams({
      video: CHUNK_ROW,
      align: chunkAlignment,
      extra: {
        ...brainSinks,
        "openrouter.ai": draftedEnglish,
        "generativelanguage.googleapis.com": draftedEnglish,
      },
    }),
    SERVICE_ROLE,
  );
  assertEquals(result.status, 200);
  const patch = result.patches.find((p) => "transcript_lines" in p);
  assert(patch, "expected transcript_lines to be written");
  const stored = patch.transcript_lines as Array<Record<string, unknown>>;
  assertEquals(stored.length, 3);
  assert(stored.every((l) => !("splitFrom" in l)), "splitFrom is for the editor, not the row");
  assertEquals(stored[0].translation, "How are you today, fine thank God");
  // Three new line ids, each logged as new structure under the resync source.
  assert(result.revisionPosts.some((r) => r.field === "structure" && r.line_id === "line-1-2"));
  assert(result.revisionPosts.every((r) => r.source === "resync"));
});

Deno.test("resync-transcript-timing never cuts a line of sensible length", async () => {
  // Two short lines with a 3.4s silence between them, as in the fixture: the
  // pause is between the lines, and neither is over the cap, so nothing moves.
  const result = await call({ videoId: VIDEO }, upstreams({ extra: brainSinks }));
  assertEquals(result.status, 200);
  const lines = result.body.lines as Array<{ id: string; splitFrom?: string }>;
  assertEquals(lines.map((l) => l.id), ["line-1", "line-2"]);
  assertEquals(result.body.splitCount, 0);
  assertEquals(result.body.pieceCount, 0);
  assertEquals(result.body.translated, false);
});
