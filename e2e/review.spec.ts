import { expect, test } from "@playwright/test";
import { signIn, stubSupabase, TEST_USER_ID } from "./support/supabase";
import {
  aLesson,
  aLessonProgress,
  aProfile,
  aUserVocabulary,
  aVocabularyWord,
  aWordReview,
  lessonId,
  reviewId,
  vocabId,
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

    // The relearned card's rating lands on the same row. What the page shows
    // next is the scheduler's call, not a race with the queue: a Good this soon
    // after a lapse leaves stability under half a day, which the interval
    // rounds to zero, so the card is due again at once. That rounding is an
    // open question in docs/quiz-phases-2026-10.md (Phase 9); the race has its
    // own test below.
    await expect.poll(() => backend.db.rows("word_reviews")[0]?.last_result).toBe("good");
  });

  test("never serves the card just rated while its rating waits to be saved", async ({ page }) => {
    await signIn(page);
    const backend = await stubSupabase(page, { tables: { ...aDeck(), ...quizProfile() } });

    await page.goto("/review");
    await expect(page.getByText("Fill in the missing word")).toBeVisible();

    // The connection drops as the last answer is saved, so the rating waits in
    // the queue while the page asks what is due next, and the server, holding
    // no rating yet, still calls the card due. The deck is slow to answer.
    backend.db.failWrites("word_reviews", 503, {
      code: "503",
      message: "Failed to fetch",
      details: null,
      hint: null,
    });
    backend.db.delay("vocabulary_words", 2000);
    await page.getByRole("button", { name: "السوق", exact: true }).click();
    await page.getByRole("button", { name: /continue/i }).click();

    // While it asks, the walked list is not on screen; and the answer leaves
    // out the card whose rating is still queued, so the session ends there.
    await expect(page.getByText(/checking for more cards/i)).toBeVisible();
    await expect(page.getByText("Fill in the missing word")).toHaveCount(0);
    await expect(page.getByRole("list", { name: /quiz session summary/i })).toBeVisible();
    await expect(page.getByText("Fill in the missing word")).toHaveCount(0);
    expect(backend.db.rows("word_reviews")).toHaveLength(0);

    // The connection comes back, and the queue saves the rating.
    backend.db.clearFailure("word_reviews");
    await expect
      .poll(() => backend.db.rows("word_reviews")[0]?.last_result, { timeout: 15_000 })
      .toBe("good");
    await expect(page.getByText("Fill in the missing word")).toHaveCount(0);
  });

  test("the keys do nothing once the last card is rated: the walked list is not served again", async ({ page }) => {
    await signIn(page);
    // Flip cards, and a card with a review row, so a second rating would be
    // an update that lands rather than a duplicate insert that fails.
    const backend = await stubSupabase(page, {
      tables: {
        ...aDeck(),
        word_reviews: [aWordReview({ id: reviewId(0), word_id: wordId(0) })],
      },
    });

    await page.goto("/review");
    await expect(page.getByText("السوق").first()).toBeVisible();
    // The deck is slow to answer what is due next.
    backend.db.delay("vocabulary_words", 2000);
    await page.keyboard.press(" ");
    await page.keyboard.press("3");

    // Out of habit, again: reveal and rate.
    await page.keyboard.press(" ");
    await page.keyboard.press("3");
    await page.waitForTimeout(2500);

    expect(backend.db.writesTo("word_reviews")).toHaveLength(1);
    // What comes next is a new card: remembering the word unlocked saying it.
    await expect(page.getByText("Say it in Arabic")).toBeVisible();
  });

  test("a slow answer at the end of the list is not the end of the session until it lands", async ({ page }) => {
    await signIn(page);
    const backend = await stubSupabase(page, { tables: { ...aDeck(), ...quizProfile() } });

    await page.goto("/review");
    await expect(page.getByText("Fill in the missing word")).toBeVisible();
    // The deck takes longer to answer than the page waits.
    backend.db.delay("vocabulary_words", 7000);
    await page.getByRole("button", { name: "السوق", exact: true }).click();
    await page.getByRole("button", { name: /continue/i }).click();

    await expect(page.getByText(/checking for more cards/i)).toBeVisible();
    // Past the wait: what is happening and a way out, with no celebration and
    // no summary, since more cards may yet be due.
    await expect(page.getByText(/still checking for more cards/i)).toBeVisible({ timeout: 6000 });
    await expect(page.getByRole("button", { name: /go home/i })).toBeVisible();
    await expect(page.getByRole("list", { name: /quiz session summary/i })).toHaveCount(0);

    // The answer lands: nothing more is due, and the session ends.
    await expect(page.getByRole("list", { name: /quiz session summary/i })).toBeVisible({ timeout: 10_000 });
  });

  test("a card rated before leaving the page is not served on the way back", async ({ page }) => {
    await signIn(page);
    const firstLook = (index: number, daysOverdue: number) =>
      aWordReview({
        id: reviewId(index),
        word_id: wordId(index),
        ease_factor: 0,
        repetitions: 0,
        interval_days: 0,
        last_reviewed_at: null,
        next_review_at: new Date(Date.now() - daysOverdue * 86_400_000).toISOString(),
      });
    const deck = aDeck();
    const backend = await stubSupabase(page, {
      tables: {
        ...deck,
        vocabulary_words: [
          ...deck.vocabulary_words,
          aVocabularyWord({
            id: wordId(5),
            lesson_id: LESSON,
            word_arabic: "قهوة",
            word_english: "coffee",
            example_arabic: "شربت قهوة الصبح",
            example_english: "I drank coffee in the morning",
          }),
        ],
        // The market first (the more overdue), then the coffee.
        word_reviews: [firstLook(0, 3), firstLook(5, 1)],
        ...quizProfile(),
      },
    });

    await page.goto("/review");
    await expect(page.getByText(/the missing word means/i)).toContainText("the market");
    await page.getByRole("button", { name: "السوق", exact: true }).click();
    await page.getByRole("button", { name: /continue/i }).click();
    await expect(page.getByText(/the missing word means/i)).toContainText("coffee");

    // Away and back, inside the app, with the deck slow to answer: the deck
    // built on the way in is not served again from the start, with the market
    // in it, while the new one is fetched.
    await page.getByRole("button", { name: /go home/i }).click();
    await expect(page).not.toHaveURL(/\/review$/);
    backend.db.delay("vocabulary_words", 2500);
    await page.goBack();
    await page.waitForTimeout(1000);
    await expect(page.getByText(/the missing word means/i)).toHaveCount(0);
    await expect(page.getByText(/the missing word means/i)).toContainText("coffee", { timeout: 10_000 });
  });

  test("coming back offline says so, rather than that nothing is due", async ({ page, context }) => {
    await signIn(page);
    await stubSupabase(page, { tables: { ...aDeck(), ...quizProfile() } });

    await page.goto("/review");
    await expect(page.getByText("Fill in the missing word")).toBeVisible();
    await page.getByRole("button", { name: /go home/i }).click();
    await expect(page).not.toHaveURL(/\/review$/);
    // Home's code has loaded before the connection drops.
    await page.waitForLoadState("networkidle");

    // The deck was dropped on the way out; offline, its first fetch waits.
    // Back inside the app (a browser back offline would load the document).
    await context.setOffline(true);
    await page.evaluate(() => {
      window.history.pushState({}, "", "/review");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page.getByText(/you're offline/i)).toBeVisible();
    await expect(page.getByText(/you've reviewed all your due/i)).toHaveCount(0);
    await expect(page).toHaveURL(/\/review$/);

    // Back online, the deck loads.
    await context.setOffline(false);
    await expect(page.getByText("Fill in the missing word")).toBeVisible({ timeout: 10_000 });
  });

  test("a wrong pick in the gap asks the tutor why, about this sentence", async ({ page }) => {
    await signIn(page);
    const backend = await stubSupabase(page, { tables: { ...aDeck(), ...quizProfile() } });

    await page.goto("/review");
    await expect(page.getByText("Fill in the missing word")).toBeVisible();

    // Any option but the answer: which three were dealt is the card's seed.
    const wrong = page.getByRole("button", { name: /^(بيت|مدرسة|مطعم|سيارة)$/ }).first();
    const picked = ((await wrong.textContent()) ?? "").trim();
    await wrong.click();

    await page.getByRole("button", { name: /why not this one/i }).click();
    // The tutor is asked about the pair, in this sentence, by itself; the
    // seed is the sentence alone.
    await expect.poll(() => backend.callsTo("assistant-chat").length).toBeGreaterThan(0);
    const body = backend.lastCallTo("assistant-chat")?.body as { messages?: Array<{ content: string }>; seed?: unknown };
    expect(body.messages?.[0]?.content).toContain(
      `In this sentence I put «${picked}» in the gap, but the word is «السوق» ("the market")`,
    );
    expect(body.seed).toEqual({ arabic: "رحت السوق أمس", english: "I went to the market yesterday" });

    // The pick is still graded as it was: Again.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /continue/i }).click();
    await expect.poll(() => backend.db.rows("word_reviews")[0]?.last_result).toBe("again");
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
              // Not "وين السوق؟": a line that says the word is never the one asked.
              { speaker: "Customer", arabic: "وين نشتري خضار؟", english: "Where do we buy vegetables?" },
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
    await expect(page.getByText("وين نشتري خضار؟")).toBeVisible();
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

/**
 * A word's first jingle is the shared one.
 *
 * Two learners asking for a jingle for the same word used to pay for two
 * Lyria generations and keep two copies. The first jingle is now asked for
 * with `share: true`: the generator answers from the shared asset store (or
 * files a new one there) with a url, and the page stores that url on the
 * learner's row instead of uploading bytes of its own. A regeneration asks
 * for a different jingle, so it stays the learner's own, uploaded as before.
 */
/**
 * A picture for every word (quiz Phase 3).
 *
 * "Pick the picture" only fires for a word that has a picture, and neither
 * the authored tracks nor a learner's saved words come with one. The
 * curriculum's are drawn by a script and written onto the rows; until a row
 * is filled the quiz shows what the shared store holds for the word, reading
 * only, since a learner cannot write the curriculum. A learner's own word has
 * its picture made the first time the quiz wants one, and keeps it.
 */
test.describe("the lightning round", () => {
  const LESSON = lessonId(0);
  const OTHERS = lessonId(1);

  /** Three new words in a started lesson, each with its sentence, and four more in the pool. */
  const roundDeck = () => ({
    lessons: [
      aLesson({ id: LESSON, title: "Started lesson", display_order: 1 }),
      aLesson({ id: OTHERS, title: "Unopened lesson", display_order: 2 }),
    ],
    vocabulary_words: [
      aVocabularyWord({ id: wordId(0), lesson_id: LESSON, word_arabic: "السوق", word_english: "the market", example_arabic: "رحت السوق أمس", example_english: "I went to the market yesterday" }),
      aVocabularyWord({ id: wordId(1), lesson_id: LESSON, word_arabic: "قهوة", word_english: "coffee", example_arabic: "شربت قهوة الصبح", example_english: "I drank coffee in the morning" }),
      aVocabularyWord({ id: wordId(2), lesson_id: LESSON, word_arabic: "البحر", word_english: "the sea", example_arabic: "البحر حلو اليوم", example_english: "The sea is lovely today" }),
      aVocabularyWord({ id: wordId(3), lesson_id: OTHERS, word_arabic: "بيت", word_english: "house" }),
      aVocabularyWord({ id: wordId(4), lesson_id: OTHERS, word_arabic: "مدرسة", word_english: "school" }),
      aVocabularyWord({ id: wordId(5), lesson_id: OTHERS, word_arabic: "مطعم", word_english: "restaurant" }),
      aVocabularyWord({ id: wordId(6), lesson_id: OTHERS, word_arabic: "سيارة", word_english: "car" }),
    ],
    word_reviews: [],
    lesson_progress: [aLessonProgress({ user_id: TEST_USER_ID, lesson_id: LESSON, words_total: 3, words_seen: 3 })],
    profiles: [aProfile({ review_style: "quiz" })],
  });
  test("after a session, sixty seconds over the words got right: a score and a time, and nothing written", async ({ page }) => {
    await signIn(page);
    const backend = await stubSupabase(page, { tables: roundDeck() });
    await page.goto("/review");

    // The session: three first looks, each answered right.
    for (let i = 0; i < 3; i++) {
      await expect(page.getByText("Fill in the missing word")).toBeVisible();
      // The first look names the meaning, which says which of the three it is.
      const hint = (await page.getByText(/the missing word means/i).textContent()) ?? "";
      const word = hint.includes("market") ? "السوق" : hint.includes("coffee") ? "قهوة" : "البحر";
      await page.getByRole("button", { name: word, exact: true }).click();
      await page.getByRole("button", { name: /continue/i }).click();
    }

    await expect(page.getByRole("heading", { name: /lightning round/i })).toBeVisible();
    await expect(page.getByText(/60 seconds over the 3 words you got right/i)).toBeVisible();
    // Everything the session writes has landed: three ratings, three flat XP.
    await expect.poll(() => backend.db.rows("word_reviews").length).toBe(3);
    await expect.poll(() => backend.rpcCallsTo("award_xp").length).toBe(3);
    const ratings = JSON.stringify(backend.db.rows("word_reviews"));
    // The session's cards read their sentences aloud; the round reads none.
    const voices = backend.callsTo("tts-speak").length;

    await page.getByRole("button", { name: /^start$/i }).click();
    const round = page.getByTestId("lightning-round");
    for (let i = 0; i < 3; i++) {
      await expect(round.getByText(`${i + 1} / 3`)).toBeVisible();
      // Each word's gap again, without the hint: the right word is the one in
      // this sentence, and the round moves on by itself.
      const sentence = (await round.locator("[dir='rtl']").first().textContent()) ?? "";
      const word = sentence.includes("رحت") ? "السوق" : sentence.includes("شربت") ? "قهوة" : "البحر";
      await expect(round.getByText(/the missing word means/i)).toHaveCount(0);
      await round.getByRole("button", { name: word, exact: true }).click();
    }

    await expect(page.getByRole("heading", { name: /every word in \d+ s/i })).toBeVisible();
    await expect(page.getByLabel(/lightning round score/i)).toHaveText("3 / 3");

    // Nothing the round did was a rating, or paid anything, not even a moment later.
    await page.waitForTimeout(1000);
    expect(JSON.stringify(backend.db.rows("word_reviews"))).toBe(ratings);
    expect(backend.rpcCallsTo("award_xp")).toHaveLength(3);
    expect(backend.callsTo("tts-speak")).toHaveLength(voices);
  });

  test("is not offered after a session with fewer than three right answers", async ({ page }) => {
    await signIn(page);
    const deck = roundDeck();
    const backend = await stubSupabase(page, {
      tables: { ...deck, vocabulary_words: deck.vocabulary_words.filter((w) => w.id !== wordId(1) && w.id !== wordId(2)) },
    });
    await page.goto("/review");

    await page.getByRole("button", { name: "السوق", exact: true }).click();
    await page.getByRole("button", { name: /continue/i }).click();

    await expect(page.getByRole("list", { name: /quiz session summary/i })).toBeVisible();
    await expect.poll(() => backend.db.rows("word_reviews").length).toBe(1);
    await expect(page.getByRole("heading", { name: /lightning round/i })).toHaveCount(0);
  });
});

test.describe("the boss card", () => {
  const LESSON = lessonId(0);
  const OTHERS = lessonId(1);
  const HOOK = "A souq stall selling socks";

  /**
   * Two due words in a started lesson: an ordinary one, the more overdue, and
   * a leech missed seven times, settled enough to be heard alone (step 4).
   */
  const bossDeck = () => ({
    lessons: [
      aLesson({ id: LESSON, title: "Started lesson", display_order: 1 }),
      aLesson({ id: OTHERS, title: "Unopened lesson", display_order: 2 }),
    ],
    vocabulary_words: [
      aVocabularyWord({ id: wordId(0), lesson_id: LESSON, word_arabic: "السوق", word_english: "the market", example_arabic: "رحت السوق أمس", example_english: "I went to the market yesterday" }),
      aVocabularyWord({ id: wordId(1), lesson_id: LESSON, word_arabic: "قهوة", word_english: "coffee", example_arabic: "شربت قهوة الصبح", example_english: "I drank coffee in the morning" }),
      aVocabularyWord({ id: wordId(3), lesson_id: OTHERS, word_arabic: "بيت", word_english: "house" }),
      aVocabularyWord({ id: wordId(4), lesson_id: OTHERS, word_arabic: "مدرسة", word_english: "school" }),
      aVocabularyWord({ id: wordId(5), lesson_id: OTHERS, word_arabic: "مطعم", word_english: "restaurant" }),
      aVocabularyWord({ id: wordId(6), lesson_id: OTHERS, word_arabic: "سيارة", word_english: "car" }),
    ],
    word_reviews: [
      aWordReview({ id: reviewId(0), word_id: wordId(0), ease_factor: 10, repetitions: 4, interval_days: 3, is_leech: true, lapses: 7, mnemonic: HOOK, next_review_at: new Date(Date.now() - 86_400_000).toISOString() }),
      aWordReview({ id: reviewId(1), word_id: wordId(1), ease_factor: 10, repetitions: 4, interval_days: 3, next_review_at: new Date(Date.now() - 3 * 86_400_000).toISOString() }),
    ],
    lesson_progress: [aLessonProgress({ user_id: TEST_USER_ID, lesson_id: LESSON, words_total: 2, words_seen: 2 })],
    profiles: [aProfile({ review_style: "quiz" })],
  });

  test("the worst leech opens the session as a first look, and beating it is celebrated", async ({ page }) => {
    await signIn(page);
    const backend = await stubSupabase(page, { tables: bossDeck() });
    await page.goto("/review");

    // The leech, though the other word is more overdue: a first look, with
    // its hook a tap away.
    const boss = page.getByRole("region", { name: "Boss card" });
    await expect(boss).toContainText("missed 7 times");
    await expect(page.getByText(/the missing word means/i)).toContainText("the market");
    await expect(page.getByText(HOOK)).toHaveCount(0);

    await page.getByRole("button", { name: "السوق", exact: true }).click();
    // The hook is the lesson once the answer is in: in the banner, and in the
    // rescue panel, which waited for the answer.
    await expect(page.getByRole("region", { name: "Boss card" }).getByText(HOOK)).toBeVisible();
    await expect(page.getByText(HOOK)).toHaveCount(2);
    await page.getByRole("button", { name: /continue/i }).click();

    const beaten = page.getByRole("dialog", { name: "Boss beaten!" });
    await expect(beaten).toBeVisible();
    // Graded as a first look: Good, on the leech's own row.
    await expect.poll(() => backend.db.rows("word_reviews").find((r) => r.id === reviewId(0))?.last_result).toBe("good");
    // The next card is an ordinary one: asserted past the celebration, which
    // hides the page from the accessibility tree while it is open.
    await beaten.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("قهوة").first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Boss card" })).toHaveCount(0);
  });

  test("there is no boss when the learner does not track leeches", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("hakiya:leech-tracking-enabled", "false"));
    await signIn(page);
    await stubSupabase(page, { tables: bossDeck() });
    await page.goto("/review");

    await expect(page.getByRole("img", { name: /step \d+ of 10/i })).toBeVisible();
    await expect(page.getByRole("region", { name: "Boss card" })).toHaveCount(0);
  });
});

test.describe("a picture for a word that has none", () => {
  const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const LESSON = lessonId(0);
  const OTHERS = lessonId(1);
  const yesterday = () => new Date(Date.now() - 86_400_000).toISOString();
  const quizProfile = () => ({ profiles: [aProfile({ review_style: "quiz" })] });

  test("the curriculum deck shows the store's picture, and leaves the row as it is", async ({ page }) => {
    await signIn(page);
    const backend = await stubSupabase(page, {
      tables: {
        lessons: [
          aLesson({ id: LESSON, title: "Started lesson", display_order: 1 }),
          aLesson({ id: OTHERS, title: "Unopened lesson", display_order: 2 }),
        ],
        vocabulary_words: [
          // The due word: no picture on its row.
          aVocabularyWord({ id: wordId(0), lesson_id: LESSON, word_arabic: "السوق", word_english: "the market" }),
          // The rest of the dialect's words have theirs, to be dealt beside it.
          ...["house", "school", "restaurant", "car"].map((english, i) =>
            aVocabularyWord({
              id: wordId(i + 1),
              lesson_id: OTHERS,
              word_arabic: ["بيت", "مدرسة", "مطعم", "سيارة"][i],
              word_english: english,
              image_url: `${PIXEL}#${i}`,
            }),
          ),
        ],
        word_reviews: [
          aWordReview({ id: reviewId(0), word_id: wordId(0), ease_factor: 5, repetitions: 2, next_review_at: yesterday() }),
        ],
        lesson_progress: [aLessonProgress({ user_id: TEST_USER_ID, lesson_id: LESSON, words_total: 1, words_seen: 1 })],
        // What scripts/curriculum-pictures.ts (or another learner) filed for
        // the word: keyed on the folded word and sense, in the Ink style.
        word_assets: [
          {
            id: "asset-market",
            concept_key: "السوق|market",
            kind: "image",
            dialect: "Gulf",
            style_version: "ink-1",
            url: `${PIXEL}#stored`,
            payload: null,
            meta: {},
            source: "authored",
            approved_at: null,
            created_at: yesterday(),
          },
        ],
        ...quizProfile(),
      },
    });

    await page.goto("/review");

    await expect(page.getByText("Which picture?")).toBeVisible();
    const pictures = page.getByRole("radiogroup", { name: /choose the picture/i });
    await expect(pictures.getByRole("radio")).toHaveCount(4);
    await expect(pictures.getByRole("radio", { name: "the market" }).locator("img")).toHaveAttribute("src", `${PIXEL}#stored`);

    await pictures.getByRole("radio", { name: "the market" }).click();
    await page.getByRole("button", { name: /continue/i }).click();
    await expect.poll(() => backend.db.rows("word_reviews")[0]?.last_result).toBe("good");

    // Read only: nothing drawn, and the curriculum row is not the learner's to write.
    expect(backend.callsTo("word-asset")).toEqual([]);
    expect(backend.db.writesTo("vocabulary_words")).toEqual([]);
    expect(backend.db.raw("vocabulary_words").find((w) => w.id === wordId(0))?.image_url).toBeNull();
  });

  test("a saved word gets its picture the first time the quiz asks for one, and keeps it", async ({ page }) => {
    await signIn(page);
    const backend = await stubSupabase(page, {
      tables: {
        user_vocabulary: [
          // Past the gap step and due: "pick the picture", with no picture.
          aUserVocabulary({
            id: vocabId(0),
            word_arabic: "السوق",
            word_english: "the market",
            ease_factor: 5,
            repetitions: 2,
            next_review_at: yesterday(),
          }),
          // Not due: the pool the wrong pictures come from.
          ...["house", "school", "restaurant", "car"].map((english, i) =>
            aUserVocabulary({
              id: vocabId(i + 1),
              word_arabic: ["بيت", "مدرسة", "مطعم", "سيارة"][i],
              word_english: english,
              image_url: `${PIXEL}#${i}`,
              next_review_at: new Date(Date.now() + 86_400_000 * 30).toISOString(),
            }),
          ),
        ],
        word_assets: [],
        ...quizProfile(),
      },
    });
    // The function is stubbed: no model is called. The shape is the real
    // one for a picture drawn and filed.
    backend.stubFunction("word-asset", { asset: { id: "a" }, url: `${PIXEL}#drawn`, cached: false, stored: true });

    await page.goto("/review/my-words");

    // The picture question, asked with the picture that was just made.
    await expect(page.getByText("Which picture?")).toBeVisible();
    const pictures = page.getByRole("radiogroup", { name: /choose the picture/i });
    await expect(pictures.getByRole("radio")).toHaveCount(4);
    await expect(pictures.getByRole("radio", { name: "the market" }).locator("img")).toHaveAttribute("src", `${PIXEL}#drawn`);

    // Asked for once, by the word alone: nothing a learner could steer a
    // shared picture with.
    expect(backend.callsTo("word-asset")).toHaveLength(1);
    expect(backend.lastCallTo("word-asset")?.body).toEqual({
      action: "ensure",
      kind: "image",
      word: "السوق",
      gloss: "the market",
      dialect: "Gulf",
    });

    // And it is on the learner's own word from now on.
    await expect.poll(() => backend.db.raw("user_vocabulary").find((w) => w.id === vocabId(0))?.image_url).toBe(`${PIXEL}#drawn`);

    await pictures.getByRole("radio", { name: "the market" }).click();
    await page.getByRole("button", { name: /continue/i }).click();
    await expect.poll(() => backend.db.raw("user_vocabulary").find((w) => w.id === vocabId(0))?.repetitions).toBe(3);
    expect(backend.callsTo("word-asset")).toHaveLength(1);
  });

  test("a saved word is asked its fallback, quietly, when its picture cannot be made", async ({ page }) => {
    await signIn(page);
    const backend = await stubSupabase(page, {
      tables: {
        user_vocabulary: [
          aUserVocabulary({
            id: vocabId(0),
            word_arabic: "السوق",
            word_english: "the market",
            ease_factor: 5,
            repetitions: 2,
            next_review_at: yesterday(),
          }),
          ...["house", "school", "restaurant", "car"].map((english, i) =>
            aUserVocabulary({
              id: vocabId(i + 1),
              word_arabic: ["بيت", "مدرسة", "مطعم", "سيارة"][i],
              word_english: english,
              image_url: `${PIXEL}#${i}`,
              next_review_at: new Date(Date.now() + 86_400_000 * 30).toISOString(),
            }),
          ),
        ],
        word_assets: [],
        ...quizProfile(),
      },
    });
    // The day's picture allowance is spent.
    backend.stubFunctionCapped("word-asset");

    await page.goto("/review/my-words");

    // The step's own fallback, and no word about a limit the learner did not
    // run into by pressing anything.
    await expect(page.getByText("What did you hear?")).toBeVisible();
    await expect(page.getByText(/daily free limit/i)).toHaveCount(0);
    expect(backend.db.raw("user_vocabulary").find((w) => w.id === vocabId(0))?.image_url).toBeNull();
  });
});

test.describe("the reply steps, from a word's exchange", () => {
  // Steps 6 and 9 ask from a dialogue. A word its lesson never uses (a saved
  // word above all) is asked from the shared store's two-line exchange for
  // it, written once by `word-asset` and kept for every later learner. The
  // function is stubbed here: no model is called.
  const LESSON = lessonId(0);
  const OTHERS = lessonId(1);
  const yesterday = () => new Date(Date.now() - 86_400_000).toISOString();
  const nextMonth = () => new Date(Date.now() + 86_400_000 * 30).toISOString();
  const quizProfile = () => ({ profiles: [aProfile({ review_style: "quiz" })] });

  const EXCHANGE = {
    lines: [
      { speaker: "Friend", arabic: "وين رحت أمس؟", english: "Where did you go yesterday?", transliteration: "" },
      { speaker: "You", arabic: "رحت السوق مع أخوي", english: "I went to the market with my brother", transliteration: "ruht is-suug ma' akhooy" },
    ],
  };

  /** A stored exchange, as `word-asset` files it, keyed on the folded word and sense. */
  const filed = (conceptKey: string, lines: unknown) => ({
    id: `talk-${conceptKey}`,
    concept_key: conceptKey,
    kind: "dialogue",
    dialect: "Gulf",
    style_version: "text-1",
    url: null,
    payload: { lines },
    meta: {},
    source: "generated",
    approved_at: null,
    created_at: yesterday(),
  });
  const said = { speaker: "Friend", arabic: "شو صار؟", english: "What happened?", transliteration: "" };
  /** Three other words' exchanges, whose replies are the wrong ones on step 6. */
  const otherExchanges = [
    filed("بيت|house", [said, { speaker: "You", arabic: "رحت بيت خالي بدري", english: "I went to my uncle's house early", transliteration: "" }]),
    filed("مدرسه|school", [said, { speaker: "You", arabic: "سكرت مدرسة البنات اليوم", english: "The girls' school closed today", transliteration: "" }]),
    filed("مطعم|restaurant", [said, { speaker: "You", arabic: "تغدينا في مطعم جديد", english: "We had lunch at a new restaurant", transliteration: "" }]),
  ];

  test("a saved word from a video reaches step 6 with an exchange written for it", async ({ page }) => {
    await signIn(page);
    const backend = await stubSupabase(page, {
      tables: {
        user_vocabulary: [
          // Settled past the word step, due, and saved from a video with the
          // line it was heard in: the learner's own text.
          aUserVocabulary({
            id: vocabId(0),
            word_arabic: "السوق",
            word_english: "the market",
            ease_factor: 40,
            repetitions: 6,
            next_review_at: yesterday(),
            source: "video",
            sentence_text: "رحت السوق امس مع ZZTRANSCRIPT",
          }),
          ...["house", "school", "restaurant", "car"].map((english, i) =>
            aUserVocabulary({
              id: vocabId(i + 1),
              word_arabic: ["بيت", "مدرسة", "مطعم", "سيارة"][i],
              word_english: english,
              next_review_at: nextMonth(),
            }),
          ),
        ],
        word_assets: otherExchanges,
        ...quizProfile(),
      },
    });
    backend.stubFunction("word-asset", { asset: { id: "talk-market", payload: EXCHANGE }, url: null, cached: false, stored: true });

    await page.goto("/review/my-words");

    await expect(page.getByText("What would you say?")).toBeVisible();
    await expect(page.getByText("Answer the line")).toBeVisible();
    await expect(page.getByText("وين رحت أمس؟")).toBeVisible();
    const replies = page.getByRole("radiogroup", { name: /choose the reply/i });
    await expect(replies.getByRole("radio")).toHaveCount(4);
    // The wrong replies are the other words' stored replies.
    for (const wrong of ["رحت بيت خالي بدري", "سكرت مدرسة البنات اليوم", "تغدينا في مطعم جديد"]) {
      await expect(replies.getByRole("radio", { name: new RegExp(wrong) })).toBeVisible();
    }

    // Written for the word alone: never the line it was saved from.
    expect(backend.callsTo("word-asset")).toHaveLength(1);
    expect(backend.lastCallTo("word-asset")?.body).toEqual({
      action: "ensure",
      kind: "dialogue",
      word: "السوق",
      gloss: "the market",
      dialect: "Gulf",
    });

    await replies.getByRole("radio", { name: /رحت السوق مع أخوي/ }).click();
    await page.getByRole("button", { name: /continue/i }).click();
    await expect.poll(() => backend.db.raw("user_vocabulary").find((w) => w.id === vocabId(0))?.repetitions).toBe(7);
  });

  /** A curriculum word whose production card is due at step 9, and whose lesson has no line for it. */
  const matureDeck = () => ({
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
      }),
      ...["house", "school", "restaurant", "car"].map((english, i) =>
        aVocabularyWord({ id: wordId(i + 1), lesson_id: OTHERS, word_arabic: ["بيت", "مدرسة", "مطعم", "سيارة"][i], word_english: english }),
      ),
    ],
    word_reviews: [
      aWordReview({
        id: reviewId(0),
        word_id: wordId(0),
        // Recognition is settled and not due; production is due, and past
        // the line step.
        ease_factor: 60,
        repetitions: 8,
        next_review_at: nextMonth(),
        production_ease_factor: 40,
        production_repetitions: 5,
        production_next_review_at: yesterday(),
      }),
    ],
    lesson_progress: [aLessonProgress({ user_id: TEST_USER_ID, lesson_id: LESSON, words_total: 1, words_seen: 1 })],
    word_assets: [filed("السوق|market", EXCHANGE.lines)],
    ...quizProfile(),
  });

  /** Say the reply into the fake microphone, and wait for it to reach the scorer. */
  async function sayTheReply(page: import("@playwright/test").Page, backend: Awaited<ReturnType<typeof stubSupabase>>) {
    await page.getByRole("button", { name: /^say it$/i }).click();
    await expect(page.getByText("Listening…")).toBeVisible();
    // A quarter-second of the fake device, so the encoder has frames to flush.
    await page.waitForTimeout(250);
    await page.getByRole("button", { name: /^stop$/i }).click();
    await expect.poll(() => backend.callsTo("azure-pronunciation").length, { timeout: 15_000 }).toBeGreaterThan(0);
  }

  test("a mature word is asked to say the reply, and the take is scored against it", async ({ page }) => {
    await signIn(page);
    const backend = await stubSupabase(page, { tables: matureDeck() });
    // The scorer is stubbed: the calibrated score, and the reply it heard.
    backend.stubFunction("azure-pronunciation", {
      overall: 76,
      accuracy: 78,
      fluency: 80,
      completeness: 100,
      words: [],
      recognizedText: "رحت السوق مع اخوي",
      locale: "ar-SA",
    });

    await page.goto("/review");

    await expect(page.getByText("Say the reply in Arabic")).toBeVisible();
    await expect(page.getByText("Say the reply", { exact: true })).toBeVisible();
    await expect(page.getByText("وين رحت أمس؟")).toBeVisible();
    await expect(page.getByText("I went to the market with my brother")).toBeVisible();
    // The reply is the answer: not on screen until it has been said.
    await expect(page.getByText("رحت السوق مع أخوي")).toHaveCount(0);

    await sayTheReply(page, backend);

    // Scored against the stored reply, in the word's dialect.
    expect(backend.lastCallTo("azure-pronunciation")?.body).toMatchObject({
      referenceText: "رحت السوق مع أخوي",
      locale: "ar-SA",
    });
    await expect(page.getByText("76")).toBeVisible();
    await page.getByRole("button", { name: /continue/i }).click();

    // 76 on the calibrated scale, with the word in it: Good, on the
    // production schedule.
    await expect.poll(() => backend.db.rows("word_reviews")[0]?.production_repetitions).toBe(6);
    expect(backend.db.rows("word_reviews")[0]).toMatchObject({ last_result: "good" });
    expect(backend.callsTo("word-asset")).toEqual([]);
  });

  test("a reply said well without the word is Again", async ({ page }) => {
    await signIn(page);
    const backend = await stubSupabase(page, { tables: matureDeck() });
    backend.stubFunction("azure-pronunciation", {
      overall: 92,
      accuracy: 92,
      fluency: 92,
      completeness: 100,
      words: [],
      recognizedText: "رحت المطعم مع اخوي",
      locale: "ar-SA",
    });

    await page.goto("/review");
    await expect(page.getByText("Say the reply in Arabic")).toBeVisible();
    await sayTheReply(page, backend);
    await page.getByRole("button", { name: /continue/i }).click();

    await expect.poll(() => backend.db.rows("word_reviews")[0]?.last_result).toBe("again");
    expect(backend.db.rows("word_reviews")[0]?.production_lapses).toBe(1);
  });

  test("a reply in other words, with the word clearly in it, is Hard and never a lapse", async ({ page }) => {
    // Right, but not the stored line: the score is low on completeness.
    await signIn(page);
    const backend = await stubSupabase(page, { tables: matureDeck() });
    backend.stubFunction("azure-pronunciation", {
      overall: 41,
      accuracy: 70,
      fluency: 60,
      completeness: 35,
      words: [],
      recognizedText: "رحت السوق",
      locale: "ar-SA",
    });

    await page.goto("/review");
    await expect(page.getByText("Say the reply in Arabic")).toBeVisible();
    await sayTheReply(page, backend);
    await page.getByRole("button", { name: /continue/i }).click();

    await expect.poll(() => backend.db.rows("word_reviews")[0]?.last_result).toBe("hard");
    expect(backend.db.rows("word_reviews")[0]?.production_lapses ?? 0).toBe(0);
  });

  test("says the line instead while the store's table is not on the live project", async ({ page }) => {
    // No exchange can be read or kept: the step falls back to step 8, and
    // nothing is made.
    await signIn(page);
    const deck = matureDeck();
    const backend = await stubSupabase(page, { tables: { ...deck, word_assets: [] } });
    backend.db.failAlways("word_assets", 404, {
      code: "PGRST205",
      message: "Could not find the table 'public.word_assets' in the schema cache",
    });

    await page.goto("/review");

    await expect(page.getByText("Say the line in Arabic")).toBeVisible();
    await expect(page.getByText("I went to the market yesterday")).toBeVisible();
  });
});

test.describe("a word in a story", () => {
  // The top step: a production card past 60 days is asked its word in two
  // sentences of a story, read aloud with the word muted, and says it. The
  // passage is the shared store's (`kind: "story_line"`), taken from a
  // published story or written for the word by `word-asset`, which is stubbed
  // here: nothing reaches a model, and the scorer is stubbed too.
  const LESSON = lessonId(0);
  const OTHERS = lessonId(1);
  const yesterday = () => new Date(Date.now() - 86_400_000).toISOString();
  const nextMonth = () => new Date(Date.now() + 86_400_000 * 30).toISOString();

  const PASSAGE = {
    sentences: [
      { arabic: "كان الجو حار وايد.", english: "It was very hot." },
      { arabic: "رحنا السوق بدري.", english: "We went to the market early." },
    ],
    story: { id: "story-1", title: "A hot day", titleArabic: "يوم حار" },
  };
  const WHOLE = "كان الجو حار وايد. رحنا السوق بدري.";
  const filed = (kind: string, payload: unknown) => ({
    id: `${kind}-market`,
    concept_key: "السوق|market",
    kind,
    dialect: "Gulf",
    style_version: "text-1",
    url: null,
    payload,
    meta: {},
    source: kind === "story_line" ? "reviewed" : "generated",
    approved_at: null,
    created_at: yesterday(),
  });

  /** A curriculum word whose production card is due past the reply step. */
  const storyDeck = (wordAssets: Array<Record<string, unknown>> = [filed("story_line", PASSAGE)]) => ({
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
      }),
      ...["house", "school", "restaurant", "car"].map((english, i) =>
        aVocabularyWord({ id: wordId(i + 1), lesson_id: OTHERS, word_arabic: ["بيت", "مدرسة", "مطعم", "سيارة"][i], word_english: english }),
      ),
    ],
    word_reviews: [
      aWordReview({
        id: reviewId(0),
        word_id: wordId(0),
        ease_factor: 90,
        repetitions: 9,
        next_review_at: nextMonth(),
        // Production past the reply's 30 days and the story's 60.
        production_ease_factor: 70,
        production_repetitions: 7,
        production_next_review_at: yesterday(),
      }),
    ],
    lesson_progress: [aLessonProgress({ user_id: TEST_USER_ID, lesson_id: LESSON, words_total: 1, words_seen: 1 })],
    word_assets: wordAssets,
    profiles: [aProfile({ review_style: "quiz" })],
  });

  const scored = (overall: number, recognizedText: string) => ({
    overall,
    accuracy: overall,
    fluency: overall,
    completeness: 100,
    words: [],
    recognizedText,
    locale: "ar-SA",
  });

  async function sayTheWord(page: import("@playwright/test").Page, backend: Awaited<ReturnType<typeof stubSupabase>>) {
    await page.getByRole("button", { name: /^say it$/i }).click();
    await expect(page.getByText("Listening…")).toBeVisible();
    await page.waitForTimeout(250);
    await page.getByRole("button", { name: /^stop$/i }).click();
    await expect.poll(() => backend.callsTo("azure-pronunciation").length, { timeout: 15_000 }).toBeGreaterThan(0);
  }

  const readings = (backend: Awaited<ReturnType<typeof stubSupabase>>) =>
    backend.callsTo("tts-speak").map((call) => call.body as { text?: string; dialect?: string });

  test("a mature word is asked in its story, the gap muted, and the word said is scored", async ({ page }) => {
    await signIn(page);
    const backend = await stubSupabase(page, { tables: storyDeck() });
    backend.stubFunction("azure-pronunciation", scored(80, "السوق"));

    await page.goto("/review");

    await expect(page.getByText("Say the missing word")).toBeVisible();
    await expect(page.getByText("In a story", { exact: true })).toBeVisible();
    await expect(page.getByText(/From the story “A hot day”/)).toBeVisible();
    const passage = page.getByTestId("story-passage");
    await expect(passage).toContainText("كان الجو حار وايد.");
    await expect(passage).not.toContainText("السوق");
    await expect(page.getByText(/the missing word means/i)).toContainText("the market");

    // Read aloud with the word muted, in the word's dialect.
    await expect.poll(() => readings(backend).length).toBeGreaterThan(0);
    expect(readings(backend)[0]).toEqual({ text: "كان الجو حار وايد. رحنا ... بدري.", dialect: "Gulf" });
    expect(readings(backend).some((r) => r.text?.includes("السوق"))).toBe(false);

    await sayTheWord(page, backend);

    // Scored against the word itself, in the word's locale.
    expect(backend.lastCallTo("azure-pronunciation")?.body).toMatchObject({ referenceText: "السوق", locale: "ar-SA" });
    await expect(page.getByTestId("story-gap")).toHaveText("السوق");
    // And the whole passage is read now, in the same dialect's voice.
    await expect.poll(() => readings(backend).some((r) => r.text === WHOLE && r.dialect === "Gulf")).toBe(true);

    await page.getByRole("button", { name: /continue/i }).click();
    // 80 on the calibrated scale: Good, on the production schedule.
    await expect.poll(() => backend.db.rows("word_reviews")[0]?.production_repetitions).toBe(8);
    expect(backend.db.rows("word_reviews")[0]).toMatchObject({ last_result: "good" });
    expect(backend.callsTo("word-asset")).toEqual([]);
  });

  test("a different word said well is Again", async ({ page }) => {
    await signIn(page);
    const backend = await stubSupabase(page, { tables: storyDeck() });
    backend.stubFunction("azure-pronunciation", scored(92, "المطعم"));

    await page.goto("/review");
    await expect(page.getByText("Say the missing word")).toBeVisible();
    await sayTheWord(page, backend);
    await page.getByRole("button", { name: /continue/i }).click();

    await expect.poll(() => backend.db.rows("word_reviews")[0]?.last_result).toBe("again");
  });

  test("a word with no passage filed has one found for it, by the word alone", async ({ page }) => {
    await signIn(page);
    const backend = await stubSupabase(page, { tables: storyDeck([]) });
    backend.stubFunction("word-asset", { asset: { id: "story_line-market", payload: PASSAGE }, url: null, cached: false, stored: true });

    await page.goto("/review");

    await expect(page.getByText("Say the missing word")).toBeVisible();
    const asked = backend.callsTo("word-asset").map((call) => call.body as Record<string, unknown>);
    expect(asked.filter((body) => body.kind === "story_line")).toEqual([
      { action: "ensure", kind: "story_line", word: "السوق", gloss: "the market", dialect: "Gulf" },
    ]);
    // The fallback's exchange is never written for a card asked its passage.
    expect(asked.filter((body) => body.kind === "dialogue")).toEqual([]);
  });

  test("asks the reply instead when no passage can be had", async ({ page }) => {
    await signIn(page);
    const backend = await stubSupabase(page, {
      tables: storyDeck([filed("dialogue", {
        lines: [
          { speaker: "Friend", arabic: "وين رحت أمس؟", english: "Where did you go yesterday?", transliteration: "" },
          { speaker: "You", arabic: "رحت السوق مع أخوي", english: "I went to the market with my brother", transliteration: "" },
        ],
      })]),
    });
    backend.stubFunction("word-asset", { error: "msa_leak", fallback: true, message: "The passage was not in the dialect." });

    await page.goto("/review");

    await expect(page.getByText("Say the reply in Arabic")).toBeVisible();
    await expect(page.getByText("In a story", { exact: true })).toBeVisible();
    await expect(page.getByText("وين رحت أمس؟")).toBeVisible();
  });

  test("says the line instead while the store's table is not on the live project, and keeps nothing", async ({ page }) => {
    await signIn(page);
    const backend = await stubSupabase(page, { tables: storyDeck([]) });
    backend.db.failAlways("word_assets", 404, {
      code: "PGRST205",
      message: "Could not find the table 'public.word_assets' in the schema cache",
    });
    backend.stubFunctionFailure("word-asset", 503, { error: "store_not_ready", fallback: true });

    await page.goto("/review");

    await expect(page.getByText("Say the line in Arabic")).toBeVisible();
    await expect(page.getByText("I went to the market yesterday")).toBeVisible();
  });

  test("on a device that cannot record, the gap is picked from four, and a wrong pick asks why", async ({ page }) => {
    await page.addInitScript(() => {
      // No recorder: the quiz asks the gap as a choice rather than handing over the flip card.
      Object.defineProperty(window, "MediaRecorder", { value: undefined, configurable: true });
    });
    await signIn(page);
    const backend = await stubSupabase(page, { tables: storyDeck() });

    await page.goto("/review");

    await expect(page.getByText("Fill in the missing word")).toBeVisible();
    const options = page.getByRole("radiogroup", { name: /choose the missing word/i });
    await expect(options.getByRole("radio")).toHaveCount(4);
    // Three of the other four words are dealt; pick one of them.
    const wrong = options.getByRole("radio").filter({ hasNotText: "السوق" }).first();
    const picked = ((await wrong.textContent()) ?? "").trim();
    await wrong.click();
    await expect(page.getByTestId("story-gap")).toHaveText(picked);

    await page.getByRole("button", { name: /why not this one/i }).click();
    // The tutor is asked about the pair, in this passage, by itself.
    await expect.poll(() => backend.callsTo("assistant-chat").length).toBeGreaterThan(0);
    const body = backend.lastCallTo("assistant-chat")?.body as { messages?: Array<{ content: string }>; seed?: unknown };
    expect(body.messages?.[0]?.content).toContain(`I put «${picked}» in the gap, but the word is «السوق»`);
    expect(body.seed).toEqual({ arabic: WHOLE, english: "It was very hot. We went to the market early." });

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /continue/i }).click();
    await expect.poll(() => backend.db.rows("word_reviews")[0]?.last_result).toBe("again");
  });
});

