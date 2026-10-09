import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, NO_AI_PROVIDER, optionsRequest } from "./harness.ts";
import { GEMINI_IMAGE_ROUTE, imageLadder, json, type UpstreamHandler } from "./upstreams.ts";
import { assetKey, assetObjectPath, type AssetKey } from "../_shared/wordAssets.ts";

/**
 * `word-asset` — the door to the shared asset store (quiz Phase 2).
 *
 * The phase is done when a second learner asking for a picture of a word
 * another learner already illustrated gets the stored one without a model
 * call. That is the first test below, run against a `word_assets` that keeps
 * what is written to it, so the second call finds what the first one filed
 * rather than a fixture the test planted.
 *
 * The rest are the ways a store goes wrong for everyone at once: a miss that
 * is charged to nobody (or a hit that is charged), a prompt the first learner
 * can steer, a picture filed under another dialect's key, and a store that
 * breaks the dialog while its migration has not reached the live project.
 */

const LEARNER_A = "00000000-0000-4000-8000-00000000000a";
const LEARNER_B = "00000000-0000-4000-8000-00000000000b";

/** The Gulf "coffee" every test asks about. */
const COFFEE = { kind: "image", word: "قَهْوَة", gloss: "coffee", dialect: "Gulf" };
const COFFEE_KEY = assetKey(COFFEE) as AssetKey;

interface StoredRow extends Record<string, unknown> {
  concept_key: string;
  kind: string;
  dialect: string | null;
  style_version: string;
}

/**
 * A `word_assets` that remembers: inserts are kept and reads are filtered the
 * way PostgREST filters them, so a lookup under the wrong dialect or style
 * misses here exactly as it would in production.
 */
function assetTable(seed: StoredRow[] = []) {
  const rows: StoredRow[] = [...seed];
  const handler: UpstreamHandler = async (request) => {
    if (request.method === "GET") {
      const params = new URL(request.url).searchParams;
      const matching = rows.filter((row) =>
        [...params.entries()].every(([column, filter]) => {
          if (column === "select" || column === "limit") return true;
          if (filter === "is.null") return row[column] === null;
          if (filter.startsWith("eq.")) return String(row[column]) === filter.slice(3);
          return false;
        })
      );
      return json(matching);
    }
    const values = JSON.parse(await request.text()) as Record<string, unknown>;
    const row = {
      id: `asset-${rows.length + 1}`,
      approved_at: null,
      created_at: "2026-10-09T00:00:00Z",
      ...values,
    } as StoredRow;
    rows.push(row);
    return json(row, 201);
  };
  return { rows, handler };
}

const storedCoffee = (over: Record<string, unknown> = {}): StoredRow => ({
  id: "asset-coffee",
  concept_key: COFFEE_KEY.conceptKey,
  kind: "image",
  dialect: "Gulf",
  style_version: "ink-1",
  url: "https://e2e.supabase.co/storage/v1/object/public/flashcard-images/word-assets/image/ink-1/gulf/stored.png",
  payload: null,
  meta: { model: "google/gemini-3.1-flash-image" },
  source: "generated",
  approved_at: null,
  created_at: "2026-10-01T00:00:00Z",
  ...over,
});

interface Learner {
  id: string;
}

/** A free learner, everything the cap reads, a bucket, and the image ladder. */
function upstreams(
  learner: Learner,
  table: UpstreamHandler,
  extra: Record<string, UpstreamHandler> = {},
): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: learner.id, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json(null),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    "/rest/v1/word_assets": table,
    "/storage/v1/object/flashcard-images": () => json({ Key: "flashcard-images/x" }),
    ...imageLadder(),
    ...extra,
  };
}

