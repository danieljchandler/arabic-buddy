import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, NO_AI_PROVIDER } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * extract-learner-errors — the mistake-drill feed for open conversation.
 *
 * The contract under test is the filter, not the model: a turn's rows reach
 * learner_errors only for items the tutor corrected, the voice lane records
 * which engine heard the learner, and bad input is refused before any model
 * is paid for.
 */

const USER = "00000000-0000-4000-8000-000000000001";

const corrected = (over: Record<string, unknown> = {}) => ({
  items: [
    {
      produced_arabic: "أريد",
      target_arabic: "أبغى",
      error_kind: "msa_leak",
      corrected_by_assistant: true,
      note: "MSA verb",
    },
    ...((over.extra as unknown[]) ?? []),
  ],
});

function caller(
  inserted: unknown[],
  extra: Record<string, UpstreamHandler> = {},
  answer: unknown = corrected(),
): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/learner_errors": async (request) => {
      inserted.push(await request.json());
      return json({}, 201);
    },
    "/rest/v1/feature_metrics": () => json({}, 201),
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/msa_violations": () => json({}, 201),
    "/rest/v1/dialect_prompts": () => json([]),
    "/rest/v1/dialect_rules": () => json([]),
    // The UTILITY lineup's model is served by Google's OpenAI-compatible
    // route, whose harness default answers plain text with no tool call —
    // askBrain would retry, fall back and 502. Every AI route answers alike.
    "generativelanguage.googleapis.com/v1beta/openai": () => chatCompletion("", answer),
    "ai.gateway.lovable.dev": () => chatCompletion("", answer),
    "openrouter.ai": () => chatCompletion("", answer),
    ...extra,
  };
}

const turn = (over: Record<string, unknown> = {}) => ({
  source: "conversation",
  dialect: "Gulf",
  userText: "أريد ماء",
  assistantText: "[[CORRECTION]] In Gulf Arabic say أبغى\n\nتبي ماي؟",
  correction: "In Gulf Arabic say أبغى",
  ...over,
});

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null; env?: Record<string, string | undefined> } = {},
) {
  const fn = await loadFunction("extract-learner-errors", { upstreams, env: opts.env });
  try {
    const response = await fn.handler(
      jsonRequest("extract-learner-errors", body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
    );
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = { raw: text };
    }
    return { status: response.status, body: parsed, calls: fn.calls };
  } finally {
    fn.restore();
  }
}

Deno.test("extract-learner-errors records what the tutor corrected", async () => {
  const inserted: unknown[] = [];
  const res = await call(turn(), caller(inserted));
  assertEquals(res.status, 200);
  assertEquals(res.body.recorded, 1);
  assertEquals(inserted.length, 1);
  const rows = inserted[0] as Array<Record<string, unknown>>;
  assertEquals(rows[0].source, "conversation");
  assertEquals(rows[0].target_arabic, "أبغى");
  assertEquals(rows[0].produced_arabic, "أريد");
  assertEquals(rows[0].error_kind, "msa_leak");
  assertEquals(rows[0].user_id, USER);
  assertEquals((rows[0].detail as Record<string, unknown>).correction, "In Gulf Arabic say أبغى");
});

Deno.test("extract-learner-errors drops items the tutor did not correct", async () => {
  const inserted: unknown[] = [];
  const answer = {
    items: [
      { produced_arabic: "أريد", target_arabic: "أبغى", error_kind: "msa_leak", corrected_by_assistant: false },
    ],
  };
  const res = await call(turn(), caller(inserted, {}, answer));
  assertEquals(res.status, 200);
  assertEquals(res.body.recorded, 0);
  assertEquals(inserted.length, 0, "nothing reaches learner_errors without a correction");
});

Deno.test("extract-learner-errors voice lane records the engine that heard the learner", async () => {
  const inserted: unknown[] = [];
  const res = await call(
    turn({ source: "voice", correction: undefined, asrProvider: "openai-realtime", userText: "عايز مايه" }),
    caller(inserted),
  );
  assertEquals(res.status, 200);
  const rows = inserted[0] as Array<Record<string, unknown>>;
  assertEquals(rows[0].source, "voice");
  assertEquals((rows[0].detail as Record<string, unknown>).asr_provider, "openai-realtime");
});

Deno.test("extract-learner-errors refuses an unknown source before calling any model", async () => {
  const inserted: unknown[] = [];
  const res = await call(turn({ source: "quiz" }), caller(inserted));
  assertEquals(res.status, 400);
  assert(!res.calls.some((c) => c.url.includes("openrouter.ai") || c.url.includes("gateway")));
  assertEquals(inserted.length, 0);
});

Deno.test("extract-learner-errors refuses an empty turn", async () => {
  const inserted: unknown[] = [];
  const res = await call(turn({ userText: "   " }), caller(inserted));
  assertEquals(res.status, 400);
  assertEquals(inserted.length, 0);
});

Deno.test("extract-learner-errors requires a signed-in learner", async () => {
  const inserted: unknown[] = [];
  const res = await call(turn(), caller(inserted), { jwt: null });
  assert(res.status >= 400, `expected a refusal, got ${res.status}`);
  assertEquals(inserted.length, 0);
});

Deno.test("extract-learner-errors says so when no AI provider is configured", async () => {
  const inserted: unknown[] = [];
  const res = await call(turn(), caller(inserted), { env: NO_AI_PROVIDER });
  assert(res.status >= 500, `expected an upstream failure, got ${res.status}`);
  assertEquals(inserted.length, 0);
});
