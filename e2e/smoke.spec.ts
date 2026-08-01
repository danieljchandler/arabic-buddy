import { test, expect } from "@playwright/test";
import { signIn, stubSupabase, TEST_USER_ID } from "./support/supabase";

test.describe("signed out", () => {
  test("landing page renders with a sign-up call to action", async ({ page }) => {
    await stubSupabase(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /learn real spoken arabic/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /join the beta/i })).toBeVisible();
  });

  test("protected routes redirect to /auth", async ({ page }) => {
    await stubSupabase(page);
    await page.goto("/review");

    await expect(page).toHaveURL(/\/auth$/);
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
  });

  test("/today still resolves after the page was merged into Home", async ({ page }) => {
    await stubSupabase(page);
    await page.goto("/today");

    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  });
});

test.describe("signed in — home", () => {
  test("shows the daily queue inline instead of linking to a separate page", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { myWordsDue: 3 });
    await page.goto("/");

    // The queue itself, not a "Start today" card that navigates elsewhere.
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
    await expect(page.getByText(/of \d+ tasks done/)).toBeVisible();
    await expect(page.getByRole("button", { name: /start today/i })).toHaveCount(0);
  });

  test("due banner counts every deck and routes into the session", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { curriculumDue: 2, myWordsDue: 3 });
    await page.goto("/");

    // 2 curriculum + 3 saved words — the banner used to show only one deck.
    const banner = page.getByRole("button", { name: /5 cards due for review/i });
    await expect(banner).toBeVisible();

    await banner.click();
    await expect(page).toHaveURL(/\/review$/);
  });
});

test.describe("signed in — analytics", () => {
  test("word mastery reflects live SRS state, not a frozen stage column", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, {
      tables: {
        // Two well-established cards: high stability, several reviews. Read from
        // the persisted `stage` column these would show as New forever, since
        // only the Anki importer ever writes it.
        user_vocabulary: [
          { repetitions: 9, ease_factor: 120, review_count: 9, correct_count: 8, word_arabic: "أ", word_english: "a" },
          { repetitions: 7, ease_factor: 90, review_count: 7, correct_count: 7, word_arabic: "ب", word_english: "b" },
        ],
      },
    });
    await page.goto("/analytics");

    const mastered = page.locator("div").filter({ hasText: /^Mastered/ }).first();
    await expect(mastered).toContainText("2");
    await expect(mastered).toContainText("100%");
  });
});

test.describe("signed in — review session", () => {
  test("shows a curriculum card with session-wide progress", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { curriculumDue: 2, myWordsDue: 4, phrasesDue: 1 });
    await page.goto("/review");

    await expect(page.getByText("كلمة1")).toBeVisible();
    // Progress spans the whole day, not just the deck in front of you.
    await expect(page.getByText(/Curriculum · 1 \/ 2 due · 5 more in other decks/)).toBeVisible();
  });

  test("forwards past an empty deck into one that has cards", async ({ page }) => {
    await signIn(page);
    // Nothing in curriculum, work waiting in saved words.
    await stubSupabase(page, { curriculumDue: 0, myWordsDue: 3 });
    await page.goto("/review");

    await expect(page).toHaveURL(/\/review\/my-words$/);
    await expect(page.getByText(/My Words · 1 \/ 3 due/)).toBeVisible();
  });

  test("offers the next deck instead of dead-ending when a deck is clear", async ({ page }) => {
    await signIn(page);
    // Saved words are clear, but phrases are still due.
    await stubSupabase(page, { myWordsDue: 0, phrasesDue: 2 });
    await page.goto("/review/my-words");

    await expect(page.getByRole("heading", { name: /deck complete/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /continue with 2 phrase cards/i })).toBeVisible();
  });

  test("reports the session finished when every deck is clear", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { curriculumDue: 0, myWordsDue: 0, phrasesDue: 0 });
    await page.goto("/review/my-words");

    await expect(page.getByRole("heading", { name: /all caught up/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /continue with/i })).toHaveCount(0);
  });
});