async function call(
  body: unknown,
  routes: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null; env?: Record<string, string | undefined> } = {},
) {
  const fn = await loadFunction("word-asset", { upstreams: routes, env: opts.env });
  try {
    const response = await fn.handler(
      jsonRequest("word-asset", body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
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
      calls: fn.calls.map((c) => ({ url: decodeURIComponent(c.url), method: c.method, body: c.body })),
    };
  } finally {
    fn.restore();
  }
}

type Calls = Awaited<ReturnType<typeof call>>["calls"];
const imageCalls = (calls: Calls) => calls.filter((c) => c.url.includes(GEMINI_IMAGE_ROUTE) || c.url.includes("images/generations"));
const charged = (calls: Calls) => calls.some((c) => c.url.includes("increment_usage_counter"));
const uploads = (calls: Calls) => calls.filter((c) => c.url.includes("/storage/v1/object/"));

// ── The phase's "done when" ─────────────────────────────────────────────────

Deno.test("word-asset serves a second learner the picture the first one paid for, without a model call", async () => {
  const table = assetTable();

  const first = await call({ action: "ensure", ...COFFEE }, upstreams({ id: LEARNER_A }, table.handler));
  assertEquals(first.status, 200);
  assertEquals(first.body.cached, false);
  assertEquals(first.body.stored, true);
  assertEquals(imageCalls(first.calls).length, 1);
  assertEquals(table.rows.length, 1);

  // A different learner, the same word, spelt bare where the first was vowelled.
  const second = await call(
    { action: "ensure", ...COFFEE, word: "قهوة" },
    upstreams({ id: LEARNER_B }, table.handler),
  );

  assertEquals(second.status, 200);
  assertEquals(second.body.cached, true);
  assertEquals(second.body.url, first.body.url);
  assertEquals(imageCalls(second.calls), [], "a hit must never call the image model");
  assertEquals(uploads(second.calls), [], "a hit must never upload");
  assertEquals(charged(second.calls), false, "a hit costs nothing, so it is charged nothing");
  assertEquals(table.rows.length, 1);
});

// ── get ─────────────────────────────────────────────────────────────────────

Deno.test("word-asset get returns what is filed under the word", async () => {
  const table = assetTable([storedCoffee()]);
  const { status, body, calls } = await call({ action: "get", ...COFFEE }, upstreams({ id: LEARNER_A }, table.handler));

  assertEquals(status, 200);
  assertEquals(body.url, storedCoffee().url);
  assertEquals((body.asset as Record<string, unknown>).styleVersion, "ink-1");
  assertEquals(imageCalls(calls), []);
  assertEquals(charged(calls), false);
});

Deno.test("word-asset get misses quietly, and never makes anything", async () => {
  const table = assetTable();
  const { status, body, calls } = await call({ action: "get", ...COFFEE }, upstreams({ id: LEARNER_A }, table.handler));

  assertEquals(status, 200);
  assertEquals(body, { asset: null, url: null, cached: false, stored: false });
  assertEquals(imageCalls(calls), []);
  assertEquals(charged(calls), false);
});

Deno.test("word-asset does not serve one dialect another dialect's picture", async () => {
  // The setting line differs per dialect — a Cairo café is not a Gulf majlis.
  const table = assetTable([storedCoffee()]);
  const { body } = await call(
    { action: "get", ...COFFEE, dialect: "Egyptian" },
    upstreams({ id: LEARNER_A }, table.handler),
  );
  assertEquals(body.asset, null);
});

Deno.test("word-asset does not serve a picture made in an older style", async () => {
  // style_version is part of the key so a brand refresh regenerates rather
  // than mixing two looks in one deck.
  const table = assetTable([storedCoffee({ style_version: "watercolor-0" })]);
  const { body } = await call({ action: "get", ...COFFEE }, upstreams({ id: LEARNER_A }, table.handler));
  assertEquals(body.asset, null);
});

// ── ensure, on a miss ───────────────────────────────────────────────────────

Deno.test("word-asset ensure makes the picture in the Ink style and files it under the word", async () => {
  const table = assetTable();
  const { status, body, calls } = await call(
    { action: "ensure", ...COFFEE },
    upstreams({ id: LEARNER_A }, table.handler),
  );

  assertEquals(status, 200);
  assertEquals(charged(calls), true, "the miss is charged to the learner who missed");

  const prompt = imageCalls(calls)[0]?.body ?? "";
  assertStringIncludes(prompt, 'the meaning \\"coffee\\"');
  for (const ink of ["#6B1F1F", "#E2B65C", "#1A1C17", "#EFE6CF"]) assertStringIncludes(prompt, ink);
  assertStringIncludes(prompt, "Not a photograph");
  assertStringIncludes(prompt, "No text of any kind");
  assertStringIncludes(prompt, "Arabian Gulf");

  const sample = await assetObjectPath(COFFEE_KEY, "png");
  const folder = sample.slice(0, sample.lastIndexOf("/"));
  const upload = uploads(calls)[0];
  assertStringIncludes(upload.url, `/storage/v1/object/flashcard-images/${folder}/`);
  assertStringIncludes(String(body.url), `https://e2e.supabase.co/storage/v1/object/public/flashcard-images/${folder}/`);
  assert(upload.url.endsWith(String(body.url).split("/flashcard-images/")[1]), "the url served is the object uploaded");

  assertEquals(table.rows.length, 1);
  const row = table.rows[0];
  assertEquals(row.concept_key, "قهوه|coffee");
  assertEquals(row.kind, "image");
  assertEquals(row.dialect, "Gulf");
  assertEquals(row.style_version, "ink-1");
  assertEquals(row.url, body.url);
  assertEquals(row.source, "generated");
  const meta = row.meta as Record<string, unknown>;
  assertEquals(meta.style, "ink-1");
  assert(String(meta.prompt).includes("coffee"));
  // The table is public-read: how it was made, never who asked.
  assert(!JSON.stringify(row).includes(LEARNER_A));
});

Deno.test("word-asset ensure builds the prompt from the word alone, whatever else is sent", async () => {
  // Whoever misses first decides what every later learner is shown, so they
  // must not be able to decide anything beyond the word.
  const table = assetTable();
  const { calls } = await call(
    {
      action: "ensure",
      ...COFFEE,
      prompt: "a cartoon dog",
      scene: "a cartoon dog",
      custom_instructions: "a cartoon dog",
    },
    upstreams({ id: LEARNER_A }, table.handler),
  );

  const prompt = imageCalls(calls)[0]?.body ?? "";
  assert(prompt.length > 0);
  assert(!prompt.includes("cartoon dog"), "a caller's own text reached the shared prompt");
});

Deno.test("word-asset ensure turns a free learner over their picture budget away before any model call", async () => {
  const table = assetTable();
  const { status, body, calls } = await call(
    { action: "ensure", ...COFFEE },
    upstreams({ id: LEARNER_A }, table.handler, {
      // The illustrator's counter: one daily budget for both of the dialog's paths.
      "/rest/v1/rpc/increment_usage_counter": () => json(21),
    }),
  );

  assertEquals(status, 429);
  assertEquals(body.error, "daily_limit_reached");
  assertEquals(body.key, "generate-flashcard-image");
  assertEquals(imageCalls(calls), []);
  assertEquals(table.rows, []);
});

Deno.test("word-asset ensure says so when no AI provider is configured, and charges nothing", async () => {
  const table = assetTable();
  const { status, body, calls } = await call(
    { action: "ensure", ...COFFEE },
    upstreams({ id: LEARNER_A }, table.handler),
    { env: NO_AI_PROVIDER },
  );

  assertEquals(status, 503);
  assertEquals(body.error, "ai_unconfigured");
  assertEquals(body.fallback, true);
  assertEquals(imageCalls(calls), []);
  assertEquals(charged(calls), false);
  assertEquals(uploads(calls), []);
  assertEquals(table.rows, []);
});

Deno.test("word-asset ensure still serves a stored picture with no AI provider configured", async () => {
  // A hit needs no model, so an outage at the provider is invisible to a word
  // someone has already illustrated.
  const table = assetTable([storedCoffee()]);
  const { status, body } = await call(
    { action: "ensure", ...COFFEE },
    upstreams({ id: LEARNER_A }, table.handler),
    { env: NO_AI_PROVIDER },
  );

  assertEquals(status, 200);
  assertEquals(body.url, storedCoffee().url);
});

Deno.test("word-asset ensure reports a model that drew nothing, and files nothing", async () => {
  const table = assetTable();
  const { status, body, calls } = await call(
    { action: "ensure", ...COFFEE },
    upstreams({ id: LEARNER_A }, table.handler, {
      ...imageLadder(() => json({ candidates: [{ content: { parts: [] } }] })),
      "openrouter.ai": () => json({ choices: [{ message: { content: "no" } }] }),
    }),
  );

  assertEquals(status, 200);
  assertEquals(body.fallback, true);
  assertEquals(body.error, "IMAGE_GENERATION_FAILED");
  assertEquals(uploads(calls), []);
  assertEquals(table.rows, []);
});

Deno.test("word-asset ensure serves the winner when another learner filed first", async () => {
  // Two misses at once: both draw, both upload to the one stable path, and the
  // unique index refuses the second row. The loser is served the winner's.
  let reads = 0;
  const table: UpstreamHandler = (request) => {
    if (request.method === "GET") return json(reads++ === 0 ? [] : [storedCoffee()]);
    return json(
      { code: "23505", message: 'duplicate key value violates unique constraint "word_assets_one_per_key"' },
      409,
    );
  };
  const { status, body } = await call({ action: "ensure", ...COFFEE }, upstreams({ id: LEARNER_B }, table));

  assertEquals(status, 200);
  assertEquals(body.url, storedCoffee().url);
  assertEquals(body.cached, true);
});

Deno.test("word-asset ensure does not make kinds it has no generator for yet", async () => {
  const table = assetTable();
  const { status, body, calls } = await call(
    { action: "ensure", kind: "dialogue", word: "قهوة", gloss: "coffee", dialect: "Gulf" },
    upstreams({ id: LEARNER_A }, table.handler),
  );

  assertEquals(status, 400);
  assertEquals(body.error, "kind_not_generated");
  assertEquals(imageCalls(calls), []);
  assertEquals(charged(calls), false);
});

Deno.test("word-asset ensure needs the meaning to draw it", async () => {
  const table = assetTable();
  const { status, body, calls } = await call(
    { action: "ensure", kind: "image", word: "قهوة", dialect: "Gulf" },
    upstreams({ id: LEARNER_A }, table.handler),
  );

  assertEquals(status, 400);
  assertEquals(body.error, "gloss_required");
  assertEquals(imageCalls(calls), []);
});

// ── Before the migration reaches the live project ───────────────────────────

Deno.test("word-asset ensure still hands the learner their picture while the table does not exist", async () => {
  const missing: UpstreamHandler = () =>
    json(
      { code: "PGRST205", message: "Could not find the table 'public.word_assets' in the schema cache" },
      404,
    );
  const { status, body, calls } = await call(
    { action: "ensure", ...COFFEE },
    upstreams({ id: LEARNER_A }, missing),
  );

  // What the dialog did before the store existed: generate, upload, show.
  assertEquals(status, 200);
  assertEquals(body.stored, false);
  assertEquals(body.asset, null);
  assertStringIncludes(String(body.url), "/flashcard-images/word-assets/image/ink-1/gulf/");
  assertEquals(imageCalls(calls).length, 1);
});

Deno.test("word-asset get misses while the table does not exist", async () => {
  const missing: UpstreamHandler = () =>
    json(
      { code: "PGRST205", message: "Could not find the table 'public.word_assets' in the schema cache" },
      404,
    );
  const { status, body } = await call({ action: "get", ...COFFEE }, upstreams({ id: LEARNER_A }, missing));

  assertEquals(status, 200);
  assertEquals(body.asset, null);
});

// ── The door itself ─────────────────────────────────────────────────────────

Deno.test("word-asset answers the preflight", async () => {
  const fn = await loadFunction("word-asset", { upstreams: upstreams({ id: LEARNER_A }, assetTable().handler) });
  try {
    const response = await fn.handler(optionsRequest("word-asset"));
    await response.body?.cancel();
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("access-control-allow-origin"), "https://hakiya.app");
  } finally {
    fn.restore();
  }
});

