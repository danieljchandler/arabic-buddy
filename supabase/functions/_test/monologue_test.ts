import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * score-monologue — free speech in, utterance-fluency measures out.
 *
 * The substance is the degradation ladder. Soniox is the only engine that
 * returns word timings, and the timings are the entire point: without them
 * there is no speech rate, no pause inventory, nothing to chart. But a
 * learner who just spoke for two minutes must still get their transcript when
 * Soniox is down, so the function falls back to Munsit and says plainly that
 * this attempt carries no timing metrics — rather than fabricating zeros that
 * would chart as a fluency collapse.
 *
 * The attempt row is the other output: no Arabic fluency norms exist, so the
 * stored raw metrics are the corpus future banding is derived from. A failed
 * write logs and returns the scoring anyway — but a successful one has to
 * carry the caller's own user id, because the whole table is written under
 * the service role.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const AUDIO = btoa("fake monologue audio");
const ATTEMPT_ID = "22222222-0000-4000-8000-000000000000";

/**
 * Three words over three seconds — [مرحبا شباب] 0.5s pause [اليوم] — as
 * Soniox sub-word tokens. Word one arrives split in two, so the merge is
 * exercised, not just passed through.
 */
const SONIOX_TOKENS = [
  { text: "مر", start_ms: 500, end_ms: 800 },
  { text: "حبا", start_ms: 800, end_ms: 1000 },
  { text: " شباب", start_ms: 1100, end_ms: 1500 },
  { text: " اليوم", start_ms: 2000, end_ms: 2400 },
];

const sonioxRoutes: UpstreamHandler = (request) => {
  const path = new URL(request.url).pathname;
  if (path.endsWith("/files")) return json({ id: "file_fixture" });
  if (path.endsWith("/transcript")) return json({ text: "مرحبا شباب اليوم", tokens: SONIOX_TOKENS });
  return json({ id: "tr_fixture", status: "completed" });
};

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "api.soniox.com": sonioxRoutes,
    "/rest/v1/monologue_attempts": () => json({ id: ATTEMPT_ID }, 201),
    ...extra,
  };
}

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null; env?: Record<string, string | undefined> } = {},
) {
  const fn = await loadFunction("score-monologue", { upstreams, env: opts.env });
  try {
    const response = await fn.handler(
      jsonRequest("score-monologue", body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
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

const takeBody = (over: Record<string, unknown> = {}) => ({
  audioBase64: AUDIO,
  mimeType: "audio/webm",
  dialect: "Yemeni",
  promptText: "احكي عن يومك",
  durationMs: 3000,
  ...over,
});

Deno.test("score-monologue measures fluency from Soniox word timings", async () => {
  const { status, body } = await call(takeBody(), caller());

  assertEquals(status, 200);
  assertEquals(body.provider, "soniox");
  assertEquals(body.timingsAvailable, true);
  assertEquals(body.transcript, "مرحبا شباب اليوم");
  assertEquals(body.attemptId, ATTEMPT_ID);

  const metrics = body.metrics as Record<string, unknown>;
  // Two runs split by the one 0.5s gap; the sub-threshold 0.1s gap stays
  // inside its run. Getting this wrong would mean the merge or the pause
  // threshold drifted, and every stored attempt after that measures
  // something else.
  assertEquals(metrics.wordCount, 3);
  assertEquals(metrics.runCount, 2);
  assertEquals(metrics.pauseCount, 1);
  // 8 estimated syllables over the client's 3 seconds.
  assertEquals(metrics.speechRateSylPerSec, 2.667);
  assertEquals(metrics.totalDurationSec, 3);
});

Deno.test("score-monologue stores the attempt under the caller, not the request body", async () => {
  const { calls } = await call(takeBody(), caller());

  const write = calls.find((c) => c.url.includes("monologue_attempts") && c.method === "POST");
  assert(write, "no monologue_attempts insert was issued");
  const row = JSON.parse(write.body ?? "{}") as Record<string, unknown>;
  // The table is written under the service role; the row must belong to the
  // authenticated caller, and nothing in the body can redirect it.
  assertEquals(row.user_id, USER);
  assertEquals(row.dialect, "Yemeni");
  assertEquals(row.duration_ms, 3000);
  assertEquals(row.timings_available, true);
  assertEquals(row.asr_provider, "soniox");
  assertEquals(row.prompt_text, "احكي عن يومك");
  assert(typeof row.metrics === "object" && row.metrics !== null);
});

Deno.test("score-monologue degrades to a transcript when Soniox is down", async () => {
  const { status, body, calls } = await call(
    takeBody(),
    caller({ "api.soniox.com": () => json({ error: "down" }, 500) }),
  );

  assertEquals(status, 200);
  assertEquals(body.provider, "munsit");
  // Honest degradation: no timings means no metrics, not zeroed ones that
  // would chart as the learner suddenly falling silent.
  assertEquals(body.timingsAvailable, false);
  assertEquals(body.metrics, null);
  assertEquals(body.transcript, "مرحبا");
  assertEquals(body.wordCount, 1);
  assert(calls.some((c) => c.url.includes("api.munsit.com")));

  const write = calls.find((c) => c.url.includes("monologue_attempts") && c.method === "POST");
  assert(write, "degraded attempts are still corpus and must still be stored");
  const row = JSON.parse(write.body ?? "{}") as Record<string, unknown>;
  assertEquals(row.timings_available, false);
  assertEquals(row.asr_provider, "munsit");
});

Deno.test("score-monologue goes straight to Munsit when Soniox is not configured", async () => {
  const { status, body, calls } = await call(takeBody(), caller(), {
    env: { SONIOX_API_KEY: undefined },
  });

  assertEquals(status, 200);
  assertEquals(body.provider, "munsit");
  assert(!calls.some((c) => c.url.includes("api.soniox.com")));
});

Deno.test("score-monologue says so when no ASR is configured at all", async () => {
  const { status, body } = await call(takeBody(), caller(), {
    env: { SONIOX_API_KEY: undefined, MUNSIT_API_KEY: undefined },
  });

  assertEquals(status, 500);
  assertStringIncludes(String(body.error), "No ASR configured");
});

Deno.test("score-monologue still returns the scoring when the attempt write fails", async () => {
  const { status, body } = await call(
    takeBody(),
    caller({ "/rest/v1/monologue_attempts": () => json({ message: "boom" }, 500) }),
  );

  // The learner just spoke for minutes; losing the row is a logging problem,
  // losing the response is a product failure.
  assertEquals(status, 200);
  assertEquals(body.attemptId, null);
  assertEquals(body.timingsAvailable, true);
  assert(body.metrics !== null);
});

Deno.test("score-monologue requires a signed-in caller", async () => {
  const { status, body, calls } = await call(takeBody(), caller(), { jwt: null });

  // Attempts belong to an account; there is nothing to store for an anonymous
  // caller, and this is paid ASR.
  assertEquals(status, 401);
  assertEquals(body.error, "auth_required");
  assert(!calls.some((c) => c.url.includes("api.soniox.com") || c.url.includes("api.munsit.com")));
});

Deno.test("score-monologue refuses a request with no audio before spending anything", async () => {
  for (const audioBase64 of [undefined, "", 42]) {
    const { status, calls } = await call(takeBody({ audioBase64 }), caller());

    assertEquals(status, 400);
    assert(!calls.some((c) => c.url.includes("api.soniox.com") || c.url.includes("api.munsit.com")));
  }
});
