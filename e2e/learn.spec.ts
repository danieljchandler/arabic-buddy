import { expect, test, type Page } from "./support/fixtures";
import {
  aLesson,
  aLessonProgress,
  aStage,
  aVocabularyWord,
  aWordReview,
  daysAgo,
  lessonId,
  many,
  reviewId,
  stageId,
  wordId,
} from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * The lesson runner and the standalone quiz.
 *
 * `/learn/:id` alternates an intro card with a quiz card for each word, records
 * an SRS review per answer, and saves how far through the learner got. The
 * resume logic is the delicate part: `hasResumed` gates the progress write so
 * that mounting at index 0 cannot overwrite a saved position before the restore
 * runs. Getting that wrong loses a learner's place silently, which is why the
 * specs drive a real partial session and then revisit.
 *
 * The intro card is production-first by design — it shows the English and hides
 * the Arabic behind "Show Arabic", so the learner tries to produce it before
 * seeing it. Cards are therefore located by their English text and by the
 * progress counter, not by the Arabic.
 *
 * Answers are asserted against `word_reviews` because a lesson answer is also a
 * scheduling decision: a wrong word id there corrupts the review deck.
 */

const LESSON = lessonId(0);

/** A lesson with `count` words, plus the stage it belongs to. */
function seedLesson(db: MemoryDb, count = 4, over: Record<string, unknown> = {}) {
  db.seed("curriculum_stages", [aStage({ id: stageId(0) })]);
  db.seed("lessons", [aLesson({ id: LESSON, stage_id: stageId(0), ...over })]);
  db.seed(
    "vocabulary_words",
    many(aVocabularyWord, count, (index) => ({
      id: wordId(index),
      lesson_id: LESSON,
      topic_id: null,
      word_arabic: `كلمة${index + 1}`,
      word_english: `word ${index + 1}`,
      display_order: index,
    })),
  );
  db.seed("word_reviews", []);
  db.seed("lesson_progress", []);
}

/**
 * Words met before the block is tested — mirrors LESSON_BLOCK_SIZE in
 * src/lib/lessonFlow.ts. A lesson introduces a block of words and only then
 * quizzes them, in a different order, so that answering is recall rather than
 * reading back what is still on screen.
 */
const BLOCK = 4;

/** The "N / total learned" counter under the card. Counts words *answered*. */
const learned = (page: Page, count: number, total: number) =>
  expect(page.getByText(`${count} / ${total} learned`)).toBeVisible();

/**
 * Meet every word in the current block, ending on its first quiz card.
 *
 * The button says "Next Word" until the last introduction, which promises the
 * quiz — the label is derived from the flow, so clicking through in this order
 * is also an assertion that it tells the truth.
 */
async function introduceBlock(page: Page, size = BLOCK) {
  for (let i = 0; i < size - 1; i++) {
    await page.getByRole("button", { name: /next word/i }).click();
  }
  await page.getByRole("button", { name: /continue to quiz/i }).click();
}

/**
 * Which word the intro card is showing, 1-based.
 *
 * Read from the English: the intro card deliberately keeps the Arabic hidden
 * until the learner asks for it, so there is no Arabic on screen to read.
 */
async function introducedWord(page: Page): Promise<number> {
  const english = await page.getByText(/^word \d+$/).first().textContent();
  return Number((english ?? "").replace(/\D/g, ""));
}

/**
 * Wait for a quiz card that can actually be answered.
 *
 * An answered card disables its options and holds for a beat so the learner
 * reads the result, so back-to-back answers would otherwise click the spent
 * card and time out on it.
 */
async function liveQuizCard(page: Page) {
  await expect(page.getByRole("radio").first()).toBeEnabled();
}

/** Which word the quiz is asking about right now, 1-based. */
async function askedWord(page: Page): Promise<number> {
  await liveQuizCard(page);
  const arabic = await page.getByText(/^كلمة\d+$/).first().textContent();
  return Number((arabic ?? "").replace(/\D/g, ""));
}

