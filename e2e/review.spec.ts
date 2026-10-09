import { expect, test } from "@playwright/test";
import { signIn, stubSupabase, TEST_USER_ID } from "./support/supabase";
import {
  aLesson,
  aLessonProgress,
  aProfile,
  aVocabularyWord,
  aWordReview,
  lessonId,
  reviewId,
  wordId,
} from "../src/test/support/factories";

/**
 * Review, and how hard it is to miss.
 *
 * This app has two halves. The feed is what brings someone back — it is the
 * habit, and it is why the front door is a video. Spaced repetition is what
 * turns the watching into something retained, and it is the half that quietly
 * decays when it is skipped for a week.
 *
 * When the hub screens went, Review kept its route and lost its billing: the
 * only way to it was a banner on /today, which you reach by tapping a streak
 * number on the feed. That is three steps to the thing a learner should be
 * doing most days. So it holds a dock slot, badged with the count, and it is
 * the first thing on the chooser — above the four skills, because on most days
 * it is the answer to the question that page asks.
 *
 * What these hold in place is the count. A review button that cannot say
 * whether anything is waiting is one you learn to scroll past.
 */

test.describe("review is never more than a tap away", () => {
  test("the dock carries Review, and says how much is waiting", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { curriculumDue: 2, myWordsDue: 3 });
    await page.goto("/today");

    // 2 curriculum + 3 saved words. Both decks count: a badge that showed one
    // of them would send someone into a session they thought was empty.
    const dock = page.getByRole("navigation", { name: "Primary" });
    await expect(dock.getByRole("link", { name: /Review/ })).toBeVisible();
    await expect(dock.getByLabel("5 due")).toBeVisible();
  });

  test("wears no badge when the queue is clear", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { curriculumDue: 0, myWordsDue: 0 });
    await page.goto("/today");

    // Nothing due has to look different from something due, or the badge stops
    // carrying information and becomes decoration.
    const dock = page.getByRole("navigation", { name: "Primary" });
    await expect(dock.getByRole("link", { name: /Review/ })).toBeVisible();
    await expect(dock.getByLabel(/ due$/)).toHaveCount(0);
  });

  test("goes from the feed into the session in one tap", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { curriculumDue: 4 });
    await page.goto("/");

    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /Review/ }).click();

    // From the front door straight into the queue — it used to be the streak
    // chip to /today, then the banner, then the session.
    await expect(page).toHaveURL(/\/review$/);
  });

  test("the chooser leads with Review, above the four skills", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { curriculumDue: 2, myWordsDue: 1 });
    await page.goto("/choose");

    const review = page.getByRole("link", { name: /Review/ }).first();
    await expect(review).toContainText("3 cards ready now");

    // Above the skills, not among them: learning something new and making the
    // old thing stick are different acts, and only one of them expires.
    const skill = page.getByRole("link", { name: /Listen/ }).first();
    const order = await review.evaluate(
      (el, other) => el.compareDocumentPosition(other as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
      await skill.elementHandle(),
    );
    expect(order).toBeTruthy();
  });

  test("says so plainly when there is nothing to review", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { curriculumDue: 0, myWordsDue: 0 });
    await page.goto("/choose");

    await expect(page.getByRole("link", { name: /Review/ }).first())
      .toContainText("caught up");
  });
});

test.describe("when the queue cannot load", () => {
  test("says the load failed instead of pretending the queue is clear", async ({ page }) => {
    await signIn(page);
    const backend = await stubSupabase(page, { curriculumDue: 2 });
    backend.db.failAlways("vocabulary_words", 500);

    await page.goto("/review");

    // A failed fetch used to render "All caught up!" — a false success that
    // told a learner with cards waiting that there was nothing to do.
    await expect(page.getByText("Your reviews didn't load")).toBeVisible();
    await expect(page.getByText(/caught up/i)).toHaveCount(0);

    // And the retry is real: once the backend recovers, the session loads.
    backend.db.clearFailure("vocabulary_words");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("كلمة1")).toBeVisible();
  });
});

