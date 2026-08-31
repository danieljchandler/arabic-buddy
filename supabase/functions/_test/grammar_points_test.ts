import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, type UpstreamCall } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `extract-grammar-points`, and what happens to what it paid for.
 *
 * The notes it extracts used to land only in `discover_videos.grammar_points`
 * — a jsonb blob on one row, which the video page renders and nothing else can
 * query. A model call per batch bought exactly one page's worth of text, and
 * `CLAUDE.md`'s rule that *both* writers tagging content with grammar concepts
 * go through `grammarTaxonomy.ts` was only half true.
 *
 * So the assertions worth having are about reuse: the note reaches
 * `curriculum_concepts` under a canonical key, it is linked to the video it
 * came from, and filing it never overwrites what a person curated.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const VIDEO = "cccccccc-0000-4000-8000-000000000000";
const CONCEPT = "dddddddd-0000-4000-8000-000000000000";

const CONCEPTS = "/rest/v1/curriculum_concepts";
const LINKS = "/rest/v1/content_concept_links";
const VIDEOS = "/rest/v1/discover_videos";

/** Two notes: one the taxonomy knows, one it has no home for. */
const extracted = {
  points: [
    {
      title: "Negation with ما",
      explanation: "Gulf negates the verb with ما before it.",
      examples: ["ما أدري"],
    },
    {
      title: "Vocative particles",
      explanation: "يا before a name when addressing someone.",
      examples: ["يا أخوي"],
    },
  ],
};

function backend(over: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/user_roles": () => json([]),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    [VIDEOS]: (request) =>
      request.method === "GET"
        ? json({
          id: VIDEO,
          dialect: "Gulf",
          difficulty: "Intermediate",
          grammar_points: [],
          transcript_lines: [{ arabic: "ما أدري", translation: "I don't know" }],
        })
        // 204 must not carry a body, or `fetch` throws before the function
        // ever sees the result of its own update.
        : new Response(null, { status: 204 }),
    [CONCEPTS]: (request) => (request.method === "GET" ? json([{ id: CONCEPT }]) : json({}, 201)),
    [LINKS]: () => json({}, 201),
    // The function parses `message.content` as JSON — no tool call.
    "generativelanguage.googleapis.com/v1beta/openai": () => chatCompletion(JSON.stringify(extracted)),
    ...over,
  };
}

async function run(
  upstreams: Record<string, UpstreamHandler>,
  body: Record<string, unknown> = { video_id: VIDEO, target_level: "B1", count: 4 },
) {
  const fn = await loadFunction("extract-grammar-points", { upstreams });
  try {
    const response = await fn.handler(jsonRequest("extract-grammar-points", body));
    return {
      status: response.status,
      body: await response.json(),
      calls: fn.calls as UpstreamCall[],
      callsTo: fn.callsTo,
    };
  } finally {
    fn.restore();
  }
}

Deno.test("extract-grammar-points files each note in the shared concept taxonomy", async () => {
  const result = await run(backend());

  assertEquals(result.status, 200);
  assertEquals(result.body.added, 2);

  const written = result.callsTo(CONCEPTS).filter((call) => call.method === "POST");
  assertEquals(written.length, 2, "each fresh note should reach curriculum_concepts");
  for (const call of written) {
    const row = JSON.parse(call.body ?? "{}");
    assertEquals(row.kind, "grammar");
    assertEquals(row.dialect, "Gulf", "the video's dialect, not a default");
  }
});

Deno.test("extract-grammar-points files a known point under its taxonomy key", async () => {
  const result = await run(backend());

  const keys = result.callsTo(CONCEPTS)
    .filter((call) => call.method === "POST")
    .map((call) => JSON.parse(call.body ?? "{}").key);

  // "Negation with ما" is one of the taxonomy's own categories, so it must land
  // on that shared id — this is the whole point of going through
  // `canonicalGrammarKey` rather than slugifying the model's wording. Sharing
  // the key space with `user_concept_mastery` is what lets a drill on negation
  // and a video that teaches it refer to the same thing.
  assert(keys.includes("negation"), `expected a "negation" concept, got ${keys.join(", ")}`);
});

Deno.test("extract-grammar-points still files a point the taxonomy has no home for", async () => {
  const result = await run(backend());

  const keys = result.callsTo(CONCEPTS)
    .filter((call) => call.method === "POST")
    .map((call) => JSON.parse(call.body ?? "{}").key);

  // A genuinely new grammar point becomes a concept under a slug rather than
  // being dropped or mislabelled as one of the six. It will not join to drill
  // mastery, because there are no drills for it — which is true, and better
  // than pretending otherwise.
  assert(
    keys.some((key: string) => key.includes("vocative")),
    `expected the unmatched point to be slugified, got ${keys.join(", ")}`,
  );
});

Deno.test("extract-grammar-points links every filed concept to the video", async () => {
  const result = await run(backend());

  const links = result.callsTo(LINKS).filter((call) => call.method === "POST");
  assertEquals(links.length, 2);
  for (const call of links) {
    const row = JSON.parse(call.body ?? "{}");
    assertEquals(row.content_type, "discover_video");
    assertEquals(row.content_id, VIDEO);
    assertEquals(row.concept_id, CONCEPT);
    assertEquals(row.role, "introduce");
  }
});

Deno.test("extract-grammar-points never overwrites a curated concept", async () => {
  const result = await run(backend());

  // The unique key is (kind, key, dialect) with no CEFR in it, so a plain
  // upsert would let one video's guess at a level — or the model's phrasing of
  // a title — replace what an admin set. `conceptMastery` refuses the same
  // thing for the same reason.
  for (const call of result.callsTo(CONCEPTS).filter((c) => c.method === "POST")) {
    assert(
      call.url.includes("ignore_duplicates=true") || (call.headers.prefer ?? "").includes("ignore-duplicates"),
      `concept writes must not clobber an existing row: ${call.url} / ${call.headers.prefer ?? ""}`,
    );
  }
});

Deno.test("extract-grammar-points returns the concept keys it contributed", async () => {
  const result = await run(backend());

  // The caller can tell the learner their note went somewhere, and a curriculum
  // job can pick the keys up without re-parsing the jsonb.
  assert(Array.isArray(result.body.concept_keys));
  assert(result.body.concept_keys.includes("negation"));
});

Deno.test("extract-grammar-points saves the note even when filing it fails", async () => {
  const result = await run(
    backend({ [CONCEPTS]: () => json({ message: "concepts unavailable" }, 500) }),
  );

  // Reuse is a bonus on top of the note; losing it must not cost the learner
  // the extraction they already paid for.
  assertEquals(result.status, 200);
  assertEquals(result.body.added, 2);
  assertEquals(result.body.concept_keys, []);

  const saved = result.callsTo(VIDEOS).filter((call) => call.method === "PATCH");
  assertEquals(saved.length, 1, "the video should still be updated");
});

Deno.test("extract-grammar-points stores the taxonomy key on the note itself", async () => {
  const result = await run(backend());

  const saved = result.callsTo(VIDEOS).find((call) => call.method === "PATCH");
  assert(saved, "expected the video to be saved");
  const points = JSON.parse(saved.body ?? "{}").grammar_points as Array<Record<string, unknown>>;

  // Stored beside the note so every later reader joins on the same string,
  // instead of re-deriving a key from free text and drifting from the ladder.
  assertEquals(points.length, 2);
  assertEquals(points[0].concept_key, "negation");
});
