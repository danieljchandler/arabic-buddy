import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { NO_AI_PROVIDER, jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `analyze-gulf-arabic` — the second half of the Transcribe pipeline.
 *
 * It takes up to seven ASR transcripts of the same audio and arbitrates between
 * them, so it is where the four engines' disagreement is actually resolved. At
 * 2,600 lines it is the largest function in the repo, and the tests here are
 * deliberately about its edges rather than its middle: the guards that decide
 * whether the expensive part runs at all, the phrase shortcut that shares the
 * endpoint, and the envelope the page unwraps.
 *
 * The envelope is the part worth pinning hardest. Failure is reported *in band*
 * as `success: false` rather than as a non-2xx, so a caller that only checked
 * the status would treat an error as a result — which is exactly what
 * `Transcribe.tsx` guards against with `if (!data?.success || !data.result)`.
 */

const USER = "00000000-0000-4000-8000-000000000001";

function allowed(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/feature_metrics": () => json({}, 201),
    ...extra,
  };
}

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler> = allowed(),
): Promise<{ status: number; body: Record<string, unknown>; calls: string[] }> {
  const fn = await loadFunction("analyze-gulf-arabic", { upstreams });
  try {
    const response = await fn.handler(jsonRequest("analyze-gulf-arabic", body));
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // The status assertion carries the failure.
    }
    return { status: response.status, body: parsed, calls: fn.calls.map((c) => c.url) };
  } finally {
    fn.restore();
  }
}

Deno.test("refuses a request with no transcript before calling a model", async () => {
  const { status, body, calls } = await call({ dialectModule: "Gulf" });

  assertEquals(status, 400);
  assertEquals(body.error, "Missing or invalid transcript");
  // The guard is in front of the ensemble, which is several model calls per
  // request — the expensive thing must not run for a request that cannot
  // produce anything.
  assertEquals(calls.filter((url) => url.includes("openrouter.ai")).length, 0);
});

Deno.test("refuses a transcript too short to analyse", async () => {
  const { status, calls } = await call({ transcript: "اب" });

  // Under three characters. A two-letter fragment is a failed transcription,
  // not a passage, and analysing it produces confident nonsense.
  assertEquals(status, 400);
  assertEquals(calls.filter((url) => url.includes("openrouter.ai")).length, 0);
});

Deno.test("refuses whitespace dressed up as a transcript", async () => {
  const { status } = await call({ transcript: "     " });

  assertEquals(status, 400);
});

Deno.test("accepts on-screen text alone when analysing a meme", async () => {
  const { status } = await call({
    transcript: "",
    isMeme: true,
    onScreenTextSegments: [{ text: "لما تصحى بدري", startMs: 0, endMs: 2000 }],
  });

  // A meme is often silent; the caption is the whole content. This is the one
  // case where an empty transcript is a legitimate request rather than a
  // failed one.
  assert(status !== 400, `expected the meme path to be accepted, got ${status}`);
});

Deno.test("reports having no provider rather than pretending to analyse", async () => {
  const fn = await loadFunction("analyze-gulf-arabic", {
    // Every provider key: the pipeline's models are spread across OpenRouter
    // and Google now, so one missing key is a route it does not take, not a
    // configuration failure.
    env: NO_AI_PROVIDER,
    upstreams: allowed(),
  });
  try {
    const response = await fn.handler(
      jsonRequest("analyze-gulf-arabic", { transcript: "شلونك اليوم يا صديقي" }),
    );
    const body = (await response.json()) as Record<string, unknown>;

    // 500 and an explicit message. A misconfigured deployment answering 200
    // with an empty result would look like audio nobody could transcribe.
    assertEquals(response.status, 500);
    assertEquals(body.error, "AI service not configured");
  } finally {
    fn.restore();
  }
});

Deno.test("turns away a request with no credentials", async () => {
  const fn = await loadFunction("analyze-gulf-arabic", { upstreams: allowed() });
  try {
    const response = await fn.handler(
      jsonRequest("analyze-gulf-arabic", { transcript: "شلونك اليوم" }, { jwt: null }),
    );

    assertEquals(response.status, 401);
  } finally {
    fn.restore();
  }
});