/**
 * Whose words are in the deck.
 *
 * `/review` used to serve every `vocabulary_words` row in the active dialect as
 * a new card. Nobody had to ask: the whole authored curriculum — every stage,
 * including ones never opened — arrived in the same queue as the words the
 * learner had collected themselves, and the daily task counted the two
 * together. So "Review 3 words" opened onto a deck of curriculum cards with the
 * learner's own three somewhere behind them.
 *
 * Curriculum cards are opt-in now (src/lib/curriculumDeck.ts). Opening a lesson
 * is how you ask for its words; Settings → "Review the whole curriculum" is how
 * you ask for the rest.
 */
test.describe("curriculum cards are the ones the learner asked for", () => {
  const STARTED = lessonId(0);
  const UNOPENED = lessonId(1);

  /** Two lessons, a word each, and progress on only the first. */
  const twoLessons = () => ({
    lessons: [
      aLesson({ id: STARTED, title: "Started lesson", display_order: 1 }),
      aLesson({ id: UNOPENED, title: "Unopened lesson", display_order: 2 }),
    ],
    vocabulary_words: [
      aVocabularyWord({ id: wordId(0), lesson_id: STARTED, word_arabic: "مفتوح", word_english: "opened" }),
      aVocabularyWord({ id: wordId(1), lesson_id: UNOPENED, word_arabic: "مغلق", word_english: "unopened" }),
    ],
    // No ratings anywhere: the only thing separating the two words is that the
    // learner opened one of the lessons.
    word_reviews: [],
    lesson_progress: [aLessonProgress({ user_id: TEST_USER_ID, lesson_id: STARTED, words_total: 1, words_seen: 1 })],
  });

  test("serves the started lesson and leaves the rest of the curriculum alone", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { tables: twoLessons() });

    await page.goto("/review");

    await expect(page.getByText("مفتوح")).toBeVisible();
    // The deck is one card, not two: a lesson nobody opened contributes
    // nothing, however many words it holds.
    await expect(page.getByText(/Curriculum · 1 \/ 1 this session/)).toBeVisible();
    await expect(page.getByText("مغلق")).toHaveCount(0);
  });

  test("hands over the whole curriculum once the learner asks for it", async ({ page }) => {
    await signIn(page);
    await page.addInitScript(() =>
      localStorage.setItem("hakiya:curriculum-deck-scope", "everything"),
    );
    await stubSupabase(page, { tables: twoLessons() });

    await page.goto("/review");

    // The old behaviour, kept behind the Settings switch rather than deleted:
    // both words are queued, including the one from the unopened lesson.
    await expect(page.getByText(/Curriculum · 1 \/ 2 this session/)).toBeVisible();
  });

  test("forwards into the learner's own words rather than inventing a deck", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, {
      myWordsDue: 2,
      tables: {
        lessons: [aLesson({ id: UNOPENED, title: "Unopened lesson" })],
        vocabulary_words: [
          aVocabularyWord({ id: wordId(1), lesson_id: UNOPENED, word_arabic: "مغلق", word_english: "unopened" }),
        ],
        word_reviews: [],
        lesson_progress: [],
      },
    });

    await page.goto("/review");

    // A learner who has never opened a lesson has no curriculum deck, so the
    // session goes straight to the words they saved themselves — it does not
    // pad the queue with curriculum they never asked for.
    await expect(page).toHaveURL(/\/review\/my-words$/);
    await expect(page.getByText("مغلق")).toHaveCount(0);
  });
});

