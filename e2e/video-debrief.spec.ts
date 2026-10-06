import { expect, test } from "./support/fixtures";
import { aDiscoverVideo, aProfile, aUserVocabulary, daysAgo, TEST_USER_ID, videoId, vocabId } from "../src/test/support/factories";
import { streaming, type FunctionContext } from "../src/test/support/server/functions";
import type { DebriefPlan } from "../src/lib/videoDebrief";

/**
 * The post-video debrief — talking a video through with the tutor once it has
 * been watched.
 *
 * Three surfaces: the way in under the video, the two marks the video page now
 * leaves behind (a saved word knows its video; a looked-up word is
 * remembered), and the session itself — a guided chat whose quiz is about the
 * learner's own words and whose answers reschedule those words' flashcards.
 * The tutor is a stub here; what is under test is the page's half of the
 * conversation: which step it is on, what it sends, which card comes when.
 */

const VIDEO = videoId(0);
const SAVED = vocabId(3);

const TRANSCRIPT = [
  {
    id: "l1",
    arabic: "والله تعبان شوي",
    translation: "Honestly I'm a bit tired",
    startMs: 0,
    endMs: 1800,
    tokens: [
      { id: "t1", surface: "والله", gloss: "honestly" },
      { id: "t2", surface: "تعبان", gloss: "tired" },
      { id: "t3", surface: "شوي", gloss: "a bit" },
    ],
  },
  { id: "l2", arabic: "ما نمت زين البارحة", translation: "I didn't sleep well last night", startMs: 1800, endMs: 4000 },
];

const PLAN: DebriefPlan = {
  video: { id: VIDEO, title: "A tired friend", dialect: "Gulf", cefrLevel: "A2" },
  level: "A2",
  steps: ["gist", "words", "recap"],
  quiz: [
    {
      id: "q1",
      arabic: "تعبان",
      english: "tired",
      source: "saved",
      vocabularyId: SAVED,
      lineId: "l1",
      sentence: "والله تعبان شوي",
      sentenceEnglish: "Honestly I'm a bit tired",
      options: ["happy", "tired", "late", "hungry"],
      answerIndex: 1,
    },
    {
      id: "q2",
      arabic: "البارحة",
      english: "last night",
      source: "looked_up",
      lineId: "l2",
      sentence: "ما نمت زين البارحة",
      options: ["tomorrow", "last night", "today"],
      answerIndex: 1,
    },
  ],
  shadow: [],
  marked: { saved: 1, lookedUp: 1 },
  questionCount: 2,
  preparedNow: false,
};

interface ChatBody {
  action: string;
  step?: string;
  messages?: Array<{ role: string; content: string }>;
}

/** A tutor that follows the script the real one is prompted with. */
function tutor({ body }: FunctionContext) {
  const request = body as ChatBody;
  if (request.action === "plan") return { status: 200, body: PLAN };
  const messages = request.messages ?? [];
  const last = messages.at(-1);
  switch (request.step) {
    case "gist":
      return last?.role === "user"
        ? streaming("Exactly — he ", "slept badly.\n[[STEP_DONE]]")
        : streaming("Let's talk it through. ", "Why is he tired?");
    case "words":
      return messages.some((m) => m.content.startsWith("(Quiz finished"))
        ? streaming("البارحة means last night. ", "[[STEP_DONE]]")
        : streaming("Quick quiz on the words you marked.");
    default:
      return streaming("- You got the gist.\n", "[[STEP_DONE]]");
  }
}

test.describe("the way in", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile()]);
    db.seed("discover_videos", [aDiscoverVideo({ id: VIDEO, transcript_lines: TRANSCRIPT })]);
  });

  test("sits under the video, marked as a paid feature for a free learner", async ({ page }) => {
    await page.goto(`/discover/${VIDEO}`);

    const card = page.getByRole("link", { name: /check what you understood/i });
    await expect(card).toHaveAttribute("href", `/debrief/${VIDEO}`);
    await expect(card.getByText("Premium")).toBeVisible();
  });

  test("leads a free learner to the paywall, not to an empty page", async ({ page, backend }) => {
    await page.goto(`/debrief/${VIDEO}`);

    await expect(page.getByText(/is a premium feature/i)).toBeVisible();
    // Nothing was prepared for someone who cannot use it.
    expect(backend.callsTo("video-debrief")).toHaveLength(0);
  });
});