/**
 * Answer the quiz card on screen correctly, whichever word it is.
 *
 * The block's order is shuffled, so a test can no longer assume it. Reading
 * the prompt is what a learner does anyway.
 *
 * The options are `role="radio"`, not buttons — QuizCard wraps them in a
 * radiogroup so a screen reader announces them as one choice rather than four
 * unrelated actions.
 */
async function answerShown(page: Page): Promise<number> {
  const n = await askedWord(page);
  await page.getByRole("radio", { name: `word ${n}`, exact: true }).click();
  return n;
}

/** Miss the card on screen, then acknowledge the correction. */
async function missShown(page: Page): Promise<number> {
  const n = await askedWord(page);
  const wrong = n === 1 ? 2 : 1;
  await page.getByRole("radio", { name: `word ${wrong}`, exact: true }).click();
  await page.getByRole("button", { name: /^continue$/i }).click();
  return n;
}

/** Introduce and then correctly answer a whole block. */
async function completeBlock(page: Page, size = BLOCK): Promise<number[]> {
  await introduceBlock(page, size);
  const asked: number[] = [];
  for (let i = 0; i < size; i++) asked.push(await answerShown(page));
  return asked;
}

test.describe("working through a lesson", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedLesson(db, 4);
  });

  test("opens on the first word in its authored order", async ({ page }) => {
    await page.goto(`/learn/${LESSON}`);

    await expect(page.getByText("word 1", { exact: true })).toBeVisible();
    await learned(page, 0, 4);
  });

  test("keeps the Arabic hidden until the learner asks for it", async ({ page }) => {
    await page.goto(`/learn/${LESSON}`);
    await expect(page.getByText(/try saying it in Arabic/i)).toBeVisible();

    // Production-first: showing the Arabic straight away turns a recall attempt
    // into a reading exercise.
    await expect(page.getByText("كلمة1")).toHaveCount(0);
    await page.getByRole("button", { name: /show arabic/i }).click();
    await expect(page.getByText("كلمة1")).toBeVisible();
  });

  test("shows the word's root once the Arabic is revealed, and not before", async ({ page, db }) => {
    db.seed("vocabulary_words", [
      aVocabularyWord({
        id: wordId(0),
        lesson_id: LESSON,
        topic_id: null,
        word_arabic: "كتاب",
        word_english: "book",
        display_order: 0,
        // Stored with hyphens, as one of the AI paths writes it — the display
        // canonicalises whatever spelling reached the column.
        root: "ك-ت-ب",
      }),
    ]);

    await page.goto(`/learn/${LESSON}`);
    // The root is a strong clue to the meaning, and the learner is being asked
    // to produce the word from the picture.
    await expect(page.getByText("ك · ت · ب")).toHaveCount(0);

    await page.getByRole("button", { name: /show arabic/i }).click();

    await expect(page.getByText("ك · ت · ب")).toBeVisible();
  });

  test("shows no root chip for a word that has none", async ({ page, db }) => {
    db.seed("vocabulary_words", [
      aVocabularyWord({
        id: wordId(0),
        lesson_id: LESSON,
        topic_id: null,
        word_arabic: "كمبيوتر",
        word_english: "computer",
        display_order: 0,
        root: null,
      }),
    ]);

    await page.goto(`/learn/${LESSON}`);
    await page.getByRole("button", { name: /show arabic/i }).click();

    // Most curriculum words have no root until an admin backfills them, so an
    // empty chip would be the normal case rather than the exception.
    await expect(page.getByTitle("Arabic root")).toHaveCount(0);
  });

  test("asks for the English once the block's quiz starts", async ({ page }) => {
    await page.goto(`/learn/${LESSON}`);
    await introduceBlock(page);

    await expect(page.getByText(/what does this mean in English/i)).toBeVisible();
    await expect(page.getByRole("radiogroup")).toBeVisible();
    // The Arabic is the prompt now, so it is shown whether or not it was
    // revealed on the intro card — and it is one of the block's words.
    expect(await askedWord(page)).toBeGreaterThan(0);
  });

  test("never opens a quiz on the word just introduced", async ({ page }) => {
    // The reason blocks exist: answering the word still on screen is reading,
    // not recall, and it was being written to FSRS as a confident success.
    await page.goto(`/learn/${LESSON}`);
    for (let i = 0; i < BLOCK - 1; i++) {
      await page.getByRole("button", { name: /next word/i }).click();
    }
    const lastIntroduced = await introducedWord(page);
    await page.getByRole("button", { name: /continue to quiz/i }).click();

    expect(await askedWord(page)).not.toBe(lastIntroduced);
  });

  test("moves on to the next word in the block after a correct answer", async ({ page }) => {
    await page.goto(`/learn/${LESSON}`);
    await introduceBlock(page);
    const first = await answerShown(page);

    // Still inside the block's quiz, on a different word than the one just
    // answered, with one word banked.
    await learned(page, 1, 4);
    expect(await askedWord(page)).not.toBe(first);
  });

  test("waits for the learner to read the right answer after a miss", async ({ page }) => {
    await page.goto(`/learn/${LESSON}`);
    await introduceBlock(page);
    const asked = await askedWord(page);
    await page
      .getByRole("radio", { name: `word ${asked === 1 ? 2 : 1}`, exact: true })
      .click();

    // A wrong answer does not auto-advance; it holds until Continue is tapped,
    // so the correct option is actually read rather than flashing past.
    await expect(page.getByRole("button", { name: /^continue$/i })).toBeVisible();
    await learned(page, 0, 4);
  });

  test("finishes with a score once every word is answered", async ({ page }) => {
    await page.goto(`/learn/${LESSON}`);
    await completeBlock(page);

    await expect(page.getByRole("heading", { name: /excellent work/i })).toBeVisible();
    await expect(page.getByText("100%")).toBeVisible();
    await expect(page.getByText("4 / 4 correct")).toBeVisible();
  });

  test("scores a mixed session honestly", async ({ page }) => {
    await page.goto(`/learn/${LESSON}`);

    await introduceBlock(page);
    await missShown(page);
    for (let i = 0; i < 3; i++) await answerShown(page);

    await expect(page.getByText("75%")).toBeVisible();
    await expect(page.getByRole("heading", { name: /good effort/i })).toBeVisible();
  });

  test("restarting clears the score rather than adding to it", async ({ page }) => {
    await page.goto(`/learn/${LESSON}`);
    await completeBlock(page);
    await expect(page.getByText("100%")).toBeVisible();

    await page.getByRole("button", { name: /practice again/i }).click();

    await expect(page.getByText("word 1", { exact: true })).toBeVisible();
    await learned(page, 0, 4);
  });
});