Deno.test("turns away a JWT the auth server rejects", async () => {
  const { status } = await call(
    { transcript: "شلونك اليوم يا صديقي" },
    allowed({ "/auth/v1/user": () => json({ error: "invalid" }, 401) }),
  );

  assertEquals(status, 401);
});

Deno.test("translates a bare phrase without running the ensemble", async () => {
  const { status, body, calls } = await call(
    { phrase: "شلونك" },
    allowed({ "openrouter.ai": () => chatCompletion("how are you") }),
  );

  // The same endpoint serves a one-word lookup from TappableArabicText. It
  // answers `{ translation }` rather than the analysis envelope, and it must
  // stay a single cheap call — this is invoked on every word tap.
  assertEquals(status, 200);
  assertEquals(body.translation, "how are you");
  assertEquals(calls.filter((url) => url.includes("openrouter.ai")).length, 1);
});

Deno.test("strips the punctuation a model wraps a translation in", async () => {
  const { body } = await call(
    { phrase: "شلونك" },
    allowed({ "openrouter.ai": () => chatCompletion('"how are you."') }),
  );

  // Asked for 1–5 words and no punctuation, models return quotes and full
  // stops anyway. The word lands in a flashcard, so the cleanup is load-bearing.
  assertEquals(body.translation, "how are you");
});

Deno.test("reports a phrase translation that came back empty as null", async () => {
  const { status, body } = await call(
    { phrase: "شلونك" },
    allowed({ "openrouter.ai": () => chatCompletion("   ") }),
  );

  // `null`, not `""`. The caller renders the translation directly, and an empty
  // string is indistinguishable from a word with no meaning.
  assertEquals(status, 200);
  assertEquals(body.translation, null);
});

Deno.test("needs a provider for the phrase shortcut too", async () => {
  const fn = await loadFunction("analyze-gulf-arabic", {
    env: NO_AI_PROVIDER,
    upstreams: allowed(),
  });
  try {
    const response = await fn.handler(jsonRequest("analyze-gulf-arabic", { phrase: "شلونك" }));

    assertEquals(response.status, 500);
  } finally {
    fn.restore();
  }
});

Deno.test("normalises an unknown dialect module to Gulf", async () => {
  // Settings offers eight dialects where DialectContext knows three, so this
  // function receives values it has never heard of. Falling back rather than
  // failing is what keeps a learner on "Kuwaiti" getting an analysis at all.
  const { status } = await call(
    { phrase: "شلونك", dialectModule: "Kuwaiti" },
    allowed({ "openrouter.ai": () => chatCompletion("how are you") }),
  );

  assertEquals(status, 200);
});

// ── Audio that is not Arabic ─────────────────────────────────────────────────
//
// Every ASR engine feeding this function is pinned to Arabic, so none of them
// can report "that was an English song" — handed one, they answer in Arabic
// script anyway. Left alone, that becomes a transcript, a vocabulary list and a
// difficulty rating for words nobody said. Memes are the worst case: the joke
// is written on screen and the audio is a trending track.

const ENGLISH_LYRICS = "we are never ever ever getting back together like ever";

Deno.test("refuses to transcribe audio the engines wrote in another language", async () => {
  const { status, body, calls } = await call(
    { transcript: ENGLISH_LYRICS },
    allowed({ "openrouter.ai": () => chatCompletion("{}") }),
  );

  assertEquals(status, 200);
  assertEquals(body.noArabicSpeech, true);
  assertEquals((body.result as { lines: unknown[] }).lines, []);
  // Decisive on the text alone, so it never pays for the merge call.
  assertEquals(calls.filter((url) => url.includes("openrouter.ai")).length, 0);
});

Deno.test("names what the audio turned out to be", async () => {
  const { body } = await call(
    { transcript: ENGLISH_LYRICS },
    allowed({ "openrouter.ai": () => chatCompletion("{}") }),
  );

  const audio = body.audio as { verdict: string; reason: string };
  // The pipeline writes this into `transcription_error` so a reviewer can tell
  // "we refused this audio" from "transcription broke".
  assertEquals(audio.verdict, "non_arabic");
  assert(audio.reason.length > 0);
});