test.describe("an animation for an action word", () => {
  const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const FOLDER = "https://e2e.supabase.co/storage/v1/object/public/word-animations/word-assets/animation/ink-1/any/eat";
  const CLIP = `${FOLDER}/clip.mp4`;
  // The store files only web urls; a `data:` poster is not an animation's.
  const POSTER = `${FOLDER}/poster.png`;
  const LESSON = lessonId(0);
  const OTHERS = lessonId(1);
  const yesterday = () => new Date(Date.now() - 86_400_000).toISOString();
  const nextMonth = () => new Date(Date.now() + 86_400_000 * 30).toISOString();

  /**
   * A curriculum verb whose production card is due at step 7 ("say it"),
   * recognition settled past the picture step so the quiz no longer holds it,
   * and the clip scripts/curriculum-animations.ts filed for its action.
   */
  const verbDeck = (clips: Array<Record<string, unknown>>) => ({
    lessons: [
      aLesson({ id: LESSON, title: "Started lesson", display_order: 1 }),
      aLesson({ id: OTHERS, title: "Unopened lesson", display_order: 2 }),
    ],
    vocabulary_words: [
      aVocabularyWord({
        id: wordId(0),
        lesson_id: LESSON,
        word_arabic: "آكل",
        word_english: "I eat",
        category: "Verb — routine",
        image_url: `${PIXEL}#picture`,
      }),
      ...["house", "school", "restaurant", "car"].map((english, i) =>
        aVocabularyWord({ id: wordId(i + 1), lesson_id: OTHERS, word_arabic: ["بيت", "مدرسة", "مطعم", "سيارة"][i], word_english: english }),
      ),
    ],
    word_reviews: [
      aWordReview({
        id: reviewId(0),
        word_id: wordId(0),
        ease_factor: 10,
        repetitions: 3,
        next_review_at: nextMonth(),
        production_ease_factor: 3,
        production_repetitions: 2,
        production_next_review_at: yesterday(),
      }),
    ],
    lesson_progress: [aLessonProgress({ user_id: TEST_USER_ID, lesson_id: LESSON, words_total: 1, words_seen: 1 })],
    word_assets: clips,
    profiles: [aProfile({ review_style: "quiz" })],
  });

  const clipOfEating = {
    id: "asset-eat",
    concept_key: "eat",
    kind: "animation",
    dialect: null,
    style_version: "ink-1",
    url: CLIP,
    payload: { poster: POSTER, seconds: 4, aspect: "16:9" },
    meta: {},
    source: "generated",
    approved_at: null,
    created_at: new Date().toISOString(),
  };

  test("\"say it\" shows the verb's clip where its picture would be, and the take is scored", async ({ page }) => {
    await signIn(page);
    const backend = await stubSupabase(page, { tables: verbDeck([clipOfEating]) });
    backend.stubFunction("azure-pronunciation", {
      overall: 84,
      accuracy: 86,
      fluency: 80,
      completeness: 100,
      words: [],
      recognizedText: "آكل",
      locale: "ar-SA",
    });
    // The clip and its poster are held loading, so the player stays on screen;
    // the hermetic Chromium has no H.264 to play it with anyway.
    await page.route("**/word-animations/**", () => {});

    await page.goto("/review");

    await expect(page.getByText("Say it in Arabic")).toBeVisible();
    const clip = page.getByTestId("quiz-animation");
    await expect(clip).toHaveAttribute("src", CLIP);
    await expect(clip).toHaveAttribute("poster", POSTER);
    await expect(clip).toHaveAttribute("loop", "");
    expect(await clip.evaluate((v: HTMLVideoElement) => v.muted && v.playsInline && !v.controls)).toBe(true);
    // In the picture's place, and the meaning is behind a tap.
    await expect(page.locator(`img[src="${PIXEL}#picture"]`)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /show meaning/i })).toBeVisible();
    await expect(page.getByText("I eat", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: /^say it$/i }).click();
    await expect(page.getByText("Listening…")).toBeVisible();
    await page.waitForTimeout(250);
    await page.getByRole("button", { name: /^stop$/i }).click();
    await expect.poll(() => backend.callsTo("azure-pronunciation").length, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(page.getByText("84")).toBeVisible();
    await page.getByRole("button", { name: /continue/i }).click();

    await expect.poll(() => backend.db.rows("word_reviews")[0]?.production_repetitions).toBe(3);
    // Read only: a learner never has a clip made.
    expect(backend.callsTo("word-asset")).toEqual([]);
    expect(backend.db.writesTo("vocabulary_words")).toEqual([]);
  });

  test("a learner who asked for reduced motion is shown the poster, never the moving clip", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signIn(page);
    await stubSupabase(page, { tables: verbDeck([clipOfEating]) });
    await page.route("**/word-animations/**", () => {});

    await page.goto("/review");

    await expect(page.getByText("Say it in Arabic")).toBeVisible();
    await expect(page.getByTestId("quiz-animation-still")).toHaveAttribute("src", POSTER);
    await expect(page.getByTestId("quiz-animation")).toHaveCount(0);
  });

  test("a verb with no clip filed is asked from its picture, as before", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { tables: verbDeck([]) });

    await page.goto("/review");

    await expect(page.getByText("Say it in Arabic")).toBeVisible();
    await expect(page.locator(`img[src="${PIXEL}#picture"]`)).toBeVisible();
    await expect(page.getByTestId("quiz-animation")).toHaveCount(0);
  });
});