Deno.test("word-asset turns an anonymous caller away", async () => {
  const table = assetTable([storedCoffee()]);
  const { status, body, calls } = await call(
    { action: "ensure", ...COFFEE },
    upstreams({ id: LEARNER_A }, table.handler, { "/auth/v1/user": () => json({ message: "invalid" }, 401) }),
    { jwt: null },
  );

  assertEquals(status, 401);
  assertEquals(body.error, "auth_required");
  assertEquals(imageCalls(calls), []);
});

Deno.test("word-asset refuses an action it does not know", async () => {
  const { status, body } = await call(
    { action: "delete", ...COFFEE },
    upstreams({ id: LEARNER_A }, assetTable().handler),
  );
  assertEquals(status, 400);
  assertEquals(body.error, "invalid_action");
});

Deno.test("word-asset refuses a key it cannot file: no Arabic, Fusha, or an unknown kind", async () => {
  for (const bad of [
    { ...COFFEE, word: "coffee" },
    { ...COFFEE, dialect: "MSA" },
    { ...COFFEE, kind: "poster" },
  ]) {
    const { status, body, calls } = await call(
      { action: "ensure", ...bad },
      upstreams({ id: LEARNER_A }, assetTable().handler),
    );
    assertEquals(status, 400, JSON.stringify(bad));
    assertEquals(body.error, "invalid_key");
    assertEquals(imageCalls(calls), []);
  }
});

