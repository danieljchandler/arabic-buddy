import { expect, test } from "@playwright/test";
import { signIn, stubSupabase, TEST_USER_ID } from "./support/supabase";
import {
  aLesson,
  aLessonProgress,
  aVocabularyWord,
  lessonId,
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
    await expect(page.getByText(/Curriculum · 1 \/ 1 due/)).toBeVisible();
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
    await expect(page.getByText(/Curriculum · 1 \/ 2 due/)).toBeVisible();
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
