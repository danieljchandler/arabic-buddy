import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `transcript-review` — the only write path a native-speaker reviewer has.
 *
 * Three properties carry the feature and each is asserted here:
 *
 *   1. The role gate. A transcriber is an outside contributor, so "no role, no
 *      write" has to hold before anything else is interesting.
 *   2. The revision log records what was *stored*, not what the client claimed
 *      was stored. This is the whole reason the diff is computed server-side —
 *      a client that could supply `previous_value` could make the audit trail
 *      say anything.
 *   3. Signing off on a line snapshots the text being signed off. Without that
 *      a tick outlives the words it approved, which is a false claim that a
 *      native speaker read this exact line.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const VIDEO = "33333333-3333-4333-8333-333333333333";

const STORED_LINES = [
  { id: "line-1", arabic: "شلونك اليوم", translation: "How are you today", startMs: 0, endMs: 1500 },
  { id: "line-2", arabic: "زين الحمدلله", translation: "Fine, thank God", startMs: 1500, endMs: 3000 },
];

const VIDEO_ROW = {
  id: VIDEO,
  dialect: "Kuwaiti",
  transcript_lines: STORED_LINES,
  cultural_context: "A greeting exchange.",
  grammar_points: [],
  vocabulary: [],
};

function upstreams(
  role = "transcriber",
  extra: Record<string, UpstreamHandler> = {},
): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/user_roles": () => json(role ? [{ role }] : []),
    // PostgREST answers a PATCH with 204 and no body at all — and `json(null, 204)`
    // would build a Response with the four characters "null" in it, which the
    // platform refuses outright ("Response with null body status cannot have
    // body"). The function then reports that as a failed save.
    "/rest/v1/discover_videos": (request) =>
      request.method === "GET" ? json(VIDEO_ROW) : new Response(null, { status: 204 }),
    "/rest/v1/transcript_line_revisions": () => json(null, 201),
    "/rest/v1/transcript_line_reviews": () => json(null, 201),
    "/rest/v1/transcript_line_comments": (request) =>
      request.method === "GET" ? json([]) : json({ id: "comment-1" }, 201),
    ...extra,
  };
}

interface CallResult {
  status: number;
  body: Record<string, unknown>;
  posts: (path: string) => Record<string, unknown>[];
  patches: (path: string) => Record<string, unknown>[];
}

async function call(
  body: unknown,
  routes = upstreams(),
  jwt?: string | null,
): Promise<CallResult> {
  const fn = await loadFunction("transcript-review", { upstreams: routes });
  try {
    const response = await fn.handler(jsonRequest("transcript-review", body, { jwt }));
    const text = await response.text();
    const bodiesFor = (path: string, method: string) =>
      fn
        .callsTo(path)
        .filter((c) => c.method === method)
        .flatMap((c) => {
          const parsed = JSON.parse(c.body ?? "null");
          return (Array.isArray(parsed) ? parsed : [parsed]) as Record<string, unknown>[];
        });
    return {
      status: response.status,
      body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
      posts: (path) => bodiesFor(path, "POST"),
      patches: (path) => bodiesFor(path, "PATCH"),
    };
  } finally {
    fn.restore();
  }
}

Deno.test("transcript-review refuses a caller with no reviewer role", async () => {
  const result = await call(
    { action: "save_lines", videoId: VIDEO, lines: STORED_LINES },
    upstreams(""),
  );
  assertEquals(result.status, 403);
});

Deno.test("transcript-review refuses an unauthenticated caller", async () => {
  const result = await call(
    { action: "save_lines", videoId: VIDEO, lines: STORED_LINES },
    upstreams(),
    null,
  );
  assertEquals(result.status, 403);
});

Deno.test("transcript-review admits a transcriber", async () => {
  const result = await call({ action: "save_lines", videoId: VIDEO, lines: STORED_LINES });
  assertEquals(result.status, 200);
});

Deno.test("transcript-review logs an Arabic correction against the stored text", async () => {
  const edited = [
    { ...STORED_LINES[0], arabic: "شخبارك اليوم" },
    STORED_LINES[1],
  ];
  const result = await call({ action: "save_lines", videoId: VIDEO, lines: edited });

  assertEquals(result.status, 200);
  assertEquals(result.body.revisions, 1);

  const logged = result.posts("/rest/v1/transcript_line_revisions");
  assertEquals(logged.length, 1);
  assertEquals(logged[0].field, "arabic");
  assertEquals(logged[0].line_id, "line-1");
  assertEquals(logged[0].previous_value, "شلونك اليوم");
  assertEquals(logged[0].new_value, "شخبارك اليوم");
  assertEquals(logged[0].changed_by, USER);
  assertEquals(logged[0].source, "human");
});

Deno.test("transcript-review ignores a client-supplied previous value", async () => {
  // The client claims the line used to say something else. The log must still
  // describe what was actually in the database — otherwise the audit trail is
  // whatever the person being audited says it is.
  const edited = [
    { ...STORED_LINES[0], arabic: "شخبارك اليوم", previous_value: "fabricated" },
    STORED_LINES[1],
  ];
  const result = await call({
    action: "save_lines",
    videoId: VIDEO,
    lines: edited,
    previous_value: "also fabricated",
  });

  const logged = result.posts("/rest/v1/transcript_line_revisions");
  assertEquals(logged[0].previous_value, "شلونك اليوم");
});

