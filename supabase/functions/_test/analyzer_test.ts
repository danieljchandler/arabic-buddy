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

// ── Finishing inside the wall clock ──────────────────────────────────────────
//
// This function persisted once, after every optional stage had run: a merge, a
// translation ensemble, a Fusha waterfall, up to four sequential 30s
// arbitration calls, an analysis retry, then vocabulary and gloss enrichment.
// That chain can outlast the platform's 400s wall clock, and a worker torn
// down inside it wrote nothing at all — every model call paid for, and the
// pipeline left waiting on a row that would never change.

const PIPELINE_VIDEO = "cccccccc-0000-4000-8000-000000000000";
const SERVICE_ROLE_KEY = "e2e-service-role-not-a-real-secret";

/** A merge reply and an analysis reply, which is all a usable transcript needs. */
const analysisReply = () =>
  chatCompletion(JSON.stringify({
    lines: [{ arabic: "شلونك اليوم" }, { arabic: "الحمد لله بخير" }],
    dialect: "Gulf",
    difficulty: "Beginner",
    vocabulary: [{ arabic: "شلونك", english: "how are you" }],
    grammarPoints: [{ title: "شلون", explanation: "how" }],
    culturalContext: "An everyday Gulf greeting.",
  }));

async function runAnalysis(
  videoStatus: string,
): Promise<{
  writes: Array<Record<string, unknown>>;
  finalizeCalls: Array<Record<string, unknown>>;
}> {
  const fn = await loadFunction("analyze-gulf-arabic", {
    upstreams: allowed({
      "openrouter.ai": () => analysisReply(),
      "generativelanguage.googleapis.com": () => analysisReply(),
      "/rest/v1/discover_videos": (request) => {
        if (request.method === "GET") return json({ transcription_status: videoStatus, engines_used: null }, 200);
        // Model PostgREST's conditional update, including the lost-claim case.
        const filter = new URL(request.url).searchParams.get("transcription_status");
        return json(filter === "neq.completed" && videoStatus === "completed" ? [] : [{ id: PIPELINE_VIDEO }], 200);
      },
      "/rest/v1/processed_videos": () => json({}, 201),
      "/functions/v1/process-approved-video": () => json({ success: true }, 202),
    }),
  });
  try {
    await fn.handler(
      jsonRequest("analyze-gulf-arabic", {
        transcript: "شلونك اليوم الحمد لله بخير",
        videoId: PIPELINE_VIDEO,
        dialectModule: "Gulf",
      }, { jwt: SERVICE_ROLE_KEY }),
    );
    await fn.background();
    const writes = fn.calls
      .filter((c) => c.url.includes("discover_videos") && c.method === "PATCH")
      .map((c) => JSON.parse(c.body ?? "{}") as Record<string, unknown>);
    const finalizeCalls = fn.calls
      .filter((c) => c.url.includes("/functions/v1/process-approved-video"))
      .map((c) => JSON.parse(c.body ?? "{}") as Record<string, unknown>);
    return { writes, finalizeCalls };
  } finally {
    fn.restore();
  }
}

Deno.test("saves a usable transcript before spending time enriching it", async () => {
  const { writes, finalizeCalls } = await runAnalysis("processing");

  // More than one write is the whole point: the first carries a transcript the
  // pipeline can finish with, so a teardown during the enrichment costs the
  // enrichment rather than the run.
  assert(writes.length >= 2, `expected a save before the enrichment, got ${writes.length} write(s)`);
  const first = writes[0];
  assertEquals(first.transcription_status, "analysis_complete");
  assertEquals((first.transcript_lines as unknown[]).length, 2);
  assert(Array.isArray(first.vocabulary), "expected vocabulary in the early save");
  assertEquals(
    finalizeCalls[0],
    { videoId: PIPELINE_VIDEO, stage: "finalize" },
    "the first usable save must finish the pipeline without waiting for its old watcher",
  );
});

Deno.test("does not undo a row the pipeline already finished", async () => {
  // The early save can be picked up and finalised while the enrichment is
  // still running. Those lines now carry audio timings this function does not
  // have, so the late write must leave them, and the status, alone.
  const { writes } = await runAnalysis("completed");
  const last = writes.at(-1);

  assert(last, "expected a write");
  assertEquals("transcript_lines" in last, false);
  assertEquals("transcription_status" in last, false);
  // What the enrichment actually improved still lands.
  assert("vocabulary" in last);
  assert("grammar_points" in last);
});

Deno.test("keeps completion and aligned lines when finalization wins during the enrichment save", async () => {
  const aligned = [{ id: "aligned", arabic: "شلونك اليوم", startMs: 0, endMs: 3000 }];
  const row: Record<string, unknown> = { transcription_status: "processing", engines_used: null };
  let raced = false;
  const fn = await loadFunction("analyze-gulf-arabic", {
    upstreams: allowed({
      "openrouter.ai": () => analysisReply(),
      "generativelanguage.googleapis.com": () => analysisReply(),
      "/functions/v1/process-approved-video": () => json({ success: true }, 202),
      "/rest/v1/discover_videos": async (request) => {
        if (request.method === "GET") return json(row);
        const patch = await request.json();
        if (patch.transcript_lines && patch.engines_used) {
          // Completion happens AFTER any preflight read but BEFORE the UPDATE.
          raced = true;
          Object.assign(row, { transcription_status: "completed", transcript_lines: aligned, cultural_context: "visual + audio" });
        }
        const filter = new URL(request.url).searchParams.get("transcription_status");
        if (filter === "neq.completed" && row.transcription_status === "completed") return json([]);
        if (filter === "eq.processing" && row.transcription_status !== "processing") return json([]);
        Object.assign(row, patch);
        return json([{ id: PIPELINE_VIDEO }]);
      },
    }),
  });
  try {
    const response = await fn.handler(jsonRequest("analyze-gulf-arabic", {
      transcript: "شلونك اليوم الحمد لله بخير", videoId: PIPELINE_VIDEO,
    }, { jwt: SERVICE_ROLE_KEY }));
    await fn.background();
    assertEquals(response.status, 200);
    assert(raced);
    assertEquals(row.transcription_status, "completed");
    assertEquals(row.transcript_lines, aligned);
    assertEquals(row.cultural_context, "visual + audio");
    assert(Array.isArray(row.vocabulary));
  } finally {
    fn.restore();
  }
});