test.describe("a word's first jingle is the shared one", () => {
  const LESSON = lessonId(0);
  const SHARED =
    "https://e2e.supabase.co/storage/v1/object/public/flashcard-audio/word-assets/jingle/jingle-1/gulf/abc/1.wav";

  const aDeck = (reviews: Record<string, unknown>[] = []) => ({
    lessons: [aLesson({ id: LESSON, title: "Started lesson", display_order: 1 })],
    vocabulary_words: [
      aVocabularyWord({ id: wordId(0), lesson_id: LESSON, word_arabic: "السوق", word_english: "the market" }),
    ],
    word_reviews: reviews,
    lesson_progress: [aLessonProgress({ user_id: TEST_USER_ID, lesson_id: LESSON, words_total: 1, words_seen: 1 })],
  });

  test("asks the store first, and keeps its url rather than uploading a copy", async ({ page }) => {
    await signIn(page);
    const backend = await stubSupabase(page, { tables: aDeck() });
    backend.stubFunction("generate-word-jingle", { audioUrl: SHARED, lyrics: "السوق السوق", cached: true });

    await page.goto("/review");
    await page.getByRole("button", { name: /Create jingle/ }).click();

    await expect(page.getByRole("button", { name: /Play jingle/ })).toBeVisible();
    expect(backend.lastCallTo("generate-word-jingle")?.body).toMatchObject({
      word_arabic: "السوق",
      word_english: "the market",
      share: true,
    });
    expect(backend.uploads().filter((key) => key.includes("jingles/"))).toEqual([]);
    const row = backend.db.raw("word_reviews").find((review) => review.word_id === wordId(0));
    expect(row?.jingle_audio_url).toBe(SHARED);
    expect(row?.jingle_lyrics).toBe("السوق السوق");
  });

  test("a regeneration is the learner's own jingle, uploaded as before", async ({ page }) => {
    await signIn(page);
    const backend = await stubSupabase(page, {
      tables: aDeck([aWordReview({ word_id: wordId(0), jingle_audio_url: SHARED, jingle_lyrics: "السوق" })]),
    });

    await page.goto("/review");
    await page.getByRole("button", { name: /Regenerate/ }).click();

    await expect.poll(() => backend.uploads().some((key) => key.includes("jingles/"))).toBe(true);
    expect(backend.lastCallTo("generate-word-jingle")?.body).toMatchObject({ share: false });
    const row = backend.db.raw("word_reviews").find((review) => review.word_id === wordId(0));
    expect(row?.jingle_audio_url).not.toBe(SHARED);
  });
});