Deno.test("transcript-review records a merge as a structural revision", async () => {
  // mergeSegments keeps the left line's id and drops the right one's, so the
  // log should show line-2 disappearing rather than saying nothing at all.
  const merged = [
    { ...STORED_LINES[0], arabic: "شلونك اليوم زين الحمدلله", endMs: 3000 },
  ];
  const result = await call({ action: "save_lines", videoId: VIDEO, lines: merged });

  const logged = result.posts("/rest/v1/transcript_line_revisions");
  const fields = logged.map((r) => r.field).sort();
  assertEquals(fields, ["arabic", "structure", "timing"]);

  const removal = logged.find((r) => r.field === "structure");
  assertEquals(removal?.line_id, "line-2");
  assertEquals(removal?.new_value, null);
});

Deno.test("transcript-review snapshots the text a reviewer signs off", async () => {
  const result = await call({ action: "set_reviewed", videoId: VIDEO, lineId: "line-2" });

  assertEquals(result.status, 200);
  assertEquals(result.body.reviewed, true);

  const rows = result.posts("/rest/v1/transcript_line_reviews");
  assertEquals(rows.length, 1);
  assertEquals(rows[0].line_id, "line-2");
  assertEquals(rows[0].reviewed_by, USER);
  assertEquals(rows[0].reviewed_arabic, "زين الحمدلله");
  assertEquals(rows[0].reviewed_translation, "Fine, thank God");
});

Deno.test("transcript-review will not sign off a line that is not there", async () => {
  const result = await call({ action: "set_reviewed", videoId: VIDEO, lineId: "line-99" });
  assertEquals(result.status, 404);
});

Deno.test("transcript-review re-translates a line and logs it as machine-made", async () => {
  const routes = upstreams("transcriber", {
    "ai.gateway.lovable.dev": () =>
      chatCompletion("", { translation: "How's it going today?", literal: "what-news-your today" }),
    "openrouter.ai": () =>
      chatCompletion("", { translation: "How's it going today?", literal: "what-news-your today" }),
  });

  const result = await call(
    { action: "retranslate_line", videoId: VIDEO, lineId: "line-1" },
    routes,
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.translation, "How's it going today?");

  const logged = result.posts("/rest/v1/transcript_line_revisions");
  const translation = logged.find((r) => r.field === "translation");
  assert(translation, "the new translation should be logged");
  assertEquals(translation?.previous_value, "How are you today");
  assertEquals(translation?.source, "ai_retranslate");
});

Deno.test("transcript-review stores a comment against its author", async () => {
  const result = await call({
    action: "add_comment",
    videoId: VIDEO,
    lineId: "line-1",
    kind: "suggestion",
    body: "‘How's it going’ reads better here.",
    suggestedTranslation: "How's it going?",
  });

  assertEquals(result.status, 200);
  const rows = result.posts("/rest/v1/transcript_line_comments");
  assertEquals(rows[0].author_id, USER);
  assertEquals(rows[0].kind, "suggestion");
  assertEquals(rows[0].suggested_translation, "How's it going?");
});

Deno.test("transcript-review rejects an empty comment", async () => {
  const result = await call({ action: "add_comment", videoId: VIDEO, body: "   " });
  assertEquals(result.status, 400);
});

Deno.test("transcript-review saves notes and logs only what changed", async () => {
  const result = await call({
    action: "save_notes",
    videoId: VIDEO,
    culturalContext: "A greeting exchange between neighbours.",
    // Unchanged — should not produce a revision row.
    grammarPoints: [],
  });

  assertEquals(result.status, 200);
  assertEquals(result.body.revisions, 1);
  const logged = result.posts("/rest/v1/transcript_line_revisions");
  assertEquals(logged.length, 1);
  assertEquals(logged[0].field, "cultural_context");
  assertEquals(logged[0].line_id, null);
});

Deno.test("transcript-review does not let a reviewer touch other columns", async () => {
  // `published` is the one that matters: a transcriber must not be able to ship
  // a video, and the allow-list in saveNotes is what stops them.
  const result = await call({
    action: "save_notes",
    videoId: VIDEO,
    published: true,
    culturalContext: "Still just a greeting.",
  });

  assertEquals(result.status, 200);
  const writes = result.patches("/rest/v1/discover_videos");
  for (const write of writes) {
    assertEquals("published" in write, false);
  }
});

Deno.test("transcript-review rejects an unknown action", async () => {
  const result = await call({ action: "delete_everything", videoId: VIDEO });
  assertEquals(result.status, 400);
  assertEquals(result.body.error, "unknown_action");
});

Deno.test("transcript-review refuses a body that is not a transcript", async () => {
  const result = await call({ action: "save_lines", videoId: VIDEO, lines: ["not an object"] });

  assertEquals(result.status, 400);
  assertEquals(result.body.error, "invalid_transcript");
});

Deno.test("transcript-review refuses a line with no id", async () => {
  // Nothing could hang a review or a revision on it, so it would be invisible
  // to the audit trail while still being served to learners.
  const result = await call({
    action: "save_lines",
    videoId: VIDEO,
    lines: [{ arabic: "بدون معرف", translation: "no id" }],
  });

  assertEquals(result.status, 400);
});

Deno.test("transcript-review refuses an implausibly long transcript", async () => {
  const lines = Array.from({ length: 5001 }, (_, i) => ({ id: `L${i}`, arabic: "x" }));
  const result = await call({ action: "save_lines", videoId: VIDEO, lines });

  assertEquals(result.status, 400);
});

Deno.test("transcript-review accepts an empty transcript", async () => {
  // Deleting every line is a legitimate thing to do to a bad auto-transcript.
  const result = await call({ action: "save_lines", videoId: VIDEO, lines: [] });

  assertEquals(result.status, 200);
});