test.describe("what a lesson answer records", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedLesson(db, 4);
  });

  test("schedules the word that was actually asked", async ({ page, db }) => {
    await page.goto(`/learn/${LESSON}`);
    await introduceBlock(page);
    const asked = await answerShown(page);
    await learned(page, 1, 4);

    await expect.poll(() => db.rows("word_reviews").length, { timeout: 10_000 }).toBe(1);

    // The review is a scheduling decision for one specific card; the wrong id
    // here silently reschedules a word the learner never saw. The block's quiz
    // order is shuffled, so this asserts against the word actually put to the
    // learner rather than against a position.
    const review = db.rows("word_reviews")[0];
    expect(review.word_id).toBe(wordId(asked - 1));
    expect(new Date(String(review.next_review_at)).getTime()).toBeGreaterThan(Date.now());
  });

  test("a miss brings the word back soon rather than being dropped", async ({ page, db }) => {
    await page.goto(`/learn/${LESSON}`);
    await introduceBlock(page);
    const missed = await missShown(page);
    await learned(page, 1, 4);

    await expect.poll(() => db.rows("word_reviews").length, { timeout: 10_000 }).toBe(1);

    const review = db.rows("word_reviews")[0];
    expect(review.word_id).toBe(wordId(missed - 1));
    // Forgetting has to shorten the interval. Recording the miss as a pass
    // would push the word out of sight for weeks.
    expect(Number(review.interval_days)).toBeLessThanOrEqual(1);
  });

  test("builds on an existing review rather than starting the card over", async ({ page, db }) => {
    db.seed("word_reviews", [
      aWordReview({
        id: reviewId(0),
        word_id: wordId(0),
        repetitions: 4,
        interval_days: 20,
        next_review_at: daysAgo(1),
      }),
    ]);

    await page.goto(`/learn/${LESSON}`);
    // The block's quiz order is shuffled, so answer all of it rather than
    // guessing when the seeded word comes up.
    await completeBlock(page);

    await expect
      .poll(() => Number(db.rows("word_reviews").find((r) => r.word_id === wordId(0))?.repetitions), { timeout: 10_000 })
      .toBe(5);
    // Still one row for that word: a second would give the card two competing
    // schedules.
    expect(db.rows("word_reviews").filter((r) => r.word_id === wordId(0))).toHaveLength(1);
  });

  test("pays for a brand-new word the learner just met", async ({
    page,
    db,
  }) => {
    await page.goto(`/learn/${LESSON}`);
    await introduceBlock(page);
    await answerShown(page);
    await expect.poll(() => db.rows("word_reviews").length, { timeout: 10_000 }).toBe(1);
    await page.waitForTimeout(1000);

    // Regression pin. Claiming the daily new-card budget used to call
    // `supabase.rpc(...).catch(...)`, and a PostgrestFilterBuilder is a
    // thenable with no `.catch` — so the call threw synchronously out of
    // submitRatingToServer, past the mutation, into onError. The card was
    // scheduled (the insert lands first) but onSuccess never ran: no XP, no
    // review counted, no achievement checked, for every brand-new word anyone
    // ever learned. Rating an already-seen card took the update path and paid
    // out normally, which is what kept it invisible.
    await expect
      .poll(() => Number(db.rows("user_xp")[0]?.total_xp ?? 0), { timeout: 10_000 })
      .toBeGreaterThan(250);
  });

  test("awards XP for a card that already has a review row", async ({ page, db }) => {
    db.seed("word_reviews", [
      aWordReview({ id: reviewId(0), word_id: wordId(0), next_review_at: daysAgo(1) }),
    ]);

    await page.goto(`/learn/${LESSON}`);
    await completeBlock(page);

    await expect
      .poll(() => Number(db.rows("user_xp")[0]?.total_xp ?? 0), { timeout: 10_000 })
      .toBeGreaterThan(250);
  });

  test("a signed-out visitor can still take the lesson", async ({ page, signInAs, db }) => {
    await signInAs("anonymous");
    seedLesson(db, 4);

    await page.goto(`/learn/${LESSON}`);
    await introduceBlock(page);
    await answerShown(page);

    await learned(page, 1, 4);
    // Nothing to schedule against, so nothing is written — but the lesson works.
    expect(db.rows("word_reviews")).toHaveLength(0);
  });

  test("invites a signed-out visitor to sign in at the end", async ({ page, signInAs, db }) => {
    await signInAs("anonymous");
    seedLesson(db, 4);

    await page.goto(`/learn/${LESSON}`);
    await completeBlock(page);

    await expect(page.getByRole("link", { name: /login/i })).toBeVisible();
  });
});

