import { expect, test } from "./support/fixtures";
import { TEST_USER_ID } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * Sound pairs — perception training.
 *
 * The page derives everything from two tables: the dialect's word inventory
 * (pairs are found by swapping a contrast letter) and the learner's per-
 * contrast progress. What is worth pinning: a contrast with no pairs in the
 * inventory reads as "not yet" rather than breaking; an item is identification
 * with Arabic-script options and feedback that names the contrast; and a
 * finished round adds to the row rather than replacing it.
 */

const word = (id: string, arabic: string, english: string) => ({
  id: `77777777-0000-4000-8000-${id.padStart(12, "0")}`,
  word_arabic: arabic,
  word_english: english,
  image_url: null,
  audio_url: null,
  topic_id: null,
  lesson_id: null,
  image_position: null,
  root: null,
  display_order: 1,
  dialect_module: "Gulf",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

/** Two ص/س minimal pairs, one ق/ك pair, and nothing for ح/ه. */
function seedInventory(db: MemoryDb) {
  db.seed("vocabulary_words", [
    word("1", "سيف", "sword"),
    word("2", "صيف", "summer"),
    word("3", "سبر", "probe"),
    word("4", "صبر", "patience"),
    word("5", "قلب", "heart"),
    word("6", "كلب", "dog"),
    word("7", "بيت", "house"),
  ]);
  db.seed("lessons", []);
  db.seed("topics", []);
}

test.describe("the list of pairs", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("offers the nine contrasts and marks the ones this dialect has no words for", async ({ page, db }) => {
    seedInventory(db);
    db.seed("user_perception_progress", []);

    await page.goto("/alphabet/sounds");

    await expect(page.getByRole("heading", { name: /Sound pairs/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Practise /, includeHidden: true })).toHaveCount(9);
    await expect(page.getByRole("button", { name: "Practise ص versus س" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Practise ح versus ه" })).toBeDisabled();
    await expect(page.getByText(/No word pairs for this sound/).first()).toBeVisible();
  });

  test("shows progress from the learner's rows", async ({ page, db }) => {
    seedInventory(db);
    db.seed("user_perception_progress", [{
      id: "cafe0000-0000-4000-8000-000000000001",
      user_id: TEST_USER_ID,
      dialect: "Gulf",
      contrast_id: "sad-sin",
      attempts: 20,
      correct: 15,
      seconds: 600,
      completed_at: null,
      resurfaced_at: null,
      resurface_attempts: 0,
      resurface_correct: 0,
      last_practiced_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }]);

    await page.goto("/alphabet/sounds");

    await expect(page.getByText(/10 \/ \d+ min · 75% right/)).toBeVisible();
  });
});

test.describe("a round", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedInventory(db);
    db.seed("user_perception_progress", []);
  });

  test("asks which word was heard, names the contrast, and records the round", async ({ page, db }) => {
    await page.goto("/alphabet/sounds");
    await page.getByRole("button", { name: "Practise ص versus س" }).click();

    await expect(page.getByText("1 / ")).toBeVisible();
    // Identification with Arabic-script options — two words, or the two letters.
    const options = page.locator("button[lang='ar']");
    await expect(options).toHaveCount(2);

    // Answer every item; feedback always names the contrast.
    for (let i = 0; i < 10; i++) {
      const current = page.locator("button[lang='ar']");
      const count = await current.count();
      if (count === 0) break;
      await current.first().click();
      await expect(page.getByRole("status")).toContainText(/That was .*, not /);
      const finish = page.getByRole("button", { name: "Finish" });
      if (await finish.isVisible()) {
        await finish.click();
        break;
      }
      await page.getByRole("button", { name: "Next" }).click();
    }

    await expect(page.getByRole("heading", { name: /^\d+ of \d+$/ })).toBeVisible();
    await expect.poll(() => db.rows("user_perception_progress").length).toBe(1);
    const row = db.rows("user_perception_progress")[0] as Record<string, unknown>;
    expect(row.contrast_id).toBe("sad-sin");
    expect(row.user_id).toBe(TEST_USER_ID);
    expect(Number(row.attempts)).toBeGreaterThan(0);
    expect(Number(row.seconds)).toBeGreaterThan(0);
  });

  test("says so when a contrast has nothing to play, instead of inventing words", async ({ page }) => {
    await page.goto("/alphabet/sounds");
    await expect(page.getByRole("button", { name: "Practise ح versus ه" })).toBeDisabled();
  });
});
