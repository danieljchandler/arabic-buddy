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
    // Exercise the real timeout path without waiting for it: every provider
    // deadline — the wait for headers and the generation budget that replaces
    // it once they arrive — is thirty seconds or more.
    globalThis.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
      originalSetTimeout(handler, typeof delay === "number" && delay >= 30_000 ? 5 : delay, ...args)) as typeof setTimeout;
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

Deno.test("keeps reading an answer that takes longer than the header deadline to write", async () => {
  // The merge writes every line of a clip fully voweled, up to 8k tokens of
  // JSON, which takes a model longer than the 40 seconds allowed for it to
  // *start* answering. One deadline used to cover both, so the whole merge
  // was thrown away on any clip longer than a short one and the punctuation
  // fallback ran instead. Here the header deadline is squeezed to a few
  // milliseconds while the generation budget is left alone, and the body
  // arrives slowly: a run that honours the distinction reads it in full.
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
    originalSetTimeout(handler, delay === 30_000 || delay === 40_000 ? 5 : delay, ...args)) as typeof setTimeout;
  let aborted = false;
  const slowBody = (request: Request): Response => {
    const bytes = new TextEncoder().encode(envelope());
    let offset = 0;
    return new Response(new ReadableStream({
      pull(controller) {
        return new Promise<void>((resolve) => {
          originalSetTimeout(() => {
            if (request.signal.aborted) { aborted = true; controller.error(new DOMException("Timed out", "AbortError")); return resolve(); }
            if (offset >= bytes.length) { controller.close(); return resolve(); }
            controller.enqueue(bytes.slice(offset, offset + 64));
            offset += 64;
            resolve();
          }, 4);
        });
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  // An OpenAI-shaped completion whose content is the merge/analysis reply.
  const envelope = (): string => JSON.stringify({
    choices: [{
      index: 0,
      finish_reason: "stop",
      message: {
        role: "assistant",
        content: JSON.stringify({
          lines: [{ arabic: "شلونك اليوم" }, { arabic: "الحمد لله بخير" }],
          dialect: "Gulf",
          difficulty: "Beginner",
          vocabulary: [],
          grammarPoints: [],
        }),
      },
    }],
  });
  const fn = await loadFunction("analyze-gulf-arabic", {
    env: { FANAR_API_KEY: undefined },
    upstreams: allowed({
      "openrouter.ai": slowBody,
      "generativelanguage.googleapis.com": slowBody,
    }),
  });
  try {
    const response = await fn.handler(jsonRequest("analyze-gulf-arabic", {
      transcript: "شلونك اليوم الحمد لله بخير",
    }));
    const body = await response.json() as { success?: boolean; partial?: boolean; result?: { lines?: Array<{ arabic: string }> } };
    assertEquals(response.status, 200);
    assertEquals(aborted, false, "a body still arriving within its generation budget must not be cut off");
    assertEquals(Boolean(body.partial), false);
    assertEquals(body.result?.lines?.map((l) => l.arabic), ["شلونك اليوم", "الحمد لله بخير"]);
  } finally {
    fn.restore();
    globalThis.setTimeout = originalSetTimeout;
  }
});

Deno.test("never hands a merge failure back as one line", async () => {
  // Every model answers with something that is not a transcript, so the merge
  // fails and the punctuation fallback runs — on ASR text that, like most
  // Arabic ASR output, has no punctuation in it. That used to come back as a
  // single line the length of the clip.
  const words = [
    "شلونك", "اليوم", "الحمد", "لله", "بخير", "وانت", "شخبارك", "والله", "زين",
    "الحين", "وين", "رايح", "بروح", "السوق", "اشتري", "اغراض", "للبيت", "طيب",
    "الله", "يوفقك", "يعني", "بشوفك", "بكره", "ان", "شاء", "الله", "مع", "السلامة",
  ];
  const fn = await loadFunction("analyze-gulf-arabic", {
    env: { FANAR_API_KEY: undefined },
    upstreams: allowed({
      "openrouter.ai": () => chatCompletion("Sorry, I cannot help with that."),
      "generativelanguage.googleapis.com": () => chatCompletion("Sorry, I cannot help with that."),
    }),
  });
  try {
    const response = await fn.handler(jsonRequest("analyze-gulf-arabic", { transcript: words.join(" ") }));
    const body = await response.json() as { success?: boolean; partial?: boolean; result?: { lines?: Array<{ arabic: string }> } };
    assertEquals(response.status, 200);
    assertEquals(body.partial, true);
    const lines = body.result?.lines ?? [];
    assert(lines.length > 1, `expected the fallback to break ${words.length} words into lines, got ${lines.length}`);
    for (const line of lines) assert(line.arabic.split(/\s+/).length <= 12, `over-long fallback line: ${line.arabic}`);
    assertEquals(lines.map((l) => l.arabic).join(" "), words.join(" "));
  } finally {
    fn.restore();
  }
});

// ── Every outcome reaches the row ────────────────────────────────────────────
//
// When the pipeline calls this function it reads the row, not the reply: the
// gateway drops the HTTP response at 150 seconds while the analysis runs on.
// A merge that failed after that, or an error thrown late, used to leave the
// row on `processing`, and the pipeline then waited out the platform's whole
// wall clock, started the analysis again, waited again, and failed a quarter
// of an hour later with "started 2 times and never saved a result".

Deno.test("persists the rule-split fallback for the pipeline when the merge fails", async () => {
  const words = [
    "شلونك", "اليوم", "الحمد", "لله", "بخير", "وانت", "شخبارك", "والله", "زين",
    "الحين", "وين", "رايح", "بروح", "السوق", "اشتري", "اغراض", "للبيت", "طيب",
  ];
  const fn = await loadFunction("analyze-gulf-arabic", {
    env: { FANAR_API_KEY: undefined },
    upstreams: allowed({
      "openrouter.ai": () => chatCompletion("Sorry, I cannot help with that."),
      "generativelanguage.googleapis.com": () => chatCompletion("Sorry, I cannot help with that."),
      "/rest/v1/discover_videos": () => json([{ id: PIPELINE_VIDEO }], 200),
      "/functions/v1/process-approved-video": () => json({ success: true }, 202),
    }),
  });
  try {
    const response = await fn.handler(jsonRequest("analyze-gulf-arabic", {
      transcript: words.join(" "),
      videoId: PIPELINE_VIDEO,
    }, { jwt: SERVICE_ROLE_KEY }));
    assertEquals(response.status, 200);
    await fn.background();

    const persisted = fn.calls.find((c) => c.url.includes("discover_videos") && c.method === "PATCH");
    assert(persisted, "expected the fallback transcript to be written to the row");
    const patch = JSON.parse(persisted.body ?? "{}") as {
      transcription_status: string;
      transcription_error: string;
      transcript_lines: Array<{ arabic: string }>;
    };
    assertEquals(patch.transcription_status, "analysis_complete");
    assert(patch.transcript_lines.length > 1, "the fallback is line by line, not one chunk");
    assert(patch.transcription_error.includes("did not produce lines"), "the row says why it has no translations");
    // Only a row not already finalised by someone else.
    assert(persisted.url.includes("transcription_status=neq.completed"));

    const callback = fn.calls.find((c) => c.url.includes("/functions/v1/process-approved-video"));
    assert(callback, "expected the pipeline to be asked to finalize");
  } finally {
    fn.restore();
  }
});

Deno.test("records its own failure on the row rather than leaving it processing", async () => {
  // Out of time before the merge could be retried: the run throws. The row
  // must say so, and only while it is still the run's to fail.
  const fn = await loadFunction("analyze-gulf-arabic", {
    env: { FANAR_API_KEY: undefined, ANALYZE_BUDGET_MS: "5000" },
    upstreams: allowed({
      "openrouter.ai": () => chatCompletion("Sorry, I cannot help with that."),
      "generativelanguage.googleapis.com": () => chatCompletion("Sorry, I cannot help with that."),
      "/rest/v1/discover_videos": () => json([{ id: PIPELINE_VIDEO }], 200),
    }),
  });
  try {
    const response = await fn.handler(jsonRequest("analyze-gulf-arabic", {
      transcript: "شلونك اليوم الحمد لله بخير",
      videoId: PIPELINE_VIDEO,
    }, { jwt: SERVICE_ROLE_KEY }));
    assertEquals(response.status, 500);
    await fn.background();

    const persisted = fn.calls.find((c) => c.url.includes("discover_videos") && c.method === "PATCH");
    assert(persisted, "expected the failure to be written to the row");
    const patch = JSON.parse(persisted.body ?? "{}") as { transcription_status: string; transcription_error: string };
    assertEquals(patch.transcription_status, "failed");
    assert(patch.transcription_error.includes("Ran out of time merging"));
    assert(persisted.url.includes("transcription_status=eq.processing"));
  } finally {
    fn.restore();
  }
});

Deno.test("writes nothing to any row when no pipeline video is named", async () => {
  // The Transcribe page calls this directly, with no row to update.
  const fn = await loadFunction("analyze-gulf-arabic", {
    env: { FANAR_API_KEY: undefined },
    upstreams: allowed({
      "openrouter.ai": () => chatCompletion("Sorry, I cannot help with that."),
      "generativelanguage.googleapis.com": () => chatCompletion("Sorry, I cannot help with that."),
    }),
  });
  try {
    const response = await fn.handler(jsonRequest("analyze-gulf-arabic", { transcript: "شلونك اليوم الحمد لله بخير" }));
    assertEquals(response.status, 200);
    assertEquals(fn.calls.filter((c) => c.url.includes("discover_videos")).length, 0);
  } finally {
    fn.restore();
  }
});

Deno.test("translates the rule-split fallback line by line", async () => {
  // The merge failed, so the lines are raw ASR text split by rule — but they
  // are lines, and a line can be translated. One cheap call fills them in
  // rather than handing the learner a transcript with no English at all.
  const words = [
    "شلونك", "اليوم", "الحمد", "لله", "بخير", "وانت", "شخبارك", "والله", "زين",
    "الحين", "وين", "رايح", "بروح", "السوق", "اشتري", "اغراض", "للبيت", "طيب",
  ];
  const models: UpstreamHandler = async (request) => {
    const body = await request.clone().text();
    if (body.includes("Translate these Gulf Arabic lines")) {
      return chatCompletion("1. How are you today, fine thank God\n2. And you? Where are you off to now?\n3. To the market, for the house, okay");
    }
    return chatCompletion("Sorry, I cannot help with that.");
  };
  const fn = await loadFunction("analyze-gulf-arabic", {
    env: { FANAR_API_KEY: undefined },
    upstreams: allowed({
      "openrouter.ai": models,
      "generativelanguage.googleapis.com": models,
      "/rest/v1/discover_videos": () => json([{ id: PIPELINE_VIDEO }], 200),
      "/functions/v1/process-approved-video": () => json({ success: true }, 202),
    }),
  });
  try {
    const response = await fn.handler(jsonRequest("analyze-gulf-arabic", {
      transcript: words.join(" "),
      videoId: PIPELINE_VIDEO,
    }, { jwt: SERVICE_ROLE_KEY }));
    assertEquals(response.status, 200);
    const body = await response.json() as { result?: { lines?: Array<{ arabic: string; translation: string }> } };
    const lines = body.result?.lines ?? [];
    assert(lines.length > 1);
    assert(lines.every((l) => l.translation.length > 0), `every fallback line translated: ${JSON.stringify(lines.map((l) => l.translation))}`);
    assertEquals(lines[0].translation, "How are you today, fine thank God");
    await fn.background();
    const persisted = fn.calls.find((c) => c.url.includes("discover_videos") && c.method === "PATCH");
    assert(persisted);
    const patch = JSON.parse(persisted.body ?? "{}") as { transcript_lines: Array<{ translation: string }> };
    assert(patch.transcript_lines.every((l) => l.translation.length > 0), "the row gets the translations too");
  } finally {
    fn.restore();
  }
});

Deno.test("fills the lines the ensemble left blank with the cheap translator", async () => {
  // The merge and the analysis answer; all three translation models answer
  // with something that is not JSON. That used to be "leaving translations
  // empty". Now the numbered plain-text translator gets one try at the blanks,
  // and a line it fills is marked as filled by a fallback, not as verified.
  const models: UpstreamHandler = async (request) => {
    const body = await request.clone().text();
    if (body.includes("Translate these Gulf Arabic lines")) {
      return chatCompletion("1. How are you today\n2. Fine, thank God");
    }
    if (body.includes('{"translations"')) {
      return chatCompletion("I'd rather not answer in JSON today.");
    }
    return analysisReply();
  };
  const fn = await loadFunction("analyze-gulf-arabic", {
    env: { FANAR_API_KEY: undefined },
    upstreams: allowed({
      "openrouter.ai": models,
      "generativelanguage.googleapis.com": models,
    }),
  });
  try {
    const response = await fn.handler(jsonRequest("analyze-gulf-arabic", {
      transcript: "شلونك اليوم الحمد لله بخير",
    }));
    assertEquals(response.status, 200);
    const body = await response.json() as {
      result?: { lines?: Array<{ translation: string; needs_review?: boolean; review_reason?: string }> };
    };
    const lines = body.result?.lines ?? [];
    assertEquals(lines.map((l) => l.translation), ["How are you today", "Fine, thank God"]);
    assert(lines.every((l) => l.needs_review === true), "a fallback fill stays on the review queue");
    assert(lines.every((l) => l.review_reason === "call2_fallback"), "and says a fallback filled it");
  } finally {
    fn.restore();
  }
});

Deno.test("records which build and merge model produced the translation, on the row", async () => {
  const fn = await loadFunction("analyze-gulf-arabic", {
    env: { FANAR_API_KEY: undefined },
    upstreams: allowed({
      "openrouter.ai": () => analysisReply(),
      "generativelanguage.googleapis.com": () => analysisReply(),
      "/rest/v1/discover_videos": (request) =>
        request.method === "GET"
          ? json({ transcription_status: "processing", engines_used: { asr: { soniox: { ok: true } } } }, 200)
          : json([{ id: PIPELINE_VIDEO }], 200),
      "/rest/v1/processed_videos": () => json({}, 201),
      "/functions/v1/process-approved-video": () => json({ success: true }, 202),
    }),
  });
  try {
    const response = await fn.handler(jsonRequest("analyze-gulf-arabic", {
      transcript: "شلونك اليوم الحمد لله بخير",
      videoId: PIPELINE_VIDEO,
    }, { jwt: SERVICE_ROLE_KEY }));
    assertEquals(response.status, 200);
    await fn.background();
    // The first save — the one that survives a worker torn down during the
    // enrichment — already carries the provenance, merged over what the
    // pipeline wrote rather than replacing it.
    const first = fn.calls.find((c) => c.url.includes("discover_videos") && c.method === "PATCH" && c.body?.includes("analysis_complete"));
    assert(first, "expected the pre-enrichment save");
    const patch = JSON.parse(first.body ?? "{}") as {
      engines_used: { asr?: unknown; translation?: { build?: string; merge_model?: string; active_models?: number; tiers?: unknown[] } };
    };
    assert(patch.engines_used.asr, "the pipeline's ASR provenance survives the merge");
    const translation = patch.engines_used.translation;
    assert(translation, "expected translation provenance on the first save");
    assert(typeof translation.build === "string" && translation.build.length > 0);
    assertEquals(translation.merge_model, "qwen/qwen3-235b-a22b");
    // Without a HUMAIN key the ensemble is the three-model one, and the
    // absent Arabic-native peer is not a failed rung in the provenance.
    assertEquals(translation.tiers?.length, 3);
    assert(!(translation.tiers as Array<{ name: string }>).some((t) => t.name.startsWith("humain/")));
  } finally {
    fn.restore();
  }
});

Deno.test("runs the merge and the analysis on the fast workhorse, not the Max tier", async () => {
  const fn = await loadFunction("analyze-gulf-arabic", {
    env: { FANAR_API_KEY: undefined },
    upstreams: allowed({
      "openrouter.ai": () => analysisReply(),
      "generativelanguage.googleapis.com": () => analysisReply(),
    }),
  });
  try {
    await fn.handler(jsonRequest("analyze-gulf-arabic", { transcript: "شلونك اليوم الحمد لله بخير" }));
    const models = fn.calls
      .filter((c) => c.url.includes("openrouter.ai"))
      .map((c) => (JSON.parse(c.body ?? "{}") as { model?: string }).model);
    // The merge, its analysis pass and every other default call.
    assert(models.includes("qwen/qwen3-235b-a22b"), `expected the workhorse among ${models.join(", ")}`);
    // The Max tier still serves as the ensemble's third leg — and nowhere else.
    const maxCalls = fn.calls.filter((c) =>
      c.url.includes("openrouter.ai") && (c.body ?? "").includes('"qwen/qwen3.8-max"')
    );
    assert(maxCalls.every((c) => (c.body ?? "").includes('{\\"translations\\"')), "Qwen 3.8 Max only translates");
  } finally {
    fn.restore();
  }
});

// ── The Arabic-native roster's say in the translations ──────────────────────
//
// Until this stage the registry's Arabic-native models had no input into the
// English at all: the ensemble's three generalists judged each other by token
// overlap, and a rationed MT rendering was the only tiebreak. The last audited
// run ended with eight disputed lines, four reached by Shaheen and none
// settled. Now every disputed line is put to the best Arabic model that is
// configured, which is asked outright which candidate is right — and HUMAIN M3
// drafts in the ensemble itself, at the peers' weight, so a line every
// generalist misread the same way is no longer settled before an Arabic model
// has seen it.

const NODE_ENV = { HUMAIN_NODE_API_KEY: "fixture-humain", HUMAIN_BASE_URL: "https://node.humain.test", FANAR_API_KEY: undefined };
/** M3 drafting means M3 cannot arbitrate; Fanar is the roster's next configured rung. */
const NODE_AND_FANAR_ENV = { ...NODE_ENV, FANAR_API_KEY: "fixture-fanar" };

/** Is this the translation prompt? It asks for a `translations` array; the merge and the analysis ask for `lines`. */
const asksForTranslations = (body: { messages?: Array<{ content?: string }> }) =>
  Boolean(body.messages?.[0]?.content?.includes('"translations"'));

/** Drafters that disagree four ways on line 1 and agree on line 2. */
const splitEnsemble: UpstreamHandler = async (request) => {
  const body = JSON.parse(await request.clone().text()) as { model: string; messages: Array<{ content: string }> };
  if (!asksForTranslations(body)) return analysisReply();
  const model = body.model;
  const first = model.includes("gemini") ? "What's up today"
    : model.includes("qwen") ? "How's it going today"
    : model.includes("humain") ? "You good today"
    : "How are you today";
  return chatCompletion(JSON.stringify({ translations: [first, "Fine, thank God"], literals: ["lit 1", "lit 2"] }));
};

/** M3 drafts its own reading of the lines and answers the dialect check with a clean sheet. */
const m3Drafter: UpstreamHandler = async (request) => {
  const body = JSON.parse(await request.clone().text()) as { model: string; messages: Array<{ content: string }> };
  if (asksForTranslations(body)) return splitEnsemble(request);
  return chatCompletion('{"issues":[]}');
};

/** Fanar answers the arbitration with a pick and everything else (its meta pass) with nothing useful. */
const fanarArbiter = (pick: string, confidence: string): UpstreamHandler => async (request) => {
  const body = await request.clone().text();
  if (body.includes("native speaker of")) {
    return chatCompletion(JSON.stringify({ choices: [{ line: 1, pick, confidence }] }));
  }
  return chatCompletion("{}");
};

async function analyseSplit(pick: string, confidence: string) {
  const fn = await loadFunction("analyze-gulf-arabic", {
    env: NODE_AND_FANAR_ENV,
    upstreams: allowed({
      "openrouter.ai": splitEnsemble,
      "generativelanguage.googleapis.com": splitEnsemble,
      "node.humain.test": m3Drafter,
      "api.fanar.qa/v1/chat/completions": fanarArbiter(pick, confidence),
      // The rationed MT rendering is not what these tests are about.
      "api.fanar.qa/v1/translations": () => json({ error: "quota" }, 429),
      "/rest/v1/discover_videos": (request) =>
        request.method === "GET"
          ? json({ transcription_status: "processing", engines_used: null }, 200)
          : json([{ id: PIPELINE_VIDEO }], 200),
      "/rest/v1/processed_videos": () => json({}, 201),
      "/functions/v1/process-approved-video": () => json({ success: true }, 202),
    }),
  });
  try {
    const response = await fn.handler(jsonRequest("analyze-gulf-arabic", {
      transcript: "شلونك اليوم الحمد لله بخير",
      videoId: PIPELINE_VIDEO,
    }, { jwt: SERVICE_ROLE_KEY }));
    assertEquals(response.status, 200);
    const body = await response.json() as {
      result?: { lines?: Array<{ translation: string; needs_review?: boolean; resolved_by?: string; review_reason?: string }> };
    };
    await fn.background();
    const save = fn.calls.find((c) => c.url.includes("discover_videos") && c.method === "PATCH" && c.body?.includes("analysis_complete"));
    assert(save, "expected the analysis save");
    const patch = JSON.parse(save.body ?? "{}") as {
      engines_used: { translation?: { arabic_arbiter?: Record<string, unknown>; shaheen?: Record<string, unknown>; agreements?: { needs_review: number } } };
    };
    const arbiterCalls = fn.calls.filter((c) => c.url.includes("api.fanar.qa") && (c.body ?? "").includes("native speaker of"));
    const m3ArbiterCalls = fn.calls.filter((c) => c.url.includes("node.humain.test") && (c.body ?? "").includes("native speaker of"));
    return { lines: body.result?.lines ?? [], provenance: patch.engines_used.translation, arbiterCalls, m3ArbiterCalls };
  } finally {
    fn.restore();
  }
}

Deno.test("puts a disputed line to the Arabic-native judge and takes its confident pick", async () => {
  const { lines, provenance, arbiterCalls, m3ArbiterCalls } = await analyseSplit("B", "high");

  // Line 1 split four ways; the ensemble's fallback had handed it to the
  // heaviest drafter listed first (Claude) and flagged it. The judge picked B
  // — Gemini's — so that is the line now, off the review queue, and it says
  // who settled it and on whose text. M3 drafted one of the four, so the
  // judging fell to the next Arabic model that is configured.
  assertEquals(lines[0].translation, "What's up today");
  assertEquals(lines[0].needs_review, false);
  assertEquals(lines[0].resolved_by, "Fanar-C-2-27B→google/gemini-3.7-flash");
  assertEquals(m3ArbiterCalls.length, 0, "a drafter is not asked to arbitrate its own line");
  // Line 2 was never in dispute and was never put to the judge.
  assertEquals(lines[1].translation, "Fine, thank God");
  assertEquals(lines[1].needs_review, false);
  assertEquals(lines[1].resolved_by, undefined);

  // One call, every disputed line in it, candidates lettered and unnamed.
  assertEquals(arbiterCalls.length, 1);
  const prompt = JSON.parse(arbiterCalls[0].body ?? "{}") as { messages: Array<{ content: string }> };
  const user = prompt.messages[1].content;
  assert(user.includes("Line 1: شلونك اليوم"), user);
  assert(user.includes("A. How are you today") && user.includes("B. What's up today") && user.includes("C. You good today") && user.includes("D. How's it going today"), user);
  assert(!user.includes("Line 2:"), "an agreed line is not a dispute");
  assert(!/claude|gemini|qwen|humain/i.test(user), "the judge is not told whose translation is whose");

  const arbiter = provenance?.arabic_arbiter ?? {};
  assertEquals(arbiter.attempted, true);
  assertEquals(arbiter.model, "Fanar-C-2-27B");
  assertEquals(arbiter.disputed_lines, 1);
  assertEquals(arbiter.resolved, 1);
  // The row says why the best Arabic model did not judge.
  const attempts = (arbiter as { attempts?: Array<{ model: string; error: string }> }).attempts ?? [];
  assertEquals(attempts.map((a) => a.model), ["humain/humain-m3"]);
  assert(attempts[0].error.startsWith("skipped: drafted in this ensemble"), attempts[0].error);
  assertEquals(provenance?.arabic_arbiter?.unresolved, 0);
  assertEquals(provenance?.agreements?.needs_review, 0);
  // Nothing is left for the rationed MT tiebreak to do.
  assertEquals(provenance?.shaheen?.disputed_lines, 0);
});

Deno.test("adopts a hesitant pick but keeps the line on the review queue", async () => {
  const { lines, provenance } = await analyseSplit("D", "low");

  // A native speaker's low-confidence preference is still better evidence
  // than "listed first", so the text changes — but a reviewer still sees it.
  assertEquals(lines[0].translation, "How's it going today");
  assertEquals(lines[0].needs_review, true);
  assertEquals(lines[0].review_reason, "ensemble_disagreement");
  assertEquals(lines[0].resolved_by, undefined);
  assertEquals(provenance?.arabic_arbiter?.adopted_unconfirmed, 1);
  assertEquals(provenance?.arabic_arbiter?.resolved, 0);
});

Deno.test("leaves a line the judge backs no candidate on exactly as the ensemble left it", async () => {
  const { lines, provenance } = await analyseSplit("null", "high");

  assertEquals(lines[0].translation, "How are you today");
  assertEquals(lines[0].needs_review, true);
  assertEquals(provenance?.arabic_arbiter?.unresolved, 1);
});

Deno.test("drafts with HUMAIN M3 at the peers' weight: one generalist and the Arabic-native peer settle a line", async () => {
  // Claude reads line 1 one way; Gemini and M3 read it the same other way;
  // Qwen a third. Before the promotion this was Claude against Gemini with
  // Qwen unable to tip it — a dispute. With M3 an equal peer, two peers agree
  // and the line is settled, and it is settled on the reading the Arabic
  // model backed.
  const drafters: UpstreamHandler = async (request) => {
    const body = JSON.parse(await request.clone().text()) as { model: string; messages: Array<{ content: string }> };
    if (!asksForTranslations(body)) return body.model.includes("humain") ? chatCompletion('{"issues":[]}') : analysisReply();
    const model = body.model;
    const first = model.includes("gemini") || model.includes("humain") ? "Where have you been"
      : model.includes("qwen") ? "Long time no see"
      : "Where were you";
    return chatCompletion(JSON.stringify({ translations: [first, "Fine, thank God"], literals: ["lit 1", "lit 2"] }));
  };
  const fn = await loadFunction("analyze-gulf-arabic", {
    env: NODE_ENV,
    upstreams: allowed({
      "openrouter.ai": drafters,
      "generativelanguage.googleapis.com": drafters,
      "node.humain.test": drafters,
      "/rest/v1/discover_videos": (request) =>
        request.method === "GET"
          ? json({ transcription_status: "processing", engines_used: null }, 200)
          : json([{ id: PIPELINE_VIDEO }], 200),
      "/rest/v1/processed_videos": () => json({}, 201),
      "/functions/v1/process-approved-video": () => json({ success: true }, 202),
    }),
  });
  try {
    const response = await fn.handler(jsonRequest("analyze-gulf-arabic", {
      transcript: "وينك اليوم الحمد لله بخير",
      videoId: PIPELINE_VIDEO,
    }, { jwt: SERVICE_ROLE_KEY }));
    assertEquals(response.status, 200);
    const body = await response.json() as { result?: { lines?: Array<{ translation: string; needs_review?: boolean }> } };
    await fn.background();

    assertEquals(body.result?.lines?.[0].translation, "Where have you been");
    assertEquals(body.result?.lines?.[0].needs_review, false);

    const save = fn.calls.find((c) => c.url.includes("discover_videos") && c.method === "PATCH" && c.body?.includes("analysis_complete"));
    const patch = JSON.parse(save?.body ?? "{}") as {
      engines_used: {
        translation?: {
          active_models?: number;
          agreements?: { needs_review: number; gemini_claude: number; all_three: number };
          tiers?: Array<{ name: string; weight: number; status: string; lines_won: number; lines_outvoted: number }>;
          arabic_arbiter?: { skip_reason?: string };
        };
      };
    };
    const translation = patch.engines_used.translation;
    assertEquals(translation?.active_models, 4);
    assertEquals((translation as { degraded?: boolean } | undefined)?.degraded, false);
    assertEquals(translation?.agreements?.needs_review, 0);
    const byName = Object.fromEntries((translation?.tiers ?? []).map((t) => [t.name, t]));
    const m3 = byName["humain/humain-m3"];
    assertEquals(m3?.weight, 1, "the Arabic-native peer votes at the generalists' weight");
    assertEquals(m3?.status, "ok");
    assertEquals(m3?.lines_won, 2);
    assertEquals(m3?.lines_outvoted, 0);
    // Claude lost line 1 and the row says so — an equal vote can be outvoted.
    assertEquals(byName["anthropic/claude-sonnet-5"]?.lines_won, 1);
    assertEquals(byName["anthropic/claude-sonnet-5"]?.lines_outvoted, 1);
    // Nothing was in dispute, so nothing went to arbitration.
    assertEquals(translation?.arabic_arbiter?.skip_reason, "nothing_disputed");
    // M3 got the same translation prompt as the generalists, once.
    const m3Drafts = fn.calls.filter((c) => c.url.includes("node.humain.test") && (c.body ?? "").includes('{\\"translations\\"'));
    assertEquals(m3Drafts.length, 1);
  } finally {
    fn.restore();
  }
});

Deno.test("an Arabic-native peer alone against two generalists is outvoted, and the row records it", async () => {
  // Equal weight is a vote, not a veto: Claude and Gemini agreeing still
  // carry the line, M3's different reading is recorded as outvoted rather
  // than flagged — the case that would flood the review queue.
  const drafters: UpstreamHandler = async (request) => {
    const body = JSON.parse(await request.clone().text()) as { model: string; messages: Array<{ content: string }> };
    if (!asksForTranslations(body)) return body.model.includes("humain") ? chatCompletion('{"issues":[]}') : analysisReply();
    const first = body.model.includes("humain") ? "Where have you been" : "Where were you";
    return chatCompletion(JSON.stringify({ translations: [first, "Fine, thank God"], literals: ["lit 1", "lit 2"] }));
  };
  const fn = await loadFunction("analyze-gulf-arabic", {
    env: NODE_ENV,
    upstreams: allowed({
      "openrouter.ai": drafters,
      "generativelanguage.googleapis.com": drafters,
      "node.humain.test": drafters,
      "/rest/v1/discover_videos": (request) =>
        request.method === "GET"
          ? json({ transcription_status: "processing", engines_used: null }, 200)
          : json([{ id: PIPELINE_VIDEO }], 200),
      "/rest/v1/processed_videos": () => json({}, 201),
      "/functions/v1/process-approved-video": () => json({ success: true }, 202),
    }),
  });
  try {
    const response = await fn.handler(jsonRequest("analyze-gulf-arabic", {
      transcript: "وينك اليوم الحمد لله بخير",
      videoId: PIPELINE_VIDEO,
    }, { jwt: SERVICE_ROLE_KEY }));
    assertEquals(response.status, 200);
    const body = await response.json() as { result?: { lines?: Array<{ translation: string; needs_review?: boolean }> } };
    await fn.background();
    assertEquals(body.result?.lines?.[0].translation, "Where were you");
    assertEquals(body.result?.lines?.[0].needs_review, false);
    const save = fn.calls.find((c) => c.url.includes("discover_videos") && c.method === "PATCH" && c.body?.includes("analysis_complete"));
    const patch = JSON.parse(save?.body ?? "{}") as {
      engines_used: { translation?: { tiers?: Array<{ name: string; lines_won: number; lines_outvoted: number }> } };
    };
    const m3 = patch.engines_used.translation?.tiers?.find((t) => t.name === "humain/humain-m3");
    assertEquals(m3?.lines_won, 1);
    assertEquals(m3?.lines_outvoted, 1);
  } finally {
    fn.restore();
  }
});

Deno.test("an Arabic-native peer answering in content parts is read and votes", async () => {
  // M3 is natively multimodal and answers `content` as typed parts, not a
  // string. The judge walk learnt to read that shape on the third live run;
  // the drafter path still read `message.content` bare, so a full M3
  // translation came back as an array, failed the JSON parse, and was rowed
  // as `parse_failed` — one run after being promoted to an equal peer.
  const partsReply = (text: string) =>
    json({
      id: "chatcmpl-parts",
      object: "chat.completion",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: [{ type: "text", text }] } }],
    });
  const drafters: UpstreamHandler = async (request) => {
    const body = JSON.parse(await request.clone().text()) as { model: string; messages: Array<{ content: string }> };
    const m3 = body.model.includes("humain");
    if (!asksForTranslations(body)) return m3 ? partsReply('{"issues":[]}') : analysisReply();
    const first = m3 || body.model.includes("gemini") ? "Where have you been" : "Where were you";
    const reply = JSON.stringify({ translations: [first, "Fine, thank God"], literals: ["lit 1", "lit 2"] });
    return m3 ? partsReply(reply) : chatCompletion(reply);
  };
  const fn = await loadFunction("analyze-gulf-arabic", {
    env: NODE_ENV,
    upstreams: allowed({
      "openrouter.ai": drafters,
      "generativelanguage.googleapis.com": drafters,
      "node.humain.test": drafters,
      "/rest/v1/discover_videos": (request) =>
        request.method === "GET"
          ? json({ transcription_status: "processing", engines_used: null }, 200)
          : json([{ id: PIPELINE_VIDEO }], 200),
      "/rest/v1/processed_videos": () => json({}, 201),
      "/functions/v1/process-approved-video": () => json({ success: true }, 202),
    }),
  });
  try {
    const response = await fn.handler(jsonRequest("analyze-gulf-arabic", {
      transcript: "وينك اليوم الحمد لله بخير",
      videoId: PIPELINE_VIDEO,
    }, { jwt: SERVICE_ROLE_KEY }));
    assertEquals(response.status, 200);
    const body = await response.json() as { result?: { lines?: Array<{ translation: string; needs_review?: boolean }> } };
    await fn.background();
    // M3 and Gemini agree, so the line is theirs — which is only possible if
    // M3's parts reply was read as the text it carried.
    assertEquals(body.result?.lines?.[0].translation, "Where have you been");
    const save = fn.calls.find((c) => c.url.includes("discover_videos") && c.method === "PATCH" && c.body?.includes("analysis_complete"));
    const patch = JSON.parse(save?.body ?? "{}") as {
      engines_used: { translation?: { degraded?: boolean; tiers?: Array<{ name: string; status: string; lines_won: number }> } };
    };
    const m3 = patch.engines_used.translation?.tiers?.find((t) => t.name === "humain/humain-m3");
    assertEquals(m3?.status, "ok");
    assertEquals(m3?.lines_won, 2);
    assertEquals(patch.engines_used.translation?.degraded, false);
  } finally {
    fn.restore();
  }
});

Deno.test("an Arabic-native peer refused by its guardrail is a failed tier whose row says so", async () => {
  // The limited preview's alignment guardrail answers a 200 with no content
  // and a `refusal`. Before this the drafter row for that was `failed` with
  // no error at all, indistinguishable from a dropped connection — and the
  // fix for a refusal (research-preview access on Node) is nothing like the
  // fix for a timeout.
  const refusal = () =>
    json({
      id: "chatcmpl-refused",
      object: "chat.completion",
      choices: [{
        index: 0,
        finish_reason: "content_filter",
        message: { role: "assistant", content: null, refusal: "I cannot help with that request." },
      }],
    });
  const drafters: UpstreamHandler = async (request) => {
    const body = JSON.parse(await request.clone().text()) as { model: string; messages: Array<{ content: string }> };
    if (body.model.includes("humain")) return refusal();
    if (!asksForTranslations(body)) return analysisReply();
    return chatCompletion(JSON.stringify({ translations: ["Where were you", "Fine, thank God"], literals: ["lit 1", "lit 2"] }));
  };
  const fn = await loadFunction("analyze-gulf-arabic", {
    env: NODE_ENV,
    upstreams: allowed({
      "openrouter.ai": drafters,
      "generativelanguage.googleapis.com": drafters,
      "node.humain.test": drafters,
      "/rest/v1/discover_videos": (request) =>
        request.method === "GET"
          ? json({ transcription_status: "processing", engines_used: null }, 200)
          : json([{ id: PIPELINE_VIDEO }], 200),
      "/rest/v1/processed_videos": () => json({}, 201),
      "/functions/v1/process-approved-video": () => json({ success: true }, 202),
    }),
  });
  try {
    const response = await fn.handler(jsonRequest("analyze-gulf-arabic", {
      transcript: "وينك اليوم الحمد لله بخير",
      videoId: PIPELINE_VIDEO,
    }, { jwt: SERVICE_ROLE_KEY }));
    assertEquals(response.status, 200);
    const body = await response.json() as { result?: { lines?: Array<{ translation: string }> } };
    await fn.background();
    // The generalists carry the transcript; the refusal costs nothing but the seat.
    assertEquals(body.result?.lines?.[0].translation, "Where were you");
    const save = fn.calls.find((c) => c.url.includes("discover_videos") && c.method === "PATCH" && c.body?.includes("analysis_complete"));
    const patch = JSON.parse(save?.body ?? "{}") as {
      engines_used: {
        translation?: {
          degraded?: boolean;
          active_models?: number;
          configured_models?: number;
          tiers?: Array<{ name: string; status: string; error?: string }>;
        };
      };
    };
    const translation = patch.engines_used.translation;
    const m3 = translation?.tiers?.find((t) => t.name === "humain/humain-m3");
    assertEquals(m3?.status, "failed");
    assert(m3?.error?.includes("finish_reason=content_filter"), `row names the guardrail: ${m3?.error}`);
    assert(m3?.error?.includes("refusal="), `row carries the refusal text: ${m3?.error}`);
    assertEquals(translation?.degraded, true);
    assertEquals(translation?.active_models, 3);
    assertEquals(translation?.configured_models, 4);
  } finally {
    fn.restore();
  }
});

Deno.test("a drafter that answered only some lines still judges the disputes it was no party to", async () => {
  // Three lines. The generalists split on lines 1 and 3 and agree on 2. M3's
  // reply stops after line 1, so on line 1 it is a party to the dispute and
  // on line 3 it is a genuine third opinion. With no Jais or Fanar behind
  // it, skipping M3 wholesale would leave line 3 with no Arabic judge at all.
  const threeLines = () =>
    chatCompletion(JSON.stringify({
      lines: [{ arabic: "شلونك اليوم" }, { arabic: "الحمد لله بخير" }, { arabic: "وينك أمس" }],
      dialect: "Gulf", difficulty: "Beginner", vocabulary: [], grammarPoints: [], culturalContext: "",
    }));
  const drafters: UpstreamHandler = async (request) => {
    const body = JSON.parse(await request.clone().text()) as { model: string; messages: Array<{ content: string }> };
    const user = body.messages?.[1]?.content ?? "";
    if (body.messages?.[0]?.content?.includes("native speaker of")) {
      // Pick B on whichever lines the judge was shown.
      const shown = [...user.matchAll(/Line (\d+):/g)].map((m) => Number(m[1]));
      return chatCompletion(JSON.stringify({ choices: shown.map((line) => ({ line, pick: "B", confidence: "high" })) }));
    }
    if (!asksForTranslations(body)) return body.model.includes("humain") ? chatCompletion('{"issues":[]}') : threeLines();
    const model = body.model;
    if (model.includes("humain")) {
      return chatCompletion(JSON.stringify({ translations: ["You good today"], literals: ["lit 1"] }));
    }
    const [first, third] = model.includes("gemini") ? ["What's up today", "Where were you yesterday"]
      : model.includes("qwen") ? ["How's it going today", "Where did you disappear to"]
      : ["How are you today", "Where'd you go yesterday"];
    return chatCompletion(JSON.stringify({ translations: [first, "Fine, thank God", third], literals: ["l1", "l2", "l3"] }));
  };
  const fn = await loadFunction("analyze-gulf-arabic", {
    env: NODE_ENV,
    upstreams: allowed({
      "openrouter.ai": drafters,
      "generativelanguage.googleapis.com": drafters,
      "node.humain.test": drafters,
      "/rest/v1/discover_videos": (request) =>
        request.method === "GET"
          ? json({ transcription_status: "processing", engines_used: null }, 200)
          : json([{ id: PIPELINE_VIDEO }], 200),
      "/rest/v1/processed_videos": () => json({}, 201),
      "/functions/v1/process-approved-video": () => json({ success: true }, 202),
    }),
  });
  try {
    const response = await fn.handler(jsonRequest("analyze-gulf-arabic", {
      transcript: "شلونك اليوم الحمد لله بخير وينك أمس",
      videoId: PIPELINE_VIDEO,
    }, { jwt: SERVICE_ROLE_KEY }));
    assertEquals(response.status, 200);
    const body = await response.json() as {
      result?: { lines?: Array<{ translation: string; needs_review?: boolean; resolved_by?: string }> };
    };
    await fn.background();

    // Line 3: M3 judged it and its pick (B, Gemini's) is the line.
    assertEquals(body.result?.lines?.[2].translation, "Where were you yesterday");
    assertEquals(body.result?.lines?.[2].needs_review, false);
    assertEquals(body.result?.lines?.[2].resolved_by, "humain/humain-m3→google/gemini-3.7-flash");
    // Line 1: M3 drafted it, nobody else is configured to judge, so it stays
    // as the ensemble left it — flagged, on the heaviest drafter listed first.
    assertEquals(body.result?.lines?.[0].translation, "How are you today");
    assertEquals(body.result?.lines?.[0].needs_review, true);
    assertEquals(body.result?.lines?.[0].resolved_by, undefined);

    // One judging call, and it was shown only the line M3 had no hand in.
    const m3Judging = fn.calls.filter((c) => c.url.includes("node.humain.test") && (c.body ?? "").includes("native speaker of"));
    assertEquals(m3Judging.length, 1);
    const user = (JSON.parse(m3Judging[0].body ?? "{}") as { messages: Array<{ content: string }> }).messages[1].content;
    assert(user.includes("Line 3:"), user);
    assert(!user.includes("Line 1:"), "M3 is not asked to judge a line it drafted");

    const save = fn.calls.find((c) => c.url.includes("discover_videos") && c.method === "PATCH" && c.body?.includes("analysis_complete"));
    const patch = JSON.parse(save?.body ?? "{}") as {
      engines_used: { translation?: { arabic_arbiter?: { model?: string; disputed_lines?: number; resolved?: number; unresolved?: number; skip_reason?: string; attempts?: Array<{ model: string; error: string }> } } };
    };
    const arbiter = patch.engines_used.translation?.arabic_arbiter;
    assertEquals(arbiter?.model, "humain/humain-m3");
    assertEquals(arbiter?.disputed_lines, 2);
    assertEquals(arbiter?.resolved, 1);
    assertEquals(arbiter?.unresolved, 1);
    assertEquals(arbiter?.skip_reason, undefined);
    // The row says why line 1 got no judge: M3 was skipped as its drafter.
    assertEquals(arbiter?.attempts?.map((a) => a.model), ["humain/humain-m3"]);
    assert(arbiter?.attempts?.[0].error.startsWith("skipped: drafted in this ensemble"), arbiter?.attempts?.[0].error);
  } finally {
    fn.restore();
  }
});

Deno.test("records why the arbitration produced nothing, naming the rungs that let it down", async () => {
  const fn = await loadFunction("analyze-gulf-arabic", {
    env: NODE_ENV,
    upstreams: allowed({
      "openrouter.ai": splitEnsemble,
      "generativelanguage.googleapis.com": splitEnsemble,
      // M3 is configured but this key's tier does not carry the model.
      "node.humain.test": () => json({ error: { code: "model_not_found" } }, 404),
      "/rest/v1/discover_videos": (request) =>
        request.method === "GET"
          ? json({ transcription_status: "processing", engines_used: null }, 200)
          : json([{ id: PIPELINE_VIDEO }], 200),
      "/rest/v1/processed_videos": () => json({}, 201),
      "/functions/v1/process-approved-video": () => json({ success: true }, 202),
    }),
  });
  try {
    const response = await fn.handler(jsonRequest("analyze-gulf-arabic", {
      transcript: "شلونك اليوم الحمد لله بخير",
      videoId: PIPELINE_VIDEO,
    }, { jwt: SERVICE_ROLE_KEY }));
    assertEquals(response.status, 200);
    await fn.background();
    // The final save: the dialect signals ride only on the post-enrichment
    // write, the pre-enrichment one carries the translation provenance alone.
    const save = fn.calls.filter((c) => c.url.includes("discover_videos") && c.method === "PATCH" && c.body?.includes("analysis_complete")).at(-1);
    const patch = JSON.parse(save?.body ?? "{}") as {
      engines_used: {
        translation?: { arabic_arbiter?: { skip_reason?: string; attempts?: Array<{ model: string; error: string }> } };
        dialect_signals?: { fanar_validation?: { attempts?: Array<{ model: string; error: string }> } | null };
      };
    };
    // A configured drafter that failed is a degraded ensemble, measured
    // against the four this deployment asked for — not against a fixed three.
    const health = patch.engines_used.translation as { degraded?: boolean; active_models?: number; configured_models?: number } | undefined;
    assertEquals(health?.configured_models, 4);
    assertEquals(health?.active_models, 3);
    assertEquals(health?.degraded, true);
    // "M3 didn't fire" is answerable from the row now: which rung, and what it said.
    const arbiter = patch.engines_used.translation?.arabic_arbiter;
    assertEquals(arbiter?.skip_reason, "no_usable_reply");
    assertEquals(arbiter?.attempts?.map((a) => a.model), ["humain/humain-m3"]);
    assert(arbiter?.attempts?.[0].error.startsWith("HTTP 404"), arbiter?.attempts?.[0].error);
    // The dialect check walked the same rung and found the same thing; with
    // nobody behind it there is no verdict to store, but the row still says
    // who was asked and what went wrong.
    const validation = patch.engines_used.dialect_signals?.fanar_validation;
    assertEquals(validation?.attempts?.map((a) => a.model), ["humain/humain-m3"]);
    assertEquals((validation as { model?: string } | null | undefined)?.model, undefined);
  } finally {
    fn.restore();
  }
});

Deno.test("wakes the deployed Jais worker as soon as a transcript run starts", async () => {
  const fn = await loadFunction("analyze-gulf-arabic", {
    env: { FANAR_API_KEY: undefined, RUNPOD_JAIS_8B_ENDPOINT_ID: "test1endpoint" },
    upstreams: allowed({
      "openrouter.ai": () => analysisReply(),
      "generativelanguage.googleapis.com": () => analysisReply(),
      "api.runpod.ai": () => chatCompletion('{"issues":[]}'),
    }),
  });
  try {
    const response = await fn.handler(jsonRequest("analyze-gulf-arabic", {
      transcript: "شلونك اليوم الحمد لله بخير",
    }));
    assertEquals(response.status, 200);
    await fn.background();
    // The one-token ping goes out before the merge, so the worker's boot
    // overlaps the minute or two the run spends before it has a question.
    const runpod = fn.calls.filter((c) => c.url.includes("api.runpod.ai"));
    assert(runpod.length >= 1, "expected the Jais worker to be pinged");
    assertEquals((JSON.parse(runpod[0].body ?? "{}") as { max_tokens?: number }).max_tokens, 1);
    const firstModelCall = fn.calls.findIndex((c) => c.url.includes("openrouter.ai"));
    const ping = fn.calls.indexOf(runpod[0]);
    assert(ping < firstModelCall, `the ping (call ${ping}) should precede the merge (call ${firstModelCall})`);
  } finally {
    fn.restore();
  }
});