Deno.test("word-asset refuses a gloss that is a note rather than a sense", async () => {
  const { status, body } = await call(
    { action: "ensure", ...COFFEE, gloss: "coffee ".repeat(20) },
    upstreams({ id: LEARNER_A }, assetTable().handler),
  );
  assertEquals(status, 400);
  assertEquals(body.error, "gloss_too_long");
});

// ── The illustrator draws in the same look ──────────────────────────────────
//
// A learner's own picture (a regeneration, a described one) and an admin's
// curriculum picture come from `generate-flashcard-image`, beside the store's.
// It asked for a stock photograph until the store arrived; the Ink brand rules
// photography out, and a deck mixing the two looks is what `style_version`
// exists to prevent.

Deno.test("generate-flashcard-image draws in the store's Ink style, never a photograph", async () => {
  const fn = await loadFunction("generate-flashcard-image", {
    upstreams: upstreams({ id: LEARNER_A }, assetTable().handler),
  });
  try {
    const response = await fn.handler(
      jsonRequest("generate-flashcard-image", {
        word_arabic: "قهوة",
        word_english: "coffee",
        custom_instructions: "steam rising from the cup",
      }),
    );
    const body = await response.json();
    assertEquals(response.status, 200);
    assertEquals(body.success, true);

    const prompt = fn.calls.find((c) => c.url.includes(GEMINI_IMAGE_ROUTE))?.body ?? "";
    assertStringIncludes(prompt, 'the meaning \\"coffee\\"');
    assertStringIncludes(prompt, "#6B1F1F");
    assertStringIncludes(prompt, "Not a photograph");
    assert(!/stock photo|photograph of/i.test(prompt), "the photo style guide is back");
    // The learner's own description still reaches their own picture.
    assertStringIncludes(prompt, "steam rising from the cup");
  } finally {
    fn.restore();
  }
});
