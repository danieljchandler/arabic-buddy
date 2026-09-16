import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadSharedModule, stubUpstreams, type StubbedUpstreams } from "./harness.ts";
import { chatCompletion } from "./upstreams.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";

/**
 * The post-stream native review of the assistant's own Arabic.
 *
 * The Ask AI chat is the one learner-facing path whose Arabic nothing checks:
 * `askBrain` validates before it ships a draft, and a stream has been read by
 * the time anyone could. This module is what closes that, by asking the
 * Arabic-native roster about the finished reply and appending what it would
 * have said instead.
 *
 * Almost every test here is about the feature staying *quiet*. It runs while a
 * learner is reading an answer that has already been delivered, so every way it
 * can fail — no judge configured, a refusal, an unreadable reply, a suggestion
 * identical to the text — has to end as silence rather than as a note. A
 * reviewer that is wrong in public costs more than the one it corrects.
 */

const FANAR_HOST = "api.fanar.qa";
const OPENROUTER = "openrouter.ai";
const GATEWAY = "generativelanguage.googleapis.com/v1beta/openai";

interface ReviewCorrection {
  arabic: string;
  suggestion: string;
  note: string;
  kind: "msa" | "dialect";
}

interface NativeReviewFrame {
  type: "native_review";
  model: string;
  corrections: ReviewCorrection[];
}

interface ReviewModule {
  reviewArabicNatively: (req: {
    text: string;
    dialect: string;
    sources?: string[];
    signal?: AbortSignal;
    timeoutMs?: number;
  }) => Promise<NativeReviewFrame | null>;
}

async function withReview(
  run: (mod: ReviewModule, up: StubbedUpstreams) => Promise<void>,
  options: { env?: Record<string, string | undefined>; upstreams?: Record<string, () => Response> } = {},
): Promise<void> {
  const up = stubUpstreams({ env: options.env, upstreams: options.upstreams });
  try {
    await run(await loadSharedModule<ReviewModule>("arabicReview"), up);
  } finally {
    up.restore();
  }
}

/** A judge's reply: one line flagged, the rest fine. */
const flagged = (over: Partial<Record<string, unknown>> = {}) =>
  chatCompletion(JSON.stringify([
    { id: 1, verdict: "msa", suggestion: "شلونك", note: "MSA greeting", ...over },
  ]));

const REPLY = "In Gulf you could say كيف حالك to greet someone.";

Deno.test("a flagged line comes back as a correction, attributed to the judge", async () => {
  await withReview(async (mod) => {
    const review = await mod.reviewArabicNatively({ text: REPLY, dialect: "Gulf" });

    assert(review);
    assertEquals(review.type, "native_review");
    // Fanar is the only rung a default deployment can route: no HUMAIN key and
    // no RunPod endpoint id, which is exactly the shape of the environments
    // this ships to first.
    assertEquals(review.model, MODEL_IDS.FANAR);
    assertEquals(review.corrections, [
      { arabic: "كيف حالك", suggestion: "شلونك", note: "MSA greeting", kind: "msa" },
    ]);
  }, { upstreams: { [FANAR_HOST]: () => flagged() } });
});

Deno.test("a reply with nothing wrong in it produces no note at all", async () => {
  await withReview(async (mod) => {
    assertEquals(await mod.reviewArabicNatively({ text: REPLY, dialect: "Gulf" }), null);
  }, { upstreams: { [FANAR_HOST]: () => chatCompletion("[]") } });
});

Deno.test("Arabic quoted from the page is never sent to the judge", async () => {
  // The learner is watching a clip; the tutor quotes its transcript line and
  // adds its own phrasing. The transcript is a native speaker's own words —
  // "correcting" it would have the app telling the learner that the video is
  // wrong.
  const page = "▶ 00:12 — وش تسوي هني؟";
  const reply = "The line وش تسوي هني؟ means 'what are you doing here'. You could also say كيف حالك.";

  await withReview(async (mod, up) => {
    await mod.reviewArabicNatively({ text: reply, dialect: "Gulf", sources: [page] });

    const sent = up.callsTo(FANAR_HOST)[0]?.body ?? "";
    assert(sent.includes("كيف حالك"), "the tutor's own Arabic is what gets judged");
    assert(!sent.includes("وش تسوي"), "the transcript line must not be up for review");
  }, { upstreams: { [FANAR_HOST]: () => flagged() } });
});

Deno.test("a reply with no Arabic in it never reaches a judge", async () => {
  await withReview(async (mod, up) => {
    const review = await mod.reviewArabicNatively({
      text: "Word order here is verb-subject-object.",
      dialect: "Gulf",
    });

    assertEquals(review, null);
    assertEquals(up.callsTo(FANAR_HOST).length, 0);
  }, { upstreams: { [FANAR_HOST]: () => flagged() } });
});

Deno.test("a suggestion identical to the text is dropped rather than shown", async () => {
  // Same words back, differently voweled. Rendered, it teaches the learner that
  // the reviewer is noise — and the next real correction is read as noise too.
  await withReview(async (mod) => {
    assertEquals(await mod.reviewArabicNatively({ text: REPLY, dialect: "Gulf" }), null);
  }, {
    upstreams: {
      [FANAR_HOST]: () =>
        chatCompletion(JSON.stringify([
          { id: 1, verdict: "msa", suggestion: "كِيْفَ حَالَك", note: "say it this way" },
        ])),
    },
  });
});

Deno.test("a judge that answers in prose is a failed rung, not a verdict", async () => {
  await withReview(async (mod, up) => {
    const review = await mod.reviewArabicNatively({ text: REPLY, dialect: "Gulf" });

    assertEquals(review, null);
    // It was asked — the walk simply had nobody behind it to fall through to.
    assertEquals(up.callsTo(FANAR_HOST).length, 1);
  }, {
    upstreams: {
      [FANAR_HOST]: () => chatCompletion("The greeting reads as Modern Standard Arabic to me."),
    },
  });
});

Deno.test("no Arabic-native model configured means no note, not an error", async () => {
  await withReview(async (mod, up) => {
    assertEquals(await mod.reviewArabicNatively({ text: REPLY, dialect: "Gulf" }), null);
    assertEquals(up.callsTo(FANAR_HOST).length, 0);
  }, { env: { FANAR_API_KEY: undefined } });
});

Deno.test("CHAT_NATIVE_REVIEW=off switches it off without a deploy", async () => {
  await withReview(async (mod, up) => {
    assertEquals(await mod.reviewArabicNatively({ text: REPLY, dialect: "Gulf" }), null);
    assertEquals(up.callsTo(FANAR_HOST).length, 0);
    assertEquals(up.callsTo(OPENROUTER).length, 0);
    assertEquals(up.callsTo(GATEWAY).length, 0);
  }, { env: { CHAT_NATIVE_REVIEW: "off" }, upstreams: { [FANAR_HOST]: () => flagged() } });
});

Deno.test("an upstream failure is silence, because the answer has already shipped", async () => {
  await withReview(async (mod) => {
    assertEquals(await mod.reviewArabicNatively({ text: REPLY, dialect: "Gulf" }), null);
  }, { upstreams: { [FANAR_HOST]: () => new Response("upstream on fire", { status: 500 }) } });
});