test.describe("what the video page leaves behind", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile()]);
    db.seed("discover_videos", [aDiscoverVideo({ id: VIDEO, transcript_lines: TRANSCRIPT })]);
  });

  test("remembers a word the learner looked up", async ({ page, db }) => {
    await page.goto(`/discover/${VIDEO}`);

    await page.getByRole("button", { name: "تعبان" }).first().click();
    await expect(page.getByText("tired", { exact: true })).toBeVisible();

    await expect.poll(() => db.raw("video_word_lookups").length).toBe(1);
    expect(db.raw("video_word_lookups")[0]).toMatchObject({
      user_id: TEST_USER_ID,
      video_id: VIDEO,
      word_arabic: "تعبان",
      word_english: "tired",
      line_id: "l1",
    });
  });

  test("records which video a saved word came from", async ({ page, db }) => {
    await page.goto(`/discover/${VIDEO}`);

    await page.getByRole("button", { name: "تعبان" }).first().click();
    await page.getByRole("button", { name: /save to my words/i }).click();

    await expect.poll(() => db.raw("user_vocabulary").length).toBe(1);
    expect(db.raw("user_vocabulary")[0]).toMatchObject({ word_arabic: "تعبان", source: "discover", source_video_id: VIDEO });
  });
});

test.describe("a session", () => {
  test.beforeEach(async ({ signInAs, db, backend }) => {
    await signInAs("standard");
    db.seed("profiles", [aProfile()]);
    db.seed("discover_videos", [aDiscoverVideo({ id: VIDEO, title: "A tired friend", transcript_lines: TRANSCRIPT })]);
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
    backend.stubFunction("video-debrief", tutor);
  });

  test("walks the steps, quizzes the learner's own words, and reschedules the saved one", async ({
    page,
    db,
    backend,
  }) => {
    await page.goto(`/debrief/${VIDEO}`);

    // The tutor opens the first step on its own.
    await expect(page.getByText("Why is he tired?")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "The gist" })).toHaveAttribute("aria-current", "step");

    await page.getByRole("textbox", { name: "Your answer" }).fill("He didn't sleep");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Exactly — he slept badly.")).toBeVisible();
    // The marker never reaches the screen; it becomes the Continue button.
    await expect(page.getByText("[[STEP_DONE]]")).toHaveCount(0);
    await page.getByRole("button", { name: "Continue: Your words" }).click();

    // The words step: one line from the tutor, then the quiz card.
    await expect(page.getByText("Quick quiz on the words you marked.")).toBeVisible();
    await expect(page.getByText("You saved this")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Your answer" })).toBeDisabled();
    await page.getByRole("button", { name: "tired" }).click();
    await page.getByRole("button", { name: "Next word" }).click();
    await page.getByRole("button", { name: "tomorrow" }).click();
    await page.getByRole("button", { name: "Finish the quiz" }).click();

    await expect(page.getByText("Quiz: 1 of 2 right")).toBeVisible();
    await expect(page.getByText("البارحة means last night.")).toBeVisible();
    // The tutor heard what happened on the card, in the words its prompt expects.
    const reaction = backend.callsTo("video-debrief").at(-1)?.body as ChatBody;
    expect(reaction.step).toBe("words");
    expect(reaction.messages?.at(-1)?.content).toContain('Missed: البارحة (last night) — picked "tomorrow"');

    // The saved word was answered right: its card moved on, as a review would move it.
    await expect.poll(() => db.raw("user_vocabulary").find((r) => r.id === SAVED)?.repetitions).toBe(3);

    await page.getByRole("button", { name: "Continue: Recap" }).click();
    await expect(page.getByText("You got the gist.")).toBeVisible();
    await page.getByRole("button", { name: "Finish" }).click();

    const summary = page.getByTestId("debrief-summary");
    await expect(summary.getByText("Session complete")).toBeVisible();
    await expect(summary.getByText(/Keep working on/)).toContainText("last night");
    await expect(summary.getByRole("link", { name: "Back to the video" })).toHaveAttribute("href", `/discover/${VIDEO}`);

    // Talking the video through to the end is one of the moments the learner is
    // sung to, by the name they set.
    await expect.poll(() => backend.callsTo("generate-celebration-song").length, { timeout: 10_000 }).toBe(1);
    expect(backend.lastCallTo("generate-celebration-song")?.body).toMatchObject({
      name: "Test Learner",
      achievement: { kind: "review_conversation_complete" },
    });
  });

  test("lets the learner move on before the tutor says so", async ({ page }) => {
    await page.goto(`/debrief/${VIDEO}`);
    await expect(page.getByText("Why is he tired?")).toBeVisible();

    await page.getByRole("button", { name: "Skip to next step" }).click();

    await expect(page.getByText("Quick quiz on the words you marked.")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "The gist" }).getByLabel("Done")).toBeVisible();
  });

  test("says what is wrong when a video has nothing to talk about", async ({ page, backend }) => {
    backend.stubFunction("video-debrief", {
      status: 422,
      body: { error: "no_transcript", message: "This video has no transcript to talk about yet." },
    });
    await page.goto(`/debrief/${VIDEO}`);

    await expect(page.getByText("This video has no transcript to talk about yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Back to the video" }).last()).toBeVisible();
  });
});
