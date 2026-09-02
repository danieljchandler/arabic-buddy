import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * practice-chunk-coach — free-form chunk deployment.
 *
 * The verbatim scorer next door checks reproduction; this checks the skill
 * the chunk deck exists for — deploying the phrase inside the learner's own
 * answer. Two contracts carry it. The grade is DERIVED here, deterministically,
 * from the judgement booleans (a model that assigned its own 0-5 would drift
 * against the exact scorer's bands, and both grade the same production
 * schedule). And a miss lands in learner_errors under chunk_coach while a
 * clean deploy resolves earlier rows — same weak-set loop as every coach.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const AUDIO = btoa("fake answer audio");
const PHRASE = "99999999-0000-4000-8000-000000000000";

const aPhrase = (over: Record<string, unknown> = {}) => ({
  phrase_arabic: "الله يعطيك العافية",
  phrase_english: "may God give you strength",
  scenario_english: "Thanking someone who has been working hard.",
  accepted_variants: ["يعطيك العافية"],
  dialect: "Gulf",
  ...over,
});

const judged = (over: Record<string, unknown> = {}) => ({
  used_chunk: true,
  understandable: true,
  natural: false,
  verdict: "Nicely deployed.",
  natural_rewrite: "تسلم، الله يعطيك العافية على شغلك",
  natural_rewrite_english: "Thanks — may God give you strength for your work",
  tips: [],
  ...over,
});