test.describe("signed in — curriculum", () => {
  const STAGE_ID = "55555555-0000-4000-8000-000000000001";
  const LESSON_A = "66666666-0000-4000-8000-000000000001";
  const LESSON_B = "66666666-0000-4000-8000-000000000002";

  const curriculumTables = (progress: Record<string, unknown>[] = []) => ({
    curriculum_stages: [
      {
        id: STAGE_ID,
        name: "Foundations",
        name_arabic: "الأساسيات",
        stage_number: 1,
        cefr_level: "A1",
        description: null,
        display_order: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    lessons: [
      {
        id: LESSON_A,
        stage_id: STAGE_ID,
        title: "Greetings",
        title_arabic: "تحيات",
        icon: "📚",
        gradient: "bg-gradient-green",
        display_order: 1,
        dialect_module: "Gulf",
        cefr_target: "A1",
        duration_minutes: 15,
        unlock_condition: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        vocabulary_words: [{ id: "w1" }, { id: "w2" }],
      },
      {
        id: LESSON_B,
        stage_id: STAGE_ID,
        title: "At the Market",
        title_arabic: "في السوق",
        icon: "📚",
        gradient: "bg-gradient-green",
        display_order: 2,
        dialect_module: "Gulf",
        cefr_target: "A1",
        duration_minutes: 15,
        unlock_condition: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        vocabulary_words: [{ id: "w3" }],
      },
    ],
    lesson_progress: progress,
  });

  test("lists stages with their lessons — the curriculum used to be admin-only", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { tables: curriculumTables() });
    await page.goto("/curriculum");

    await expect(page.getByRole("heading", { name: "Foundations" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Greetings/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /At the Market/ })).toBeVisible();
  });

  test("marks exactly one lesson as next up", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { tables: curriculumTables() });
    await page.goto("/curriculum");

    // One obvious next action, not a wall of equally-weighted rows.
    await expect(page.getByText("Next up")).toHaveCount(1);
  });

  test("shows a completed lesson with its best score, and moves next up along", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, {
      tables: curriculumTables([
        {
          lesson_id: LESSON_A,
          status: "completed",
          last_word_index: 0,
          words_seen: 2,
          words_total: 2,
          best_score: 90,
          completed_at: new Date().toISOString(),
        },
      ]),
    });
    await page.goto("/curriculum");

    await expect(page.getByText(/Completed · best 90%/)).toBeVisible();
    const nextUp = page.getByRole("link", { name: /At the Market/ });
    await expect(nextUp).toContainText("Next up");
  });

  test("a lesson row links into the lesson", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { tables: curriculumTables() });
    await page.goto("/curriculum");

    await page.getByRole("link", { name: /Greetings/ }).click();
    await expect(page).toHaveURL(new RegExp(`/learn/${LESSON_A}$`));
  });
});

test.describe("signed in — grammar drills", () => {
  /**
   * `user_concept_mastery` rows as PostgREST returns them for the embedded
   * `curriculum_concepts!inner(...)` select the page issues.
   */
  const masteryRow = (key: string, label: string, exposures: number, correct: number) => ({
    user_id: TEST_USER_ID,
    exposures,
    correct,
    incorrect: exposures - correct,
    ease: 2.3,
    strength: correct / exposures >= 0.8 ? "strong" : "learning",
    next_due_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    curriculum_concepts: { key, display_english: label, kind: "grammar", dialect: "Gulf" },
  });

  test("a category the learner has drilled shows its standing", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, {
      tables: { user_concept_mastery: [masteryRow("negation", "Negation", 10, 3)] },
    });
    await page.goto("/grammar");

    // The score used to be rendered once on the results screen and dropped.
    await expect(page.getByText(/Just started · 30%/)).toBeVisible();
  });

  test("shows nothing for categories never drilled", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { tables: { user_concept_mastery: [] } });
    await page.goto("/grammar");

    await expect(page.getByRole("button", { name: /Negation/ })).toBeVisible();
    // A zeroed-out bar on a category you've never opened is noise, not data.
    await expect(page.getByText(/·\s*\d+%/)).toHaveCount(0);
  });

  test("nudges toward one category instead of six equal tiles", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, {
      tables: {
        user_concept_mastery: [
          masteryRow("verb-conjugation", "Verb Conjugation", 10, 9),
          masteryRow("pronouns", "Pronouns", 10, 9),
          masteryRow("negation", "Negation", 10, 2),
          masteryRow("possessives", "Possessives", 10, 9),
          masteryRow("questions", "Question Forms", 10, 9),
          masteryRow("sentence-structure", "Sentence Structure", 10, 9),
        ],
      },
    });
    await page.goto("/grammar");

    await expect(page.getByText(/You're weakest on/)).toContainText("Negation");
  });
});
