import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FIXTURE_ENV, jsonRequest, loadFunction, NO_AI_PROVIDER, optionsRequest } from "./harness.ts";
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
 * A `word_assets` that remembers: inserts are kept, a filtered update changes
 * the one row it matches, and reads are filtered the way PostgREST filters
 * them, so a lookup under the wrong dialect or style misses here exactly as
 * it would in production.
 */
function assetTable(seed: StoredRow[] = []) {
  const rows: StoredRow[] = [...seed];
  const handler: UpstreamHandler = async (request) => {
    const params = new URL(request.url).searchParams;
    const matching = () =>
      rows.filter((row) =>
        [...params.entries()].every(([column, filter]) => {
          if (column === "select" || column === "limit") return true;
          if (filter === "is.null") return row[column] === null;
          if (filter.startsWith("eq.")) return String(row[column]) === filter.slice(3);
          return false;
        })
      );
    if (request.method === "GET") return json(matching());
    if (request.method === "PATCH") {
      // `.update(...).select().maybeSingle()`: one object, or PostgREST's
      // "no rows" when the conditions no longer hold.
      const [row] = matching();
      if (!row) {
        return json(
          { code: "PGRST116", details: "The result contains 0 rows", message: "JSON object requested, multiple (or no) rows returned" },
          406,
        );
      }
      Object.assign(row, JSON.parse(await request.text()) as Record<string, unknown>);
      return json(row);
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

Deno.test("word-asset ensure draws the folded sense, not whatever else the gloss carried", async () => {
  // "house 💀🔥" folds to the key بيت|house, so the skull and the fire are in
  // no key — and must not be in the picture every learner of بيت/house gets.
  const table = assetTable();
  const { status, calls } = await call(
    { action: "ensure", kind: "image", word: "بيت", gloss: "House 💀🔥!!", dialect: "Gulf" },
    upstreams({ id: LEARNER_A }, table.handler),
  );

  assertEquals(status, 200);
  const prompt = imageCalls(calls)[0]?.body ?? "";
  assertStringIncludes(prompt, 'the meaning \\"house\\"');
  assert(!prompt.includes("💀") && !prompt.includes("🔥"), "an emoji the key dropped reached the shared prompt");
  assertEquals(table.rows[0]?.concept_key, "بيت|house");
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
  // No gloss, or one that folds to nothing: either way the key would be the
  // bare word, which is the key a homograph shares.
  for (const gloss of [undefined, "", "💀🔥 !!"]) {
    const table = assetTable();
    const { status, body, calls } = await call(
      { action: "ensure", kind: "image", word: "قهوة", dialect: "Gulf", gloss },
      upstreams({ id: LEARNER_A }, table.handler),
    );

    assertEquals(status, 400, JSON.stringify(gloss));
    assertEquals(body.error, "gloss_required");
    assertEquals(imageCalls(calls), []);
    assertEquals(table.rows, []);
  }
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

// ── The trusted path: an authored scene (quiz Phase 3) ──────────────────────
//
// `scripts/curriculum-pictures.ts` fills the curriculum's pictures from each
// track word's authored `image_scene`, calling with the service-role key. The
// scene is the one thing beyond the word that may reach a shared prompt, so
// what matters is who can send it (the service role and the content team,
// nobody else), who pays (nobody), and what it may take the place of (a
// picture drawn from the gloss alone, and nothing a person has authored,
// reviewed or approved).

const SERVICE_ROLE = FIXTURE_ENV.SUPABASE_SERVICE_ROLE_KEY;
const DALLAH = "a brass dallah pouring into a small finjan";

/** What the service role sees: no learner behind the token, no cap to read. */
function serviceUpstreams(table: UpstreamHandler, extra: Record<string, UpstreamHandler> = {}) {
  return upstreams({ id: "nobody" }, table, {
    "/auth/v1/user": () => json({ message: "invalid JWT" }, 401),
    ...extra,
  });
}

Deno.test("word-asset ensure draws a service-role caller's authored scene, and charges nobody", async () => {
  const table = assetTable();
  const { status, body, calls } = await call(
    { action: "ensure", ...COFFEE, scene: DALLAH },
    serviceUpstreams(table.handler),
    { jwt: SERVICE_ROLE },
  );

  assertEquals(status, 200);
  assertEquals(body.stored, true);
  assertEquals(body.cached, false);
  // What the script checks before it writes a row.
  assertEquals(body.authored, true);

  const prompt = imageCalls(calls)[0]?.body ?? "";
  assertStringIncludes(prompt, `Scene: ${DALLAH}`);
  // Still the store's picture: the sense, the Ink style, the dialect's setting.
  assertStringIncludes(prompt, 'the meaning \\"coffee\\"');
  assertStringIncludes(prompt, "Not a photograph");
  assertStringIncludes(prompt, "Arabian Gulf");

  assertEquals(charged(calls), false, "an authored picture is on nobody's allowance");
  assertEquals(calls.filter((c) => c.url.includes("/auth/v1/user")), [], "the service role is not a learner to look up");

  // Filed as authored, with the scene it was drawn from, under a fresh name.
  assertEquals(table.rows.length, 1);
  assertEquals(table.rows[0].source, "authored");
  assertEquals((table.rows[0].meta as Record<string, unknown>).scene, DALLAH);
  assertStringIncludes(String(body.url), "/flashcard-images/word-assets/image/ink-1/gulf/");
});

/**
 * A `user_roles` that answers the question asked: the cap asks whether the
 * caller is an admin, the role gate whether they are on the content team, and
 * a stub that says yes to both would hide a reviewer being charged.
 */
function rolesHeld(...held: string[]): UpstreamHandler {
  return (request) => {
    const filter = new URL(request.url).searchParams.get("role") ?? "";
    const asked = filter.startsWith("eq.")
      ? [filter.slice(3)]
      : (filter.match(/^in\.\((.*)\)$/)?.[1] ?? "").split(",").map((role) => role.replace(/"/g, ""));
    const rows = held.filter((role) => asked.includes(role)).map((role) => ({ role }));
    // `.maybeSingle()` on a read takes the list and picks the row itself.
    return json(rows);
  };
}

Deno.test("word-asset ensure draws the content team's authored scene, and charges nobody", async () => {
  // A reviewer, not an admin: the cap would count them as it counts a learner.
  const table = assetTable();
  const { status, calls } = await call(
    { action: "ensure", ...COFFEE, scene: DALLAH },
    upstreams({ id: LEARNER_A }, table.handler, { "/rest/v1/user_roles": rolesHeld("content_reviewer") }),
  );

  assertEquals(status, 200);
  assertStringIncludes(imageCalls(calls)[0]?.body ?? "", `Scene: ${DALLAH}`);
  assertEquals(charged(calls), false);
  assertEquals(table.rows[0]?.source, "authored");
});

Deno.test("word-asset ensure still ignores a learner's scene, and charges them as a learner", async () => {
  // Not refused: the dialog of a client that sends one must keep working. The
  // scene is simply not heard, and the role is read from user_roles, never
  // from anything the caller says about themselves.
  const table = assetTable();
  const { status, body, calls } = await call(
    { action: "ensure", ...COFFEE, scene: DALLAH, role: "admin", trusted: true },
    upstreams({ id: LEARNER_A }, table.handler),
  );

  assertEquals(status, 200);
  const prompt = imageCalls(calls)[0]?.body ?? "";
  assert(prompt.length > 0);
  assert(!prompt.includes("dallah"), "a learner's scene reached the shared prompt");
  assert(!prompt.includes("Scene:"));
  assertEquals(charged(calls), true, "a learner's miss is still the learner's to pay for");
  assertEquals(body.authored, undefined, "a picture that ignored the scene must not claim it");
  assertEquals(table.rows[0]?.source, "generated");
  assert(!JSON.stringify(table.rows[0]).includes("dallah"));
});

Deno.test("word-asset ensure charges the content team for a picture with no scene, as it charges a learner", async () => {
  // A reviewer using the picture dialog on a word of their own is a learner.
  const table = assetTable();
  const { status, calls } = await call(
    { action: "ensure", ...COFFEE },
    upstreams({ id: LEARNER_A }, table.handler, { "/rest/v1/user_roles": rolesHeld("content_reviewer") }),
  );

  assertEquals(status, 200);
  assertEquals(charged(calls), true);
  assertEquals(table.rows[0]?.source, "generated");
});

Deno.test("word-asset ensure does not take a recorder or a transcriber for the content team", async () => {
  // `CONTENT_MANAGER_ROLES`: an admin or a content reviewer, nobody else.
  for (const role of ["recorder", "transcriber", "beta_tester", "complimentary"]) {
    const table = assetTable();
    const { calls } = await call(
      { action: "ensure", ...COFFEE, scene: DALLAH },
      upstreams({ id: LEARNER_A }, table.handler, { "/rest/v1/user_roles": rolesHeld(role) }),
    );
    assert(!(imageCalls(calls)[0]?.body ?? "").includes("dallah"), `${role} was heard`);
    assertEquals(table.rows[0]?.source, "generated", role);
    assertEquals(charged(calls), true, `${role} was let off the cap`);
  }
});

Deno.test("word-asset ensure does not take a full stop for a scene", async () => {
  // A scene is what lifts a staff call off the cap and files the picture as
  // authored, which no script replaces afterwards. A token is not a scene.
  for (const scene of [".", "x", "          ", "1234567890123", "a dallah"]) {
    const table = assetTable();
    const { calls } = await call(
      { action: "ensure", ...COFFEE, scene },
      upstreams({ id: LEARNER_A }, table.handler, { "/rest/v1/user_roles": rolesHeld("content_reviewer") }),
    );
    assert(!(imageCalls(calls)[0]?.body ?? "").includes("Scene:"), JSON.stringify(scene));
    assertEquals(charged(calls), true, JSON.stringify(scene));
    assertEquals(table.rows[0]?.source, "generated", JSON.stringify(scene));
  }
});

Deno.test("word-asset ensure lets the content team's scene take the place of a gloss-only picture too", async () => {
  const table = assetTable([storedCoffee()]);
  const { status, body, calls } = await call(
    { action: "ensure", ...COFFEE, scene: DALLAH },
    upstreams({ id: LEARNER_A }, table.handler, { "/rest/v1/user_roles": rolesHeld("admin") }),
  );

  assertEquals(status, 200);
  assertEquals(body.replaced, true);
  assertEquals(charged(calls), false);
  assertEquals(table.rows.length, 1);
  assertEquals(table.rows[0].source, "authored");
  // Who asked is in the function's log, never in the public table.
  assert(!JSON.stringify(table.rows[0]).includes(LEARNER_A));
});

Deno.test("word-asset does not take the publishable key for the service role", async () => {
  // The anon key is a JWT this project signed and ships in the browser bundle.
  const table = assetTable();
  const { status, body, calls } = await call(
    { action: "ensure", ...COFFEE, scene: DALLAH },
    serviceUpstreams(table.handler),
    { jwt: FIXTURE_ENV.SUPABASE_ANON_KEY },
  );

  assertEquals(status, 401);
  assertEquals(body.error, "auth_required");
  assertEquals(imageCalls(calls), []);
  assertEquals(table.rows, []);
});

Deno.test("word-asset ensure lets the service role fill a word that has no authored scene, uncharged", async () => {
  // An imported lesson's word has no scene: it gets the picture a learner's
  // miss would have, filed as generated, so an authored scene can still take
  // its place later.
  const table = assetTable();
  const { status, calls } = await call(
    { action: "ensure", ...COFFEE },
    serviceUpstreams(table.handler),
    { jwt: SERVICE_ROLE },
  );

  assertEquals(status, 200);
  assert(!(imageCalls(calls)[0]?.body ?? "").includes("Scene:"));
  assertEquals(charged(calls), false);
  assertEquals(table.rows[0]?.source, "generated");
});

Deno.test("word-asset ensure puts an authored scene in the place of a picture drawn from the gloss alone", async () => {
  // A learner saved قهوة first, so the key holds whatever "coffee" drew.
  const table = assetTable([storedCoffee()]);
  const before = storedCoffee().url;

  const { status, body, calls } = await call(
    { action: "ensure", ...COFFEE, scene: DALLAH },
    serviceUpstreams(table.handler),
    { jwt: SERVICE_ROLE },
  );

  assertEquals(status, 200);
  assertEquals(body.replaced, true);
  assertEquals(body.cached, false);
  assertEquals(imageCalls(calls).length, 1);
  assertStringIncludes(imageCalls(calls)[0]?.body ?? "", `Scene: ${DALLAH}`);

  // A new object under a name of its own: the old file is neither written
  // over nor deleted, so a learner whose row carries it keeps their picture.
  assertEquals(uploads(calls).length, 1);
  assert(!uploads(calls)[0].url.endsWith("/stored.png"));
  assertEquals(calls.filter((c) => c.method === "DELETE"), []);
  assert(body.url !== before);

  // One row for the key still, pointed at the authored picture.
  assertEquals(table.rows.length, 1);
  assertEquals(table.rows[0].id, "asset-coffee");
  assertEquals(table.rows[0].url, body.url);
  assertEquals(table.rows[0].source, "authored");
  const meta = table.rows[0].meta as Record<string, unknown>;
  assertEquals(meta.scene, DALLAH);
  assertEquals(meta.replaces, before);

  // And it is what the next learner is served, for nothing.
  const next = await call({ action: "ensure", ...COFFEE }, upstreams({ id: LEARNER_B }, table.handler));
  assertEquals(next.body.url, body.url);
  assertEquals(imageCalls(next.calls), []);
  assertEquals(charged(next.calls), false);
});

Deno.test("word-asset ensure never lets a learner replace what is filed", async () => {
  const table = assetTable([storedCoffee()]);
  const { status, body, calls } = await call(
    { action: "ensure", ...COFFEE, scene: "a cartoon dog", replace: true },
    upstreams({ id: LEARNER_A }, table.handler),
  );

  assertEquals(status, 200);
  assertEquals(body.cached, true);
  assertEquals(body.url, storedCoffee().url);
  assertEquals(imageCalls(calls), []);
  assertEquals(uploads(calls), []);
  assertEquals(calls.filter((c) => c.method === "PATCH"), []);
  assertEquals(table.rows[0].url, storedCoffee().url);
});

Deno.test("word-asset ensure leaves an authored, reviewed or approved picture alone, even for the service role", async () => {
  // A second run of the script, an edited scene, or a picture a reviewer
  // passed: each is a hit, and none costs a generation.
  for (const filed of [
    { source: "authored", meta: { scene: DALLAH } },
    { source: "reviewed" },
    { source: "generated", approved_at: "2026-10-08T00:00:00Z" },
  ]) {
    const table = assetTable([storedCoffee(filed)]);
    const { status, body, calls } = await call(
      { action: "ensure", ...COFFEE, scene: "a paper cup of coffee on a desk" },
      serviceUpstreams(table.handler),
      { jwt: SERVICE_ROLE },
    );

    assertEquals(status, 200, JSON.stringify(filed));
    assertEquals(body.cached, true);
    assertEquals(body.url, storedCoffee().url);
    assertEquals(imageCalls(calls), []);
    assertEquals(calls.filter((c) => c.method === "PATCH"), []);
  }
});

Deno.test("word-asset get never draws, whoever asks and whatever is filed", async () => {
  const table = assetTable([storedCoffee()]);
  const { status, body, calls } = await call(
    { action: "get", ...COFFEE, scene: DALLAH },
    serviceUpstreams(table.handler),
    { jwt: SERVICE_ROLE },
  );

  assertEquals(status, 200);
  assertEquals(body.url, storedCoffee().url);
  assertEquals(imageCalls(calls), []);
  assertEquals(table.rows[0].source, "generated");
});

Deno.test("word-asset ensure still authors the picture when a learner files theirs in the same moment", async () => {
  // The lookup missed, the learner's insert landed first, and the unique
  // index refused the script's row. The authored scene takes its place, as it
  // would have had the learner been a second earlier.
  const table = assetTable();
  const racing: UpstreamHandler = (request) => {
    if (request.method === "POST") {
      table.rows.push(storedCoffee());
      return json(
        { code: "23505", message: 'duplicate key value violates unique constraint "word_assets_one_per_key"' },
        409,
      );
    }
    return table.handler(request);
  };
  const { status, body } = await call(
    { action: "ensure", ...COFFEE, scene: DALLAH },
    serviceUpstreams(racing),
    { jwt: SERVICE_ROLE },
  );

  assertEquals(status, 200);
  assertEquals(body.replaced, true);
  assertEquals(table.rows.length, 1);
  assertEquals(table.rows[0].source, "authored");
  assertEquals(table.rows[0].url, body.url);
  assert(body.url !== storedCoffee().url);
});

Deno.test("word-asset ensure serves the reviewer's picture when it is approved mid-replacement", async () => {
  // Read as replaceable, approved before the update landed: the conditional
  // update matches nothing, and what is filed now is what is served.
  // The table decides: its PATCH changes a row only where the update's own
  // filters still match, so an update that forgot to ask "still generated,
  // still unapproved?" would overwrite the reviewer's picture here.
  const table = assetTable([storedCoffee()]);
  let reads = 0;
  const approving: UpstreamHandler = async (request) => {
    const response = await table.handler(request);
    // Approved the moment after the function's first look.
    if (request.method === "GET" && reads++ === 0) table.rows[0].approved_at = "2026-10-09T12:00:00Z";
    assert(request.method !== "POST", "a replacement updates the row; it never inserts a second");
    return response;
  };
  const { status, body } = await call(
    { action: "ensure", ...COFFEE, scene: DALLAH },
    serviceUpstreams(approving),
    { jwt: SERVICE_ROLE },
  );

  assertEquals(status, 200);
  assertEquals(body.cached, true);
  assertEquals(body.replaced, undefined);
  assertEquals(body.url, storedCoffee().url);
  assertEquals(table.rows[0].url, storedCoffee().url);
  assertEquals(table.rows[0].source, "generated");
  assertEquals(table.rows[0].approved_at, "2026-10-09T12:00:00Z");
});

Deno.test("word-asset ensure hands back the authored picture, unfiled, when the replacement itself fails", async () => {
  // The picture was drawn and uploaded; the row could not be pointed at it.
  // The caller still gets what it paid for, told that the store did not keep it.
  const table = assetTable([storedCoffee()]);
  const failing: UpstreamHandler = (request) =>
    request.method === "PATCH" ? json({ code: "57014", message: "canceling statement due to statement timeout" }, 500) : table.handler(request);
  const { status, body } = await call(
    { action: "ensure", ...COFFEE, scene: DALLAH },
    serviceUpstreams(failing),
    { jwt: SERVICE_ROLE },
  );

  assertEquals(status, 200);
  assertEquals(body.stored, false);
  assertEquals(body.authored, true);
  assertStringIncludes(String(body.url), "/flashcard-images/word-assets/image/ink-1/gulf/");
  assertEquals(table.rows[0].url, storedCoffee().url, "what was filed is untouched");
});

Deno.test("word-asset ensure files one authored picture when the script is run twice at once", async () => {
  // Both miss, both draw; the unique index keeps the first and the second is
  // served it. An authored picture does not replace another authored one.
  const table = assetTable();
  const racing: UpstreamHandler = (request) => {
    if (request.method === "POST") {
      table.rows.push(storedCoffee({ source: "authored", url: "https://e2e.supabase.co/first-authored.png" }));
      return json({ code: "23505", message: "duplicate key value violates unique constraint" }, 409);
    }
    return table.handler(request);
  };
  const { status, body, calls } = await call(
    { action: "ensure", ...COFFEE, scene: DALLAH },
    serviceUpstreams(racing),
    { jwt: SERVICE_ROLE },
  );

  assertEquals(status, 200);
  assertEquals(body.url, "https://e2e.supabase.co/first-authored.png");
  assertEquals(body.cached, true);
  assertEquals(calls.filter((c) => c.method === "PATCH"), []);
  assertEquals(table.rows.length, 1);
});

Deno.test("word-asset ensure hands the script its picture while the table does not exist", async () => {
  // Phase 2b not applied yet: nothing can be filed, and the script must still
  // get a url to write onto the curriculum row.
  const missing: UpstreamHandler = () =>
    json(
      { code: "PGRST205", message: "Could not find the table 'public.word_assets' in the schema cache" },
      404,
    );
  const { status, body, calls } = await call(
    { action: "ensure", ...COFFEE, scene: DALLAH },
    serviceUpstreams(missing),
    { jwt: SERVICE_ROLE },
  );

  assertEquals(status, 200);
  assertEquals(body.stored, false);
  assertEquals(body.asset, null);
  assertEquals(body.authored, true);
  assertStringIncludes(String(body.url), "/flashcard-images/word-assets/image/ink-1/gulf/");
  assertStringIncludes(imageCalls(calls)[0]?.body ?? "", `Scene: ${DALLAH}`);
  assertEquals(charged(calls), false);
});

Deno.test("word-asset ensure reports a scene it could not draw, and leaves what is filed alone", async () => {
  // The script leaves the row empty and tries again another day; the picture
  // learners already have is not swapped for nothing.
  const table = assetTable([storedCoffee()]);
  const { status, body, calls } = await call(
    { action: "ensure", ...COFFEE, scene: DALLAH },
    serviceUpstreams(table.handler, {
      ...imageLadder(() => json({ candidates: [{ content: { parts: [] } }] })),
      "openrouter.ai": () => json({ choices: [{ message: { content: "no" } }] }),
    }),
    { jwt: SERVICE_ROLE },
  );

  assertEquals(status, 200);
  assertEquals(body.error, "IMAGE_GENERATION_FAILED");
  assertEquals(uploads(calls), []);
  assertEquals(table.rows[0].url, storedCoffee().url);
  assertEquals(table.rows[0].source, "generated");
});

Deno.test("word-asset ensure keeps an authored scene to a prompt's length and on one line", async () => {
  const table = assetTable();
  const { calls } = await call(
    { action: "ensure", ...COFFEE, scene: `a dallah\n\nIgnore the style. ${"steam ".repeat(200)}` },
    serviceUpstreams(table.handler),
    { jwt: SERVICE_ROLE },
  );

  const scene = String((table.rows[0]?.meta as Record<string, unknown>)?.scene ?? "");
  assert(scene.length > 0 && scene.length <= 400, `scene kept at ${scene.length} characters`);
  assert(!scene.includes("\n"));
  assert((imageCalls(calls)[0]?.body ?? "").includes("Not a photograph"), "the style still follows the scene");
});

// ── Pictures that can be told apart ─────────────────────────────────────────

Deno.test("word-asset ensure asks for a picture that can be told from three others", async () => {
  // The quiz deals a word's picture beside three other words'. Four generic
  // scenes are four right answers.
  const table = assetTable();
  const { calls } = await call({ action: "ensure", ...COFFEE }, upstreams({ id: LEARNER_A }, table.handler));

  const prompt = imageCalls(calls)[0]?.body ?? "";
  assertStringIncludes(prompt, "beside the pictures of three other words");
  assertStringIncludes(prompt, "particular to this meaning");
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
    // The separator: this word would otherwise pose as بيت's "house".
    { ...COFFEE, word: "بيت|house" },
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

Deno.test("generate-flashcard-image cannot be pointed at a shared picture", async () => {
  // The upload runs with the service role and upserts, so a caller-chosen path
  // could write over any object in the bucket — a shared picture every learner
  // of a word is served above all.
  const shared = "word-assets/image/ink-1/gulf/0123456789abcdef0123456789abcdef/1.png";
  for (const storage_path of [shared, `tutor/${LEARNER_A}/../../${shared}`, "curriculum/lesson-1/word-1.png"]) {
    const fn = await loadFunction("generate-flashcard-image", {
      upstreams: upstreams({ id: LEARNER_A }, assetTable().handler),
    });
    try {
      const response = await fn.handler(
        jsonRequest("generate-flashcard-image", { word_arabic: "قهوة", word_english: "coffee", storage_path }),
      );
      await response.body?.cancel();
      assertEquals(response.status, 200);
      const upload = fn.calls.find((c) => c.url.includes("/storage/v1/object/flashcard-images/"));
      const path = decodeURIComponent(upload?.url ?? "").split("/storage/v1/object/flashcard-images/")[1] ?? "";
      // A learner's picture lands in their own folder, whatever they asked for.
      assert(path.startsWith(`tutor/${LEARNER_A}/`), `${storage_path} was written to ${path}`);
      assert(!path.includes(".."));
    } finally {
      fn.restore();
    }
  }
});

Deno.test("generate-flashcard-image keeps a learner's own folder, and the content team's chosen path", async () => {
  const own = `tutor/${LEARNER_A}/upload-1.png`;
  const curriculum = "curriculum/lesson-1/word-1.png";
  const cases: Array<[string, Record<string, UpstreamHandler>, string]> = [
    [own, {}, own],
    // The admin word pages file curriculum pictures by lesson and word.
    [curriculum, { "/rest/v1/user_roles": () => json([{ role: "admin" }]) }, curriculum],
  ];
  for (const [storage_path, extra, expected] of cases) {
    const fn = await loadFunction("generate-flashcard-image", {
      upstreams: upstreams({ id: LEARNER_A }, assetTable().handler, extra),
    });
    try {
      const response = await fn.handler(
        jsonRequest("generate-flashcard-image", { word_arabic: "قهوة", word_english: "coffee", storage_path }),
      );
      await response.body?.cancel();
      const upload = fn.calls.find((c) => c.url.includes("/storage/v1/object/flashcard-images/"));
      assertStringIncludes(decodeURIComponent(upload?.url ?? ""), `/flashcard-images/${expected}`);
    } finally {
      fn.restore();
    }
  }
});

Deno.test("generate-flashcard-image never lets even the content team write into the shared store", async () => {
  // `word-assets/` is filled only by the store's own writers, under names of
  // their own; no caller names a path there.
  const fn = await loadFunction("generate-flashcard-image", {
    upstreams: upstreams({ id: LEARNER_A }, assetTable().handler, {
      "/rest/v1/user_roles": () => json([{ role: "admin" }]),
    }),
  });
  try {
    const response = await fn.handler(
      jsonRequest("generate-flashcard-image", {
        word_arabic: "قهوة",
        word_english: "coffee",
        storage_path: "word-assets/image/ink-1/gulf/x/1.png",
      }),
    );
    await response.body?.cancel();
    const upload = fn.calls.find((c) => c.url.includes("/storage/v1/object/flashcard-images/"));
    assertStringIncludes(decodeURIComponent(upload?.url ?? ""), `/flashcard-images/tutor/${LEARNER_A}/`);
  } finally {
    fn.restore();
  }
});