/** Munsit's transcription envelope. */
const heard = (text: string): UpstreamHandler => () =>
  json({ statusCode: 200, data: { transcription: text } });

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/set_phrases": () => json(aPhrase()),
    "/rest/v1/learner_errors": () => json({}, 201),
    "/rest/v1/feature_metrics": () => json({}, 201),
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/msa_violations": () => json({}, 201),
    "/rest/v1/dialect_prompts": () => json([]),
    "/rest/v1/dialect_rules": () => json([]),
    "api.munsit.com": heard("تسلم الله يعطيك العافية"),
    "ai.gateway.lovable.dev": () => chatCompletion("", judged()),
    // google/* models are served by Google's OpenAI-compatible route since
    // 1550b69, whose harness default answers no tool call — stub it like the rest.
    "generativelanguage.googleapis.com/v1beta/openai": () => chatCompletion("", judged()),
    "openrouter.ai": () => chatCompletion("", judged()),
    ...extra,
  };
}

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null } = {},
) {
  const fn = await loadFunction("practice-chunk-coach", { upstreams });
  try {
    const response = await fn.handler(
      jsonRequest("practice-chunk-coach", body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
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
      calls: fn.calls.map((c) => ({ url: c.url, method: c.method, body: c.body })),
    };
  } finally {
    fn.restore();
  }
}

const anAnswer = (over: Record<string, unknown> = {}) => ({
  audioBase64: AUDIO,
  mimeType: "audio/webm",
  phraseId: PHRASE,
  ...over,
});

Deno.test("practice-chunk-coach grades a clean deployment at 4 and resolves the fossil", async () => {
  const fn = await loadFunction("practice-chunk-coach", { upstreams: caller() });
  try {
    const response = await fn.handler(jsonRequest("practice-chunk-coach", anAnswer()));
    const body = JSON.parse(await response.text()) as Record<string, unknown>;

    assertEquals(response.status, 200);
    assertEquals(body.used_chunk, true);
    assertEquals(body.quality, 4);
    assertEquals(body.natural_rewrite, "تسلم، الله يعطيك العافية على شغلك");

    // A clean deploy clears what earlier attempts recorded — the weak set
    // must decay, not only grow. Fire-and-forget, so poll the live log.
    for (let i = 0; i < 100; i++) {
      const patch = fn.calls.find(
        (c) => c.url.includes("learner_errors") && c.method === "PATCH",
      );
      if (patch) {
        assertStringIncludes(patch.body ?? "", "resolved_at");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("no resolve was issued");
  } finally {
    fn.restore();
  }
});

Deno.test("practice-chunk-coach reserves 5 for an answer with nothing to fix", async () => {
  const { body } = await call(
    anAnswer(),
    caller({
      "ai.gateway.lovable.dev": () => chatCompletion("", judged({ natural: true })),
      "generativelanguage.googleapis.com/v1beta/openai": () => chatCompletion("", judged({ natural: true })),
      "openrouter.ai": () => chatCompletion("", judged({ natural: true })),
    }),
  );

  // Same bands as the exact-match scorer: 4/5 accepted, 5 only for flawless —
  // the two paths grade one production schedule and must not drift.
  assertEquals(body.quality, 5);
});

Deno.test("practice-chunk-coach records a miss under its own source", async () => {
  const fn = await loadFunction("practice-chunk-coach", {
    upstreams: caller({
      "ai.gateway.lovable.dev": () => chatCompletion("", judged({ used_chunk: false })),
      "generativelanguage.googleapis.com/v1beta/openai": () => chatCompletion("", judged({ used_chunk: false })),
      "openrouter.ai": () => chatCompletion("", judged({ used_chunk: false })),
    }),
  });
  try {
    const response = await fn.handler(jsonRequest("practice-chunk-coach", anAnswer()));
    const body = JSON.parse(await response.text()) as Record<string, unknown>;

    assertEquals(body.quality, 1);
    for (let i = 0; i < 100; i++) {
      const insert = fn.calls.find(
        (c) => c.url.includes("learner_errors") && c.method === "POST",
      );
      if (insert) {
        assertStringIncludes(insert.body ?? "", "chunk_coach");
        assertStringIncludes(insert.body ?? "", "الله يعطيك العافية");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("the miss was never recorded");
  } finally {
    fn.restore();
  }
});

Deno.test("practice-chunk-coach grades an incomprehensible use at 2", async () => {
  const { body } = await call(
    anAnswer(),
    caller({
      "ai.gateway.lovable.dev": () => chatCompletion("", judged({ understandable: false })),
      "generativelanguage.googleapis.com/v1beta/openai": () => chatCompletion("", judged({ understandable: false })),
      "openrouter.ai": () => chatCompletion("", judged({ understandable: false })),
    }),
  );

  // The chunk appeared but the sentence around it didn't communicate: a
  // repeat-soon grade, not an accept and not a bottom-of-scale fail.
  assertEquals(body.quality, 2);
});

Deno.test("practice-chunk-coach reports silence rather than judging it", async () => {
  const { status, body, calls } = await call(
    anAnswer(),
    caller({ "api.munsit.com": heard("") }),
  );

  assertEquals(status, 200);
  assertEquals(body.empty, true);
  // Silence judged as "didn't use the chunk" would grade a mic problem as a
  // language failure.
  assert(!calls.some((c) => c.url.includes("gateway") || c.url.includes("openrouter")));
});

Deno.test("practice-chunk-coach looks the phrase up before spending on ASR", async () => {
  const { status, body, calls } = await call(
    anAnswer(),
    caller({ "/rest/v1/set_phrases": () => json(null) }),
  );

  assertEquals(status, 500);
  assertStringIncludes(String(body.error), "phrase not found");
  assert(!calls.some((c) => c.url.includes("api.munsit.com")));
});

Deno.test("practice-chunk-coach coaches an anonymous caller without recording anything", async () => {
  const { status, body, calls } = await call(anAnswer(), caller(), { jwt: null });

  // The practice page is public; the coach works under the IP cap. But there
  // is no account to file errors for — recording under a synthetic id would
  // poison nobody's profile, and resolving would touch nothing, so neither
  // write should even be attempted.
  assertEquals(status, 200);
  assertEquals(body.quality, 4);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert(
    !calls.some(
      (c) => c.url.includes("learner_errors") && (c.method === "POST" || c.method === "PATCH"),
    ),
  );
});

Deno.test("practice-chunk-coach refuses a request missing either half", async () => {
  for (const body of [{ phraseId: PHRASE }, { audioBase64: AUDIO }]) {
    const { status, calls } = await call(body, caller());
    assertEquals(status, 400);
    assert(!calls.some((c) => c.url.includes("api.munsit.com")));
  }
});