Deno.test("stops when the model itself says the audio is not Arabic", async () => {
  const { body, calls } = await call(
    { transcript: "شلونك اليوم الحمد لله بخير وانت شخبارك" },
    allowed({
      "openrouter.ai": () => chatCompletion(JSON.stringify({
        audio: { verdict: "non_arabic", reason: "an Arabic-letter smear of English lyrics" },
        lines: [],
      })),
    }),
  );

  assertEquals(body.noArabicSpeech, true);
  // One call, not four. An empty `lines` with that verdict is the ANSWER, so it
  // must not fall through to the Fanar fallback and the stricter retry — those
  // would talk the pipeline back into transcribing the song.
  assertEquals(calls.filter((url) => url.includes("openrouter.ai")).length, 1);
});

Deno.test("still teaches from a silent meme's on-screen text", async () => {
  const { status, body, calls } = await call(
    {
      transcript: "",
      isMeme: true,
      onScreenTextSegments: [
        { text: "لما تصحى بدري", translation: "when you wake up early", startSeconds: 0, endSeconds: 2 },
      ],
    },
    allowed({
      "openrouter.ai": () => chatCompletion(JSON.stringify({
        vocabulary: [{ arabic: "تصحى", english: "you wake up" }],
        grammarPoints: [{ title: "لما", explanation: "when" }],
        culturalContext: "A morning-person joke.",
      })),
    }),
  );

  const result = body.result as { lines: unknown[]; vocabulary: unknown[]; culturalContext?: string };
  assertEquals(status, 200);
  // No spoken lines — the audio is a trending song and nobody said any of this.
  assertEquals(result.lines, []);
  // But the overlay is the only Arabic in the video, so the vocabulary and the
  // grammar have to come from it or the video teaches nothing at all.
  assertEquals(result.vocabulary.length, 1);
  assertEquals(result.culturalContext, "A morning-person joke.");
  assertEquals(calls.filter((url) => url.includes("openrouter.ai")).length, 1);
});

Deno.test("survives the on-screen-only pass failing", async () => {
  const { status, body } = await call(
    {
      transcript: "",
      isMeme: true,
      onScreenTextSegments: [{ text: "لما تصحى بدري", startSeconds: 0, endSeconds: 2 }],
    },
    allowed({ "openrouter.ai": () => json({ error: "boom" }, 500) }),
  );

  // Losing the vocabulary is a smaller loss than losing the row.
  assertEquals(status, 200);
  assertEquals(body.noArabicSpeech, true);
  assertEquals((body.result as { vocabulary: unknown[] }).vocabulary, []);
});

Deno.test("hands a persisted analysis back to the pipeline to finish", async () => {
  // The pipeline's own worker may be gone by the time a long analysis lands
  // (the platform's wall clock belongs to the worker, and the analysis alone
  // can outlive one). Once the row is written, this function asks the pipeline
  // to run its finalize stage — so a transcript finishes even when nothing is
  // left watching for it.
  const VIDEO = "cccccccc-0000-4000-8000-000000000000";
  const SERVICE_ROLE = "e2e-service-role-not-a-real-secret";
  const fn = await loadFunction("analyze-gulf-arabic", {
    upstreams: allowed({
      "openrouter.ai": () => chatCompletion(JSON.stringify({
        audio: { verdict: "non_arabic", reason: "an English song" },
        lines: [],
      })),
      "/rest/v1/discover_videos": () => json([{ id: VIDEO }], 200),
      "/functions/v1/process-approved-video": () => json({ success: true }, 202),
    }),
  });
  try {
    const response = await fn.handler(
      jsonRequest("analyze-gulf-arabic", {
        transcript: "شلونك اليوم الحمد لله بخير وانت شخبارك",
        videoId: VIDEO,
      }, { jwt: SERVICE_ROLE }),
    );
    assertEquals(response.status, 200);
    await fn.background();

    const persisted = fn.calls.find((c) => c.url.includes("discover_videos") && c.method === "PATCH");
    assert(persisted, "expected the empty transcript to be persisted");
    assertEquals(JSON.parse(persisted.body ?? "{}").transcription_status, "analysis_complete");

    const callback = fn.calls.find((c) => c.url.includes("/functions/v1/process-approved-video"));
    assert(callback, "expected the pipeline to be asked to finalize");
    assertEquals(JSON.parse(callback.body ?? "{}"), { videoId: VIDEO, stage: "finalize" });
    assertEquals(callback.headers["authorization"], `Bearer ${SERVICE_ROLE}`);
  } finally {
    fn.restore();
  }
});
