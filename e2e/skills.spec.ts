import { expect, test } from "./support/fixtures";

/**
 * A skill page: one skill, and everything in the app that trains it.
 *
 * These exist because of a bug the hub removal introduced and the route tests
 * could not see. The chooser's four tiles pointed straight at a single page
 * each — "Read" opened /reading, one of five reading surfaces — so Souq News,
 * the Reading Library, Interactive Stories and Bible Reading were left with no
 * door except the account page, listed under "Tools & content" between the
 * meme analyser and the dialect comparer. Every one of them still worked, and
 * every one of their tests still passed, because a test navigates by URL and
 * never asks how a person would have got there.
 *
 * So what these hold in place is findability: if you are looking for something
 * to read, the reading things are under Read.
 */

test.describe("a skill page", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("lists everything that trains the skill, not just one activity", async ({ page }) => {
    await page.goto("/skills/read");

    // The five reading surfaces. Souq News is the one that prompted this:
    // it was reachable only from the account page, filed under "Tools".
    await expect(page.getByRole("link", { name: /Reading Practice/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Souq News/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Reading Library/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Interactive Stories/ })).toBeVisible();
  });

  test("is reachable from the chooser by the name of the skill", async ({ page }) => {
    await page.goto("/choose");
    await page.getByRole("link", { name: /Read/ }).first().click();

    // The whole point: someone hunting for something to read taps "Read" and
    // finds the reading things, without knowing any of their names first.
    await expect(page).toHaveURL(/\/skills\/read$/);
    await expect(page.getByRole("link", { name: /Souq News/ })).toBeVisible();
  });

  test("opens the activity it lists", async ({ page }) => {
    await page.goto("/skills/read");
    await page.getByRole("link", { name: /Souq News/ }).click();

    await expect(page).toHaveURL(/\/souq-news$/);
  });

  test("sends an unknown skill back to the chooser", async ({ page }) => {
    await page.goto("/skills/nonsense");

    // A mistyped skill is a mistyped URL, not a page. The chooser is the
    // honest answer to "which one did you mean".
    await expect(page).toHaveURL(/\/choose$/);
  });

  test("keeps a way back to the chooser", async ({ page }) => {
    await page.goto("/skills/write");
    await page.getByRole("link", { name: /Skills/ }).first().click();

    await expect(page).toHaveURL(/\/choose$/);
  });
});