test.describe("the quiz style", () => {
  const LESSON = lessonId(0);
  const OTHERS = lessonId(1);

  /**
   * One started lesson with one new word that carries its authored sentence,
   * plus an unopened lesson whose words are in the dialect — not in the deck,
   * but in the pool the quiz draws its wrong options from.
   */
  const aDeck = (word: Record<string, unknown> = {}) => ({
    lessons: [
      aLesson({ id: LESSON, title: "Started lesson", display_order: 1 }),
      aLesson({ id: OTHERS, title: "Unopened lesson", display_order: 2 }),
    ],
    vocabulary_words: [
      aVocabularyWord({
        id: wordId(0),
        lesson_id: LESSON,
        word_arabic: "السوق",
        word_english: "the market",
        example_arabic: "رحت السوق أمس",
        example_english: "I went to the market yesterday",
        ...word,
      }),
      aVocabularyWord({ id: wordId(1), lesson_id: OTHERS, word_arabic: "بيت", word_english: "house" }),
      aVocabularyWord({ id: wordId(2), lesson_id: OTHERS, word_arabic: "مدرسة", word_english: "school" }),
      aVocabularyWord({ id: wordId(3), lesson_id: OTHERS, word_arabic: "مطعم", word_english: "restaurant" }),
      aVocabularyWord({ id: wordId(4), lesson_id: OTHERS, word_arabic: "سيارة", word_english: "car" }),
    ],
    word_reviews: [],
    lesson_progress: [aLessonProgress({ user_id: TEST_USER_ID, lesson_id: LESSON, words_total: 1, words_seen: 1 })],
  });

  const quizProfile = () => ({ profiles: [aProfile({ review_style: "quiz" })] });

  test("asks a new word to fill its sentence's gap and rates it for the learner", async ({ page }) => {
    await signIn(page);
    const backend = await stubSupabase(page, { tables: { ...aDeck(), ...quizProfile() } });

    await page.goto("/review");

    // The first look: the gap, the meaning as a hint, and no rating buttons —
    // the app grades this one.
    await expect(page.getByText("Fill in the missing word")).toBeVisible();
    await expect(page.getByText(/the missing word means/i)).toContainText("the market");
    await expect(page.getByText("First look")).toBeVisible();
    await expect(page.getByText(/how well did you remember/i)).toHaveCount(0);

    await page.getByRole("button", { name: "السوق", exact: true }).click();
    await expect(page.getByRole("button", { name: /continue/i })).toBeVisible();
    await page.getByRole("button", { name: /continue/i }).click();

    // A right first-look answer is Good: the rating lands on the recognition
    // schedule as if the learner had tapped it, and the session summary says
    // how the round went.
    await expect.poll(() => backend.db.rows("word_reviews").length).toBe(1);
    expect(backend.db.rows("word_reviews")[0]).toMatchObject({ word_id: wordId(0), last_result: "good" });
    await expect(page.getByRole("list", { name: /quiz session summary/i })).toBeVisible();
    await expect(page.getByText("100%")).toBeVisible();
  });

  test("brings a word the learner got wrong straight back, asked afresh", async ({ page }) => {
    await signIn(page);
    // A card with a review row: a brand-new card's first rating is an insert
    // the session cannot re-target, so only a card with history is re-queued
    // in-session (see handleRate). Its stability is nil, so it is still a
    // first look.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const backend = await stubSupabase(page, {
      tables: {
        ...aDeck(),
        word_reviews: [
          aWordReview({
            id: reviewId(0),
            word_id: wordId(0),
            ease_factor: 0,
            repetitions: 0,
            interval_days: 0,
            last_reviewed_at: null,
            next_review_at: yesterday,
          }),
        ],
        ...quizProfile(),
      },
    });

    await page.goto("/review");
    await expect(page.getByText("Fill in the missing word")).toBeVisible();

    // Any option but the answer; which three distractors were dealt is seeded
    // on the card, not something the test should know.
    await page.getByRole("button", { name: /^(بيت|مدرسة|مطعم|سيارة)$/ }).first().click();
    await page.getByRole("button", { name: /continue/i }).click();

    // Again re-queues the card; on a one-card deck it is served at once. It
    // must come back as a fresh question — options live, no Continue armed
    // with the old rating — not as the answered card it just was.
    await expect(page.getByText("Fill in the missing word")).toBeVisible();
    await expect(page.getByRole("button", { name: /continue/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "السوق", exact: true })).toBeEnabled();
    await expect.poll(() => backend.db.rows("word_reviews")[0]?.last_result).toBe("again");

    await page.getByRole("button", { name: "السوق", exact: true }).click();
    await page.getByRole("button", { name: /continue/i }).click();

    // The relearned card's rating lands on the same row. (What the page shows
    // next is the existing race between the end-of-queue refetch and the
    // queue's flush, which the flip cards share; the first test above covers
    // the summary.)
    await expect.poll(() => backend.db.rows("word_reviews")[0]?.last_result).toBe("good");
  });

  // A tiny valid PNG, so the picture question can be seeded without any
  // network: the e2e harness answers no image host.
  const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

  test("asks for the picture once the word is a little settled", async ({ page }) => {
    await signIn(page);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const deck = aDeck();
    const backend = await stubSupabase(page, {
      tables: {
        ...deck,
        // Every word in the pool has its own picture, so four can be dealt
        // (the frame deals each picture once, so they must differ).
        vocabulary_words: deck.vocabulary_words.map((w, i) => ({ ...w, image_url: `${PIXEL}#${i}` })),
        // Stability past the gap step: the picture is asked for.
        word_reviews: [
          aWordReview({ id: reviewId(0), word_id: wordId(0), ease_factor: 5, repetitions: 2, next_review_at: yesterday }),
        ],
        ...quizProfile(),
      },
    });

    await page.goto("/review");

    await expect(page.getByText("Which picture?")).toBeVisible();
    await expect(page.getByText("Pick the picture")).toBeVisible();
    await expect(page.getByText("السوق")).toBeVisible();
    const pictures = page.getByRole("radiogroup", { name: /choose the picture/i });
    await expect(pictures.getByRole("radio")).toHaveCount(4);

    await pictures.getByRole("radio", { name: "the market" }).click();
    await page.getByRole("button", { name: /continue/i }).click();

    await expect.poll(() => backend.db.rows("word_reviews")[0]?.last_result).toBe("good");
  });

  test("asks for the reply from the lesson's dialogue once the word is settled", async ({ page }) => {
    await signIn(page);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const deck = aDeck();
    const backend = await stubSupabase(page, {
      tables: {
        ...deck,
        lessons: [
          aLesson({
            id: LESSON,
            title: "Started lesson",
            display_order: 1,
            dialogue: [
              { speaker: "Customer", arabic: "وين السوق؟", english: "Where is the market?" },
              { speaker: "Vendor", arabic: "السوق هناك", english: "The market is there" },
              { speaker: "Customer", arabic: "مشكور", english: "Thanks" },
              { speaker: "Vendor", arabic: "العفو", english: "You're welcome" },
              { speaker: "Customer", arabic: "مع السلامة", english: "Goodbye" },
            ],
          }),
          aLesson({ id: OTHERS, title: "Unopened lesson", display_order: 2 }),
        ],
        // Stability past the word step: the reply is asked for.
        word_reviews: [
          aWordReview({ id: reviewId(0), word_id: wordId(0), ease_factor: 40, repetitions: 5, next_review_at: yesterday }),
        ],
        ...quizProfile(),
      },
    });

    await page.goto("/review");

    await expect(page.getByText("What would you say?")).toBeVisible();
    await expect(page.getByText("Answer the line")).toBeVisible();
    await expect(page.getByText("وين السوق؟")).toBeVisible();
    const replies = page.getByRole("radiogroup", { name: /choose the reply/i });
    await expect(replies.getByRole("radio")).toHaveCount(4);

    await replies.getByRole("radio", { name: "السوق هناك" }).click();
    await page.getByRole("button", { name: /continue/i }).click();

    await expect.poll(() => backend.db.rows("word_reviews")[0]?.last_result).toBe("good");
  });

  test("asks for the meaning when the word has no sentence", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, {
      tables: { ...aDeck({ example_arabic: null, example_english: null }), ...quizProfile() },
    });

    await page.goto("/review");

    await expect(page.getByText("What does it mean?")).toBeVisible();
    await expect(page.getByRole("radio", { name: "the market" })).toBeVisible();
  });

  test("keeps the flip card for a learner who has not chosen", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { tables: aDeck() });

    await page.goto("/review");

    await expect(page.getByText("السوق")).toBeVisible();
    await expect(page.getByText("Fill in the missing word")).toHaveCount(0);
    await expect(page.getByRole("radio", { name: /flip/i })).toHaveAttribute("aria-checked", "true");
  });

  test("the header switch changes the style mid-session and keeps it on the profile", async ({ page }) => {
    await signIn(page);
    const backend = await stubSupabase(page, { tables: aDeck() });

    await page.goto("/review");
    await expect(page.getByText("Fill in the missing word")).toHaveCount(0);

    await page.getByRole("radio", { name: /quiz/i }).click();

    await expect(page.getByText("Fill in the missing word")).toBeVisible();
    await expect.poll(() => backend.db.rows("profiles")[0].review_style).toBe("quiz");
  });
});
