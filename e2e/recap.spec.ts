import { expect, test } from "./support/fixtures";
import { aProfile, aUserVocabulary, daysAgo, vocabId } from "../src/test/support/factories";
import { streaming, type FunctionContext } from "../src/test/support/server/functions";
import type { RecapPlan, RecapSummary } from "../src/lib/recap";

/**
 * The daily recap — going over yesterday with the tutor the next morning.
 *
 * Three surfaces: the strip at the bottom of every learner screen that
 * offers it (and the Today queue row beside it), the way a free learner is
 * turned away, and the session itself — a guided chat whose quiz is about
 * yesterday's words and whose answers reschedule those words' flashcards.
 * The tutor is a stub here; what is under test is the page's half of the
 * conversation: which step it is on, what it sends, which card comes when,
 * and what is recorded once it is over.
 */

const SAVED = vocabId(3);

const localDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const SUMMARY: RecapSummary = {
  date: localDate(),
  windowDays: 1,
  hasContent: true,
  counts: { videos: 1, words: 2, lookups: 0, slips: 0, lessons: 0, stories: 0, chats: 0 },
  headline: "Yesterday: 1 video, 2 new words",
  firstVideo: "A tired friend",
  status: "ready",
};

const PLAN: RecapPlan = {
  version: 1,
  date: localDate(),
  windowDays: 1,
  since: daysAgo(1),
  until: daysAgo(0),
  dialect: "Gulf",
  level: "A2",
  steps: ["yesterday", "words", "recap"],
  videos: [],
  quiz: [
    {
      id: "q1",
      arabic: "تعبان",
      english: "tired",
      source: "saved",
      vocabularyId: SAVED,
      sentence: "والله تعبان شوي",
      sentenceEnglish: "Honestly I'm a bit tired",
      options: ["happy", "tired", "late", "hungry"],
      answerIndex: 1,
      videoId: "v1",
      videoTitle: "A tired friend",
    },
    {
      id: "q2",
      arabic: "البارحة",
      english: "last night",
      source: "looked_up",
      sentence: "ما نمت زين البارحة",
      options: ["tomorrow", "last night", "today"],
      answerIndex: 1,
    },
  ],
  shadow: [],
  slips: [],
  lessons: [],
  stories: [],
  chats: [],
  challenge: null,
  openQuestions: [],
  counts: SUMMARY.counts,
  marked: { saved: 1, lookedUp: 1 },
  status: "ready",
  stored: true,
};

interface RecapBody {
  action: string;
  step?: string;
  messages?: Array<{ role: string; content: string }>;
  outcome?: { quiz: unknown[]; shadow: unknown[]; stepsDone: string[] };
}

/** A tutor that follows the script the real one is prompted with. */
function tutor({ body }: FunctionContext) {
  const request = body as RecapBody;
  if (request.action === "summary") return { status: 200, body: SUMMARY };
  if (request.action === "plan") return { status: 200, body: PLAN };
  if (request.action === "complete") return { status: 200, body: { stored: true } };
  const messages = request.messages ?? [];
  const last = messages.at(-1);
  switch (request.step) {
    case "yesterday":
      return last?.role === "user"
        ? streaming("That's the one — ", "the tired friend.\n[[STEP_DONE]]")
        : streaming("Yesterday you watched A tired friend ", "and saved two words. What do you remember of it?");
    case "words":
      return messages.some((m) => m.content.startsWith("(Quiz finished"))
        ? streaming("البارحة means last night. ", "[[STEP_DONE]]")
        : streaming("Quick quiz on yesterday's words.");
    default:
      return streaming("- You remembered the clip.\n", "[[STEP_DONE]]");
  }
}

test.describe("the strip", () => {
  test.beforeEach(async ({ signInAs, db, backend }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile()]);
    backend.stubFunction("daily-recap", tutor);
  });

  test("offers yesterday's recap on the dashboard, and the queue lists it too", async ({ page }) => {
    await page.goto("/today");

    const strip = page.getByTestId("recap-nudge");
    await expect(strip).toBeVisible();
    await expect(strip.getByText("Yesterday: 1 video, 2 new words")).toBeVisible();
    await expect(strip.getByRole("link", { name: /recap/i })).toHaveAttribute("href", "/recap");
    await expect(page.getByText("Yesterday's recap")).toBeVisible();
  });

  test("goes away for the day when waved off, and stays away", async ({ page }) => {
    await page.goto("/today");
    const strip = page.getByTestId("recap-nudge");
    await expect(strip).toBeVisible();

    await strip.getByRole("button", { name: "Not now" }).click();
    await expect(strip).toHaveCount(0);

    await page.reload();
    await expect(page.getByText("Yesterday's recap")).toBeVisible();
    await expect(page.getByTestId("recap-nudge")).toHaveCount(0);
  });

  test("stays off an immersive screen", async ({ page }) => {
    await page.goto("/today/story");

    await expect(page.getByRole("heading").first()).toBeVisible();
    await expect(page.getByTestId("recap-nudge")).toHaveCount(0);
  });

  test("leads a free learner to the paywall, not to an empty page", async ({ page, backend }) => {
    await page.goto("/recap");

    await expect(page.getByText(/is a premium feature/i)).toBeVisible();
    // Nothing was prepared for someone who cannot use it, and the strip does
    // not ask for a summary on the recap's own page.
    expect(backend.callsTo("daily-recap")).toHaveLength(0);
  });
});