test.describe("picking up where the learner left off", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedLesson(db, 4);
  });

  test("saves how far through the lesson got", async ({ page, db }) => {
    await page.goto(`/learn/${LESSON}`);
    await introduceBlock(page);
    await answerShown(page);
    await learned(page, 1, 4);

    await expect.poll(() => db.rows("lesson_progress").length, { timeout: 10_000 }).toBe(1);

    const progress = db.rows("lesson_progress")[0];
    expect(progress.lesson_id).toBe(LESSON);
    expect(Number(progress.last_word_index)).toBe(1);
    expect(Number(progress.words_total)).toBe(4);
  });

  test("resumes at the saved block on the next visit", async ({ page, db }) => {
    // Two blocks, so there is a later one to resume into.
    seedLesson(db, 8);
    db.seed("lesson_progress", [
      aLessonProgress({
        lesson_id: LESSON,
        status: "in_progress",
        last_word_index: 4,
        words_seen: 4,
        words_total: 8,
      }),
    ]);

    await page.goto(`/learn/${LESSON}`);

    // The whole point of the server-side row: a learner who switches device
    // continues rather than restarting. They land on the first introduction of
    // the block they had reached — never mid-block, which would quiz them on
    // words this sitting never introduced.
    await expect(page.getByText("word 5", { exact: true })).toBeVisible();
    await learned(page, 4, 8);
  });

  test("rewinds a mid-block position to that block's first introduction", async ({ page, db }) => {
    seedLesson(db, 8);
    db.seed("lesson_progress", [
      aLessonProgress({
        lesson_id: LESSON,
        status: "in_progress",
        last_word_index: 6,
        words_seen: 6,
        words_total: 8,
      }),
    ]);

    await page.goto(`/learn/${LESSON}`);

    // Word 7 sits in the block that starts at word 5. Dropping the learner
    // straight onto it would leave two of the block's words unintroduced and
    // then quiz them anyway.
    await expect(page.getByText("word 5", { exact: true })).toBeVisible();
  });

  test("does not overwrite the saved position before restoring it", async ({ page, db }) => {
    seedLesson(db, 8);
    db.seed("lesson_progress", [
      aLessonProgress({
        lesson_id: LESSON,
        status: "in_progress",
        last_word_index: 4,
        words_total: 8,
      }),
    ]);

    await page.goto(`/learn/${LESSON}`);
    await learned(page, 4, 8);

    // Mounting starts at index 0; a write before the restore ran would persist 0
    // and destroy the position it was about to jump to.
    expect(Number(db.rows("lesson_progress")[0].last_word_index)).toBeGreaterThanOrEqual(4);
  });

  test("starts a completed lesson from the top", async ({ page, db }) => {
    db.seed("lesson_progress", [
      aLessonProgress({
        lesson_id: LESSON,
        status: "completed",
        last_word_index: 3,
        words_total: 4,
        best_score: 100,
        completed_at: daysAgo(1),
      }),
    ]);

    await page.goto(`/learn/${LESSON}`);

    // Re-opening a finished lesson is a decision to practise it again, so
    // resuming at the last card would hand the learner a single word.
    await learned(page, 0, 4);
  });

  test("marks the lesson completed with its score", async ({ page, db }) => {
    await page.goto(`/learn/${LESSON}`);
    await completeBlock(page);
    await expect(page.getByText("100%")).toBeVisible();

    await expect
      .poll(() => db.rows("lesson_progress")[0]?.status, { timeout: 10_000 })
      .toBe("completed");
    expect(Number(db.rows("lesson_progress")[0].best_score)).toBe(100);
  });

  test("keeps the better of two scores", async ({ page, db }) => {
    db.seed("lesson_progress", [
      aLessonProgress({
        lesson_id: LESSON,
        status: "completed",
        last_word_index: 3,
        words_total: 4,
        best_score: 100,
        completed_at: daysAgo(2),
      }),
    ]);

    await page.goto(`/learn/${LESSON}`);
    await introduceBlock(page);
    await missShown(page);
    for (let i = 0; i < 3; i++) await answerShown(page);
    await expect(page.getByText("75%")).toBeVisible();

    // "Best score" has to mean best; overwriting it turns practice into a way
    // of losing a record already earned.
    await expect
      .poll(() => Number(db.rows("lesson_progress")[0]?.best_score), { timeout: 10_000 })
      .toBe(100);
  });
});

