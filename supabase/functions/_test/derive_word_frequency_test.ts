import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * derive-word-frequency — the dialect's own word counts, and the ranks the
 * decks take from them.
 *
 * What must hold: nothing runs without the scheduler secret; a caption line
 * that measures as MSA is left out; a reviewed transcript line outweighs a
 * raw caption; a word the corpus says gets its rank written and a word it
 * never says gets none; and the dialect's rows are replaced, not appended.
 */

const CHANNEL = "c0000000-0000-4000-8000-000000000001";
const VIDEO = "d0000000-0000-4000-8000-000000000001";
const DISCOVER = "e0000000-0000-4000-8000-000000000001";
const WORD_COMMON = "a0000000-0000-4000-8000-000000000001";
const WORD_UNSEEN = "a0000000-0000-4000-8000-000000000002";
const WORD_STALE = "a0000000-0000-4000-8000-000000000003";

interface Captured { inserted: unknown[]; deleted: string[]; patched: Array<{ url: string; body: unknown }> }

function caller(cap: Captured, extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/rest/v1/content_channels": () => json([{ id: CHANNEL, dialect: "Gulf", status: "approved" }]),
    "/rest/v1/channel_videos": () => json([{ id: VIDEO, channel_id: CHANNEL }]),
    "/rest/v1/caption_lines": () =>
      json([
        // Dialectal: counted.
        { video_id: VIDEO, text_normalized: "شلونك زين", dialect_score: 0.4 },
        // Reads as MSA: dropped by the dialectness filter.
        { video_id: VIDEO, text_normalized: "نافذة نافذة نافذة", dialect_score: 0 },
      ]),
    "/rest/v1/discover_videos": () =>
      json([{ id: DISCOVER, dialect: "Gulf", transcript_lines: [{ arabic: "زين والله", english: "good" }] }]),
    "/rest/v1/dialect_word_frequency": async (request) => {
      if (request.method === "DELETE") { cap.deleted.push(request.url); return new Response(null, { status: 204 }); }
      if (request.method === "POST") { cap.inserted.push(...(await request.json() as unknown[])); return json({}, 201); }
      return json([]);
    },
    "/rest/v1/vocabulary_words": async (request) => {
      if (request.method === "PATCH") { cap.patched.push({ url: request.url, body: await request.json() }); return new Response(null, { status: 204 }); }
      return json([
        { id: WORD_COMMON, word_arabic: "زَين", frequency_rank: null },
        { id: WORD_UNSEEN, word_arabic: "نافذة", frequency_rank: null },
        // Had a rank once; the corpus no longer says it — the rank must clear.
        { id: WORD_STALE, word_arabic: "قديم", frequency_rank: 5 },
      ]);
    },
    "/rest/v1/set_phrases": async (request) => {
      if (request.method === "PATCH") { cap.patched.push({ url: request.url, body: await request.json() }); return new Response(null, { status: 204 }); }
      return json([]);
    },
    ...extra,
  };
}

async function call(body: unknown, upstreams: Record<string, UpstreamHandler>, opts: { secret?: boolean } = {}) {
  const fn = await loadFunction("derive-word-frequency", { upstreams });
  try {
    const response = await fn.handler(
      jsonRequest("derive-word-frequency", body, {
        jwt: null,
        headers: opts.secret === false ? {} : { "x-frequency-secret": "fixture-frequency-secret" },
      }),
    );
    const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: response.status, body: parsed, calls: fn.calls };
  } finally {
    fn.restore();
  }
}

Deno.test("derive-word-frequency refuses to run without the scheduler secret", async () => {
  const cap: Captured = { inserted: [], deleted: [], patched: [] };
  const res = await call({ dialect: "Gulf" }, caller(cap), { secret: false });
  assertEquals(res.status, 401);
  assertEquals(cap.inserted.length, 0);
  assert(!res.calls.some((c) => c.url.includes("/rest/v1/caption_lines")));
});

Deno.test("derive-word-frequency counts dialectal lines, weights reviewed ones, and replaces the dialect's rows", async () => {
  const cap: Captured = { inserted: [], deleted: [], patched: [] };
  const res = await call({ dialect: "Gulf" }, caller(cap));
  assertEquals(res.status, 200, JSON.stringify(res.body));
  assertEquals(cap.deleted.length, 1, "the dialect's rows are cleared before the new counts land");
  assert(cap.deleted[0].includes("dialect=eq.Gulf"));

  const rows = cap.inserted as Array<Record<string, unknown>>;
  const byToken = Object.fromEntries(rows.map((r) => [r.token as string, r]));
  // زين: one caption (weight 1) + one reviewed line (weight 3), two documents.
  assertEquals(byToken["زين"].count, 4);
  assertEquals(byToken["زين"].doc_count, 2);
  assertEquals(byToken["شلونك"].count, 1);
  // The MSA-scored line never counted.
  assertEquals(byToken["نافذة"], undefined);
  for (const r of rows) assertEquals(r.dialect, "Gulf");
  const report = res.body.Gulf as Record<string, number>;
  assertEquals(report.captionLines, 1);
  assertEquals(report.reviewedLines, 1);
});

Deno.test("derive-word-frequency writes a rank for a word the corpus says, clears a stale one, and leaves the unseen word alone", async () => {
  const cap: Captured = { inserted: [], deleted: [], patched: [] };
  const res = await call({ dialect: "Gulf" }, caller(cap));
  assertEquals(res.status, 200);
  const byId = (id: string) => cap.patched.find((p) => p.url.includes(`id=eq.${id}`));
  assertEquals((byId(WORD_COMMON)?.body as Record<string, unknown>).frequency_rank, 1, "زين is the most frequent token");
  assertEquals((byId(WORD_STALE)?.body as Record<string, unknown>).frequency_rank, null, "a rank the corpus no longer supports is cleared");
  assertEquals(byId(WORD_UNSEEN), undefined, "null to null is not a write");
  assertEquals((res.body.Gulf as Record<string, number>).wordsReranked, 2);
});

Deno.test("derive-word-frequency refuses an unknown dialect", async () => {
  const cap: Captured = { inserted: [], deleted: [], patched: [] };
  const res = await call({ dialect: "Klingon" }, caller(cap));
  assertEquals(res.status, 400);
});

Deno.test("derive-word-frequency reports a storage failure rather than pretending", async () => {
  const cap: Captured = { inserted: [], deleted: [], patched: [] };
  const res = await call({ dialect: "Gulf" }, caller(cap, {
    "/rest/v1/dialect_word_frequency": () => json({ message: "disk full" }, 500),
  }));
  assertEquals(res.status, 500);
  assert(String(res.body.error).length > 0);
});
