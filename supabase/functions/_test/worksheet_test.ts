import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `generate-worksheet` — a printable worksheet from the learner's own deck
 * (build plan L3; the page is /print/worksheet).
 *
 * What must hold: no spec for an anonymous caller or for a deck too thin to
 * build one from, both before a model call is spent; the words come from the
 * learner's SRS state on the server; the model's draft is validated (zod)
 * before anything trusts it; "spot the Fusha" is kept out of the repair pass,
 * so the deliberate MSA survives and its answers come from the leak detector;
 * and a vendor refusing the bill reaches the page as a status with a message.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const PAST = "2026-01-01T00:00:00.000Z";

const WORDS: Array<[string, string]> = [
  ["الحين", "now"],
  ["بكره", "tomorrow"],
  ["قهوه", "coffee"],
  ["شبعان", "full"],
  ["وين", "where"],
  ["ابي", "I want"],
];

const vocabRows = (n: number) =>
  WORDS.slice(0, n).map(([word_arabic, word_english], i) => ({
    word_arabic,
    word_english,
    interval_days: 1,
    repetitions: 2,
    lapses: i % 2 === 0 ? 3 : 0,
    is_leech: false,
    next_review_at: PAST,
  }));

const draft = {
  title_arabic: "كَلِمَاتِي",
  title_english: "My words",
  cloze: [
    { sentence: "وين رايح ___؟", answer: "الحين", english: "Where are you going now?" },
    { sentence: "بتصل فيك ___ ان شاء الله", answer: "بكره", english: "I'll call you tomorrow, God willing." },
    { sentence: "ما ابي شي، انا ___", answer: "شبعان", english: "I don't want anything, I'm full." },
  ],
  dialogue: {
    setting_english: "At a coffee shop",
    lines: [
      { speaker: "A", text: "شلونك؟", answer: "", english: "How are you?" },
      { speaker: "B", text: "زين، ___ قهوه", answer: "ابي", english: "Fine, I want a coffee." },
      { speaker: "A", text: "وانا بعد", answer: null, english: "Me too." },
    ],
  },
  writing: {
    prompt_english: "Text a friend asking where they are going and what they want to eat.",
    prompt_arabic: "وين رايح الحين؟ وش تبي تاكل؟",
  },
  spot_the_fusha: [
    { arabic: "سوف أتصل بك غدا", english: "I'll call you tomorrow.", fusha_word: "سوف" },
    { arabic: "وبعد ابي قهوه", english: "And I want a coffee too.", fusha_word: "" },
    { arabic: "الرجل الذي شفته امس", english: "The man I saw yesterday.", fusha_word: "الذي" },
    { arabic: "وين رايح الحين؟", english: "Where are you going now?", fusha_word: null },
  ],
};

const MODEL_HOSTS = ["generativelanguage.googleapis.com/v1beta/openai", "openrouter.ai"];

const emitting = (payload: unknown): Record<string, UpstreamHandler> =>
  Object.fromEntries(MODEL_HOSTS.map((h) => [h, () => chatCompletion("", payload)]));

function upstreams(opts: { words?: number; payload?: unknown } = {}, extra: Record<string, UpstreamHandler> = {}) {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: false }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    "/rest/v1/dialect_prompts": () => json([]),
    "/rest/v1/dialect_rules": () => json([]),
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/msa_violations": () => json({}, 201),
    "/rest/v1/feature_metrics": () => json({}, 201),
    "/rest/v1/training_examples": () => json({}, 201),
    "/rest/v1/user_vocabulary": () => json(vocabRows(opts.words ?? WORDS.length)),
    "/rest/v1/word_reviews": () => json([]),
    "/rest/v1/profiles": () => json(null),
    "/rest/v1/learner_errors": () => json([]),
    "/rest/v1/user_concept_mastery": () => json([]),
    "/rest/v1/user_set_phrases": () => json([]),
    ...emitting(opts.payload ?? draft),
    ...extra,
  };
}

async function call(routes: Record<string, UpstreamHandler>, opts: { jwt?: string | null } = {}) {
  const fn = await loadFunction("generate-worksheet", { upstreams: routes });
  try {
    const response = await fn.handler(jsonRequest("generate-worksheet", { dialect: "Gulf" }, { jwt: opts.jwt }));
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const modelCalls = MODEL_HOSTS.flatMap((h) => fn.callsTo(h));
    return { status: response.status, body, modelCalls };
  } finally {
    fn.restore();
  }
}

Deno.test("generate-worksheet refuses an anonymous caller before any model call", async () => {
  const res = await call(upstreams(), { jwt: null });
  assertEquals(res.status, 401);
  assertEquals(res.modelCalls.length, 0);
});

Deno.test("generate-worksheet says so when the deck is too thin, without a model call", async () => {
  const res = await call(upstreams({ words: 3 }));
  assertEquals(res.status, 422);
  assertEquals(res.body.error, "not_enough_words");
  assert(String(res.body.message).includes("at least 4"));
  assertEquals(res.modelCalls.length, 0);
});

Deno.test("generate-worksheet builds the spec from the learner's words, with the key from the detector", async () => {
  const res = await call(upstreams());
  assertEquals(res.status, 200, JSON.stringify(res.body));
  const spec = res.body.spec as {
    dialect: string;
    title: { arabic: string };
    sections: Array<Record<string, unknown>>;
    dropped: string[];
  };
  assertEquals(spec.dialect, "Gulf");
  assertEquals(spec.title.arabic, "كَلِمَاتِي");
  assertEquals(spec.sections.map((s) => s.kind), ["matching", "cloze", "dialogue", "spot_the_fusha", "writing"]);
  assertEquals(spec.dropped, []);

  // The prompt carried the learner's own words.
  const prompt = res.modelCalls[0].body ?? "";
  for (const [arabic] of WORDS) assert(prompt.includes(arabic), `prompt is missing ${arabic}`);

  // One model call: the deliberate MSA in "spot the Fusha" did not trigger a repair pass.
  assertEquals(res.modelCalls.length, 1);
  const spot = spec.sections.find((s) => s.kind === "spot_the_fusha") as { items: Array<{ fusha_words: string[] }> };
  assertEquals(spot.items.length, 4);
  assert(spot.items[0].fusha_words.includes("سوف"));
  assertEquals(spot.items[1].fusha_words, []);
  assert(spot.items[2].fusha_words.includes("الذي"));
});

Deno.test("generate-worksheet rejects a draft that fails validation", async () => {
  const res = await call(upstreams({ payload: { ...draft, cloze: [draft.cloze[0]] } }));
  assertEquals(res.status, 502);
  assertEquals(res.body.error, "bad_draft");
  assert(Array.isArray(res.body.issues) && (res.body.issues as string[]).some((i) => i.startsWith("cloze")));
});

Deno.test("generate-worksheet passes a vendor's 402 through with a message", async () => {
  const res = await call(
    upstreams({}, {
      "generativelanguage.googleapis.com/v1beta/openai": () => json({ error: "no credits" }, 402),
      "openrouter.ai": () => json({ error: "no credits" }, 402),
    }),
  );
  assertEquals(res.status, 402);
  assertEquals(res.body.error, "no_credit");
  assert(typeof res.body.message === "string");
});