test.describe("when the lesson cannot be shown", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("says so for an id that matches nothing", async ({ page, db }) => {
    db.seed("lessons", []);
    db.seed("topics", []);
    db.seed("vocabulary_words", []);

    await page.goto(`/learn/${lessonId(9)}`);
    await expect(page.getByText(/topic not found/i)).toBeVisible();
  });

  test("says so for a lesson with no words yet", async ({ page, db }) => {
    seedLesson(db, 0);

    await page.goto(`/learn/${LESSON}`);
    await expect(page.getByText(/no words yet/i)).toBeVisible();
  });

  test("does not render an empty lesson when the query failed", async ({
    page,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    seedLesson(db, 4);
    db.failAlways("vocabulary_words", 500);

    await page.goto(`/learn/${LESSON}`);

    // "No words yet" after a failed request tells the learner the lesson is
    // empty when it is not.
    await expect(page.getByText(/no words yet/i)).toHaveCount(0);
  });
});

test.describe("the standalone quiz", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedLesson(db, 5);
  });

  test("crashes on any lesson it could actually quiz", async ({ page, expectConsoleErrors }) => {
    expectConsoleErrors([/Cannot read properties of undefined/, /ErrorBoundary caught error/]);

    await page.goto(`/quiz/${LESSON}`);

    // A real bug, recorded rather than fixed here. Quiz.tsx shuffles the words
    // in a useEffect, so on the render where the query resolves `shuffledWords`
    // is still empty — `key={currentWord.id}` then dereferences undefined and
    // the route renders the error boundary. It reproduces for every lesson with
    // four or more words, which is every lesson the page will run at all; with
    // fewer it returns "Need more words" before reaching the crash, which is
    // why the route-coverage suite never saw it.
    //
    // This test fails once the guard is added. Replace it then with the real
    // assertions: progress counter, one question per word, and the results
    // screen.
    await expect(page.getByRole("heading", { name: /something went wrong/i })).toBeVisible();
  });

  test("refuses to run without enough words to make choices", async ({ page, db }) => {
    seedLesson(db, 3);
    await page.goto(`/quiz/${LESSON}`);

    // Four options are needed for a multiple choice; three words would make the
    // right answer guessable by elimination.
    await expect(page.getByText(/need more words/i)).toBeVisible();
    await expect(page.getByText(/at least 4 words/i)).toBeVisible();
  });

  test("says so for an id that matches nothing", async ({ page, db }) => {
    db.seed("lessons", []);
    db.seed("topics", []);
    await page.goto(`/quiz/${lessonId(9)}`);

    await expect(page.getByText(/topic not found/i)).toBeVisible();
  });
});

test.describe("the curriculum overview", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedLesson(db, 4);
  });

  test("links a lesson row into the lesson runner", async ({ page }) => {
    await page.goto("/curriculum");

    await page.getByRole("link", { name: /Greetings/ }).click();
    await expect(page).toHaveURL(new RegExp(`/learn/${LESSON}$`));
  });

  test("shows a lesson in progress with how far through it is", async ({ page, db }) => {
    db.seed("lesson_progress", [
      aLessonProgress({
        lesson_id: LESSON,
        status: "in_progress",
        last_word_index: 1,
        words_seen: 2,
        words_total: 4,
      }),
    ]);

    await page.goto("/curriculum");
    await expect(page.getByText(/50% through/)).toBeVisible();
  });

  test("counts the words in a lesson through the relationship", async ({ page }) => {
    await page.goto("/curriculum");

    // Resolved by the backend from real rows rather than a pre-shaped embed, so
    // this exercises the `vocabulary_words(id)` join the page actually issues.
    await expect(page.getByText(/4 words/)).toBeVisible();
  });
});
