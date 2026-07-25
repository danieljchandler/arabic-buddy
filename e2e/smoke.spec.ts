import { test, expect } from "@playwright/test";
import { signIn, stubSupabase } from "./support/supabase";

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