test.describe("a session", () => {
  test.beforeEach(async ({ signInAs, db, backend }) => {
    await signInAs("standard");
    db.seed("profiles", [aProfile()]);
    db.seed("user_vocabulary", [
      aUserVocabulary({
        id: SAVED,
        word_arabic: "تعبان",
        word_english: "tired",
        source: "discover",
        repetitions: 2,
        interval_days: 3,
        last_reviewed_at: daysAgo(3),
        next_review_at: daysAgo(0),
      }),
    ]);
    backend.stubFunction("daily-recap", tutor);
  });

  test("walks the steps, quizzes yesterday's words, reschedules the saved one and records the session", async ({
    page,
    db,
    backend,
  }) => {
    await page.goto("/recap");

    // The tutor opens the first step on its own, from the learner's notes.
    await expect(page.getByText("What do you remember of it?")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Your day" })).toHaveAttribute("aria-current", "step");
    const opening = backend.callsTo("daily-recap").find((c) => (c.body as RecapBody).action === "chat")?.body as RecapBody;
    expect(opening.step).toBe("yesterday");
    expect(opening.messages).toEqual([]);

    await page.getByRole("textbox", { name: "Your answer" }).fill("The tired friend");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("That's the one — the tired friend.")).toBeVisible();
    // The marker never reaches the screen; it becomes the Continue button.
    await expect(page.getByText("[[STEP_DONE]]")).toHaveCount(0);
    await page.getByRole("button", { name: "Continue: Your words" }).click();

    // The words step: one line from the tutor, then the quiz card.
    await expect(page.getByText("Quick quiz on yesterday's words.")).toBeVisible();
    await expect(page.getByText("You saved this")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Your answer" })).toBeDisabled();
    await page.getByRole("button", { name: "tired" }).click();
    await page.getByRole("button", { name: "Next word" }).click();
    await page.getByRole("button", { name: "tomorrow" }).click();
    await page.getByRole("button", { name: "Finish the quiz" }).click();

    await expect(page.getByText("Quiz: 1 of 2 right")).toBeVisible();
    await expect(page.getByText("البارحة means last night.")).toBeVisible();
    // The tutor heard what happened on the card, in the words its prompt expects.
    const reaction = backend.callsTo("daily-recap").at(-1)?.body as RecapBody;
    expect(reaction.step).toBe("words");
    expect(reaction.messages?.at(-1)?.content).toContain('Missed: البارحة (last night) — picked "tomorrow"');

    // The saved word was answered right: its card moved on, as a review would move it.
    await expect.poll(() => db.raw("user_vocabulary").find((r) => r.id === SAVED)?.repetitions).toBe(3);

    await page.getByRole("button", { name: "Continue: Recap" }).click();
    await expect(page.getByText("You remembered the clip.")).toBeVisible();
    await page.getByRole("button", { name: "Finish" }).click();

    const summary = page.getByTestId("recap-summary");
    await expect(summary.getByText("Recap complete")).toBeVisible();
    await expect(summary.getByText(/Keep working on/)).toContainText("last night");

    // The session is on record: what the cards said, and how far it got.
    await expect
      .poll(() => backend.callsTo("daily-recap").some((c) => (c.body as RecapBody).action === "complete"))
      .toBe(true);
    const completion = backend.callsTo("daily-recap").find((c) => (c.body as RecapBody).action === "complete")?.body as RecapBody;
    expect(completion.outcome?.quiz).toHaveLength(2);
    expect(completion.outcome?.stepsDone).toEqual(["yesterday", "words", "recap"]);
    // And the day's queue ticks it off, so the strip stays away.
    const done = await page.evaluate((date) => window.localStorage.getItem(`today.completed.${date}`), localDate());
    expect(JSON.parse(done ?? "[]")).toContain("recap");
  });

  test("lets the learner move on before the tutor says so", async ({ page }) => {
    await page.goto("/recap");
    await expect(page.getByText("What do you remember of it?")).toBeVisible();

    await page.getByRole("button", { name: "Skip to next step" }).click();

    await expect(page.getByText("Quick quiz on yesterday's words.")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Your day" }).getByLabel("Done")).toBeVisible();
  });

  test("says so when there is nothing to go over yet", async ({ page, backend }) => {
    backend.stubFunction("daily-recap", {
      status: 422,
      body: { error: "nothing_to_recap", message: "Nothing to go over yet — watch a clip or save a few words first." },
    });
    await page.goto("/recap");

    await expect(page.getByText("Nothing to go over yet — watch a clip or save a few words first.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Watch a clip" })).toHaveAttribute("href", "/discover");
  });
});
