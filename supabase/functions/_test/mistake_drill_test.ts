import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * mistake-drill — the fossilization drills.
 *
 * Two contracts carry the feature. The choice items must put the learner's
 * OWN recorded production next to the correct form — that juxtaposition is
 * the whole salience mechanism, and a drill built only from model-invented
 * distractors would be a generic quiz wearing the feature's name. And
 * resolution must require production: picking the right answer changes
 * nothing in learner_errors; typing the target correctly clears it, typing
 * it wrong again records a fresh mistake_drill row.
 */

const USER = "00000000-0000-4000-8000-000000000001";

const unresolvedErrors = [
  // The same target twice — the drill must group, not repeat.
  { target_arabic: "وش رايك", produced_arabic: "ماذا رأيك", error_kind: "msa_leak" },
  { target_arabic: "وش رايك", produced_arabic: "ماذا رأيك", error_kind: "msa_leak" },
  { target_arabic: "بكرة", produced_arabic: null, error_kind: "omission" },
];

const generated = {
  targets: [
    {
      target_arabic: "وش رايك",
      target_english: "what do you think",
      scenario_english: "A friend suggests a plan and waits for your opinion.",
      explanation: "Gulf speakers say وش رايك — ماذا رأيك is MSA.",
      distractor_arabic: "شو رايك",
    },
    {
      target_arabic: "بكرة",
      target_english: "tomorrow",
      scenario_english: "Agreeing to meet the next day.",
      explanation: "بكرة is the everyday Gulf word for tomorrow.",
      distractor_arabic: "غدا",
    },
  ],
};

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/learner_errors": (request) =>
      request.method === "GET" ? json(unresolvedErrors) : json({}, 201),
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/msa_violations": () => json({}, 201),
    "/rest/v1/feature_metrics": () => json({}, 201),
    "/rest/v1/dialect_prompts": () => json([]),
    "/rest/v1/dialect_rules": () => json([]),
    "ai.gateway.lovable.dev": () => chatCompletion("", generated),
    "openrouter.ai": () => chatCompletion("", generated),
    ...extra,
  };
}

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null } = {},
) {
  const fn = await loadFunction("mistake-drill", { upstreams });
  try {
    const response = await fn.handler(
      jsonRequest("mistake-drill", body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
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

interface Item {
  target_arabic: string;
  scenario_english: string;
  explanation: string;
  count: number;
  choices: Array<{ arabic: string; correct: boolean; yours?: boolean }>;
}

Deno.test("mistake-drill builds choice items from the learner's own error corpus", async () => {
  const { status, body } = await call({ action: "items", dialect: "Gulf" }, caller());

  assertEquals(status, 200);
  const items = body.items as Item[];
  assertEquals(items.length, 2);

  const first = items.find((i) => i.target_arabic === "وش رايك");
  assert(first, "the grouped target is missing");
  // Two rows, one card — a fossil missed twice is one problem, not two.
  assertEquals(first.count, 2);
  assertEquals(first.scenario_english, "A friend suggests a plan and waits for your opinion.");
  assertEquals(first.choices.filter((c) => c.correct).length, 1);
  // The learner's own production sits among the choices, marked as theirs.
  const own = first.choices.find((c) => c.yours);
  assertEquals(own?.arabic, "ماذا رأيك");
  assertEquals(own?.correct, false);
});

Deno.test("mistake-drill still drills a target that has no recorded production", async () => {
  const { body } = await call({ action: "items", dialect: "Gulf" }, caller());

  const items = body.items as Item[];
  const bukra = items.find((i) => i.target_arabic === "بكرة");
  assert(bukra, "the production-less target is missing");
  // Quiz-sourced errors carry no utterance; the model's distractor stands in.
  assertEquals(bukra.choices.length, 2);
  assert(bukra.choices.some((c) => c.arabic === "غدا" && !c.correct));
});

Deno.test("mistake-drill answers an empty corpus with an empty session", async () => {
  const { status, body, calls } = await call(
    { action: "items", dialect: "Gulf" },
    caller({ "/rest/v1/learner_errors": () => json([]) }),
  );

  assertEquals(status, 200);
  assertEquals(body.items, []);
  // Nothing to drill costs no model call.
  assert(!calls.some((c) => c.url.includes("gateway") || c.url.includes("openrouter")));
});

Deno.test("mistake-drill resolves the fossil only on a clean production", async () => {
  const { status, body, calls } = await call(
    { action: "produce", dialect: "Gulf", targetArabic: "وش رايك", produced: "وش رايك" },
    caller(),
  );

  assertEquals(status, 200);
  assertEquals(body.accepted, true);
  const patch = calls.find(
    (c) => c.url.includes("learner_errors") && c.method === "PATCH",
  );
  assert(patch, "a clean production must resolve the recorded errors");
  assertStringIncludes(patch.body ?? "", "resolved_at");
  assertStringIncludes(patch.url, "resolved_at=is.null");
});

Deno.test("mistake-drill accepts spelling variants a speaker cannot hear", async () => {
  const { body } = await call(
    // Target with hamza seat; production without. Same mouth, different pen.
    { action: "produce", dialect: "Gulf", targetArabic: "أنا رايح", produced: "انا رايح" },
    caller(),
  );

  assertEquals(body.accepted, true);
});

Deno.test("mistake-drill records a failed production as a fresh mistake", async () => {
  const { status, body, calls } = await call(
    { action: "produce", dialect: "Gulf", targetArabic: "وش رايك", produced: "ماذا رأيك" },
    caller(),
  );

  assertEquals(status, 200);
  assertEquals(body.accepted, false);
  // Not resolved…
  assert(!calls.some((c) => c.url.includes("learner_errors") && c.method === "PATCH"));
  // …and the persistence is itself recorded, under the drill's own source.
  const insert = calls.find(
    (c) => c.url.includes("learner_errors") && c.method === "POST",
  );
  assert(insert, "a failed production must be recorded");
  assertStringIncludes(insert.body ?? "", "mistake_drill");
});

Deno.test("mistake-drill refuses a produce call missing either half", async () => {
  for (const body of [
    { action: "produce", targetArabic: "وش رايك" },
    { action: "produce", produced: "وش رايك" },
  ]) {
    const { status } = await call({ dialect: "Gulf", ...body }, caller());
    assertEquals(status, 400);
  }
});

Deno.test("mistake-drill requires a signed-in caller", async () => {
  const { status, calls } = await call({ action: "items", dialect: "Gulf" }, caller(), {
    jwt: null,
  });

  // The drill reads and writes the caller's own error corpus under the
  // service role; anonymous access would be someone else's fossils.
  assertEquals(status, 401);
  assert(!calls.some((c) => c.url.includes("learner_errors") && c.method !== "GET"));
});