for (const provider of ["openrouter.ai", "api.fanar.qa/v1/chat/completions"]) {
  Deno.test(`finishes analysis when ${provider} sends headers then stalls its body`, async () => {
    const originalSetTimeout = globalThis.setTimeout;
    // Exercise the real timeout path without waiting 30–40 seconds per call.
    globalThis.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
      originalSetTimeout(handler, delay === 30_000 || delay === 40_000 ? 5 : delay, ...args)) as typeof setTimeout;
    let stalled = false;
    let aborted = false;
    let release: (() => void) | undefined;
    const fn = await loadFunction("analyze-gulf-arabic", {
      env: { FANAR_API_KEY: "fixture-fanar-key" },
      upstreams: allowed({
        "openrouter.ai": () => analysisReply(),
        "generativelanguage.googleapis.com": () => analysisReply(),
        [provider]: (request) => {
          if (stalled) return analysisReply();
          stalled = true;
          return new Response(new ReadableStream({
            start(controller) {
              release = () => controller.close();
              request.signal.addEventListener("abort", () => {
                aborted = true;
                release = undefined;
                controller.error(new DOMException("Timed out", "AbortError"));
              }, { once: true });
            },
          }), { status: 200 });
        },
        "/rest/v1/discover_videos": () => json([{ id: PIPELINE_VIDEO }]),
        "/functions/v1/process-approved-video": () => json({ success: true }, 202),
      }),
    });
    // On the broken code this releases the hung body, letting the test fail
    // its abort assertion rather than hanging the entire test suite.
    const watchdog = originalSetTimeout(() => release?.(), 500);
    try {
      const response = await fn.handler(jsonRequest("analyze-gulf-arabic", {
        transcript: "شلونك اليوم الحمد لله بخير", videoId: PIPELINE_VIDEO,
      }, { jwt: SERVICE_ROLE_KEY }));
      await fn.background();
      assertEquals(response.status, 200);
      assert(stalled);
      assert(aborted, "the provider deadline must cover reading the response body");
      assert(fn.calls.some((c) => c.method === "PATCH" && c.body?.includes('"analysis_complete"')));
    } finally {
      clearTimeout(watchdog);
      release?.();
      fn.restore();
      globalThis.setTimeout = originalSetTimeout;
    }
  });
}

Deno.test("gives up its embellishments rather than the run when time is short", async () => {
  // The budget is what stops the chain of optional stages from outlasting the
  // worker. Squeezed to nothing, the extras — the Fusha row, the arbitration
  // calls, the enrichment — are skipped, and a transcript still lands.
  const counts: Record<string, number> = { squeezed: 0, roomy: 0 };
  for (const [label, budget] of [["squeezed", "5000"], ["roomy", "300000"]] as const) {
    const fn = await loadFunction("analyze-gulf-arabic", {
      env: { ANALYZE_BUDGET_MS: budget },
      upstreams: allowed({
        "openrouter.ai": () => analysisReply(),
        "generativelanguage.googleapis.com": () => analysisReply(),
        "/rest/v1/discover_videos": (request) =>
          request.method === "GET"
            ? json({ transcription_status: "processing", engines_used: null }, 200)
            : json([{ id: PIPELINE_VIDEO }], 200),
        "/rest/v1/processed_videos": () => json({}, 201),
        "/functions/v1/process-approved-video": () => json({ success: true }, 202),
      }),
    });
    try {
      const response = await fn.handler(
        jsonRequest("analyze-gulf-arabic", {
          transcript: "شلونك اليوم الحمد لله بخير",
          videoId: PIPELINE_VIDEO,
          dialectModule: "Gulf",
        }, { jwt: SERVICE_ROLE_KEY }),
      );
      // Squeezed or not, the answer is a transcript.
      assertEquals(response.status, 200, label);
      const body = await response.json() as { success?: boolean; result?: { lines?: unknown[] } };
      assertEquals(body.success, true, label);
      assertEquals(body.result?.lines?.length, 2, label);
      await fn.background();
      counts[label] = fn.calls.filter((c) =>
        c.url.includes("openrouter.ai") || c.url.includes("generativelanguage.googleapis.com")
      ).length;
      if (label === "squeezed") {
        assertEquals(fn.calls.some((c) => c.body?.includes("Vocabulary list to enrich")), false);
        assertEquals(fn.calls.some((c) => c.body?.includes("Translate each of these Arabic words")), false);
      }
    } finally {
      fn.restore();
    }
  }

  // The saving is in model calls not made — the run under pressure does strictly
  // less work than the one with room.
  assert(
    counts.squeezed < counts.roomy,
    `expected a squeezed run to make fewer model calls, got ${counts.squeezed} vs ${counts.roomy}`,
  );
});
