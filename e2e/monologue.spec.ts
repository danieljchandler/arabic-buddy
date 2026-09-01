import { expect, test } from "./support/fixtures";
import { aMonologueAttempt, TEST_USER_ID } from "../src/test/support/factories";
import type { Page } from "@playwright/test";
import type { SupabaseBackend } from "../src/test/support/server/handler";

/**
 * Monologue — free speech, measured over time.
 *
 * Chromium runs with `--use-fake-device-for-media-stream`, so the whole
 * capture path is real: `getUserMedia` resolves, `MediaRecorder` produces an
 * actual WebM/Opus blob, and only `score-monologue` is stubbed. What matters
 * here is different from the pronunciation page: there is deliberately NO
 * score and no pass/fail anywhere on this page — the product is the prompt,
 * the take, the raw measures, and the trend against the learner's own earlier
 * attempts. A spec that asserted a score would be asserting a thing the
 * research review says we must not build.
 */

/**
 * Record one take and wait for it to reach the scorer.
 *
 * The pause between start and stop is load-bearing twice over: the recorder
 * needs at least one 1s timeslice flushed, and the hook refuses blobs under
 * 4KB as "we didn't hear anything" — stopping too early would assert a toast
 * rather than a scoring call.
 */
async function recordTake(page: Page, backend: SupabaseBackend) {
  const before = backend.callsTo("score-monologue").length;
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByRole("button", { name: "Stop recording" })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect
    .poll(() => backend.callsTo("score-monologue").length, { timeout: 15_000 })
    .toBeGreaterThan(before);
}

test.describe("arriving", () => {
  test("greets the learner with a prompt and a level-scaled target", async ({
    page,
    signInAs,
  }) => {
    await signInAs("free");

    await page.goto("/monologue");

    // The default stub serves the Gulf fallback bank.
    await expect(page.getByText("وش سويت اليوم من الصبح؟ احكي لي عن يومك")).toBeVisible();
    // No placement on the default profile → the beginner spec. A learner with
    // no placement must never see the advanced 4-minute ask.
    await expect(page.getByText("aim for ~0:45")).toBeVisible();
    // Targets are aims, not gates — the page says so where the learner reads it.
    await expect(page.getByText(/Pauses are fine/)).toBeVisible();
  });

  test("keeps the translation behind a toggle so the prompt is met in Arabic", async ({
    page,
    signInAs,
  }) => {
    await signInAs("free");
    await page.goto("/monologue");
    await expect(page.getByText("وش سويت اليوم من الصبح؟ احكي لي عن يومك")).toBeVisible();

    await expect(page.getByText("What have you done today since morning?", { exact: false })).toBeHidden();
    await page.getByRole("button", { name: "Show translation" }).click();
    await expect(page.getByText("What have you done today since morning?", { exact: false })).toBeVisible();
  });
});

test.describe("recording", () => {
  test("captures a take, measures it, and moves the trend", async ({
    page,
    signInAs,
    backend,
  }) => {
    await signInAs("free");
    await page.goto("/monologue");
    await expect(page.getByText("وش سويت اليوم من الصبح؟ احكي لي عن يومك")).toBeVisible();

    await recordTake(page, backend);

    // The transcript and raw measures, never a score: no percentage, no
    // pass/fail — there are no Arabic norms to band against.
    await expect(page.getByText("What we heard")).toBeVisible();
    await expect(page.getByText("مرحبا شباب اليوم بروح السوق").first()).toBeVisible();
    await expect(page.getByText("Speech rate (syl/s)").first()).toBeVisible();
    await expect(page.getByText("Words per run (words)").first()).toBeVisible();

    // The scorer got what it needs to store the attempt honestly.
    const call = backend.callsTo("score-monologue").at(-1);
    const body = call?.body as Record<string, unknown>;
    expect(typeof body.audioBase64).toBe("string");
    expect((body.audioBase64 as string).length).toBeGreaterThan(0);
    expect(body.dialect).toBe("Gulf");
    expect(typeof body.durationMs).toBe("number");
    expect(body.promptText).toBe("وش سويت اليوم من الصبح؟ احكي لي عن يومك");

    // The stub persisted the attempt into the same in-memory database the
    // trend query reads, so the trend section now exists.
    await expect(page.getByText("Your trend")).toBeVisible();

    // The content pass: one encouraging line and ONE repaired span of the
    // learner's own words — salience, not a red-pen sweep.
    await expect(page.getByText("A clear little story — one phrase to polish.")).toBeVisible();
    await expect(page.getByText("One thing to polish")).toBeVisible();
    await expect(page.getByText("بروح للسوق")).toBeVisible();
  });

  test("calls out a fossil the learner just used", async ({ page, signInAs, db, backend }) => {
    await signInAs("free");
    // شباب is on the learner's unresolved mistake list — and in the take.
    db.seed("learner_errors", [
      {
        id: "eeeeeeee-5555-4000-8000-000000000001",
        user_id: TEST_USER_ID,
        dialect: "Gulf",
        source: "pronunciation",
        error_kind: "mispronunciation",
        target_arabic: "شباب",
        produced_arabic: null,
        detail: {},
        word_id: null,
        user_vocabulary_id: null,
        resolved_at: null,
        created_at: new Date().toISOString(),
      },
    ]);
    await page.goto("/monologue");
    await expect(page.getByText("وش سويت اليوم من الصبح؟ احكي لي عن يومك")).toBeVisible();

    await recordTake(page, backend);

    // Fossils persist because they go unnoticed; naming one the learner just
    // said is the noticing the wild never supplies.
    await expect(page.getByText(/From your mistake list, you used:/)).toBeVisible();
    await expect(page.getByText("شباب").first()).toBeVisible();
  });
});

test.describe("the trend view", () => {
  test("charts stored attempts against the learner's own history", async ({
    page,
    signInAs,
    db,
  }) => {
    await signInAs("free");
    // Three attempts with speech rate climbing 1.8 → 2.1 → 2.9.
    db.seed(
      "monologue_attempts",
      [1.8, 2.1, 2.9].map((rate, i) =>
        aMonologueAttempt({
          id: `mono-${i}`,
          metrics: {
            speechRateSylPerSec: rate,
            articulationRateSylPerSec: 5,
            meanLengthOfRunWords: 2,
            pausesPerMinute: 20,
          },
          created_at: new Date(Date.now() - (3 - i) * 86_400_000).toISOString(),
        }),
      ),
    );

    await page.goto("/monologue");

    await expect(page.getByText("Your trend")).toBeVisible();
    await expect(page.getByText(/Last 3 attempts/)).toBeVisible();
    // The latest value, and the direction against the learner's own mean —
    // 2.9 beats the 1.95 average, so speech rate reads as improving.
    await expect(page.getByText("2.9")).toBeVisible();
    await expect(page.getByLabel("improving").first()).toBeVisible();
  });

  test("shows no trend section before there is anything to compare", async ({
    page,
    signInAs,
  }) => {
    await signInAs("free");

    await page.goto("/monologue");
    await expect(page.getByText("وش سويت اليوم من الصبح؟ احكي لي عن يومك")).toBeVisible();

    // A trend against nothing invites reading noise as progress.
    await expect(page.getByText("Your trend")).toBeHidden();
  });
});
