import { expect, test } from "./support/fixtures";
import { aListenEpisode, aSetPhraseOccasion, anAuthenticStory, anInteractiveStory } from "../src/test/support/factories";

/**
 * When the backend fails, the page must say so.
 *
 * Every list page used to fold a failed fetch into its empty state, so an
 * outage rendered as "No videos", "No lessons yet", "No rankings yet" — the
 * app looked empty rather than broken, and there was nothing to retry
 * (2026-09-04 audit, M3). These pin the other direction: a 500 from the
 * table behind the page shows QueryErrorState's alert with a retry, and the
 * empty-state copy stays off the screen.
 */

const failed = (page: import("@playwright/test").Page) => page.getByRole("alert");

test.describe("a backend failure is shown, not mistaken for emptiness", () => {
  test.beforeEach(async ({ expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
  });

  test("curriculum", async ({ page, db }) => {
    db.failAlways("lessons", 500);

    await page.goto("/curriculum");

    await expect(failed(page)).toContainText("Couldn't load the curriculum");
    await expect(page.getByRole("button", { name: /try again/i })).toBeVisible();
    await expect(page.getByText(/No lessons yet/)).toHaveCount(0);
  });

  test("leaderboard", async ({ page, db }) => {
    db.failAlways("leaderboard_profiles", 500);

    await page.goto("/leaderboard");

    await expect(failed(page)).toContainText("Couldn't load the leaderboard");
    await expect(page.getByText("No rankings yet")).toHaveCount(0);
  });

  test("stories", async ({ page, db }) => {
    db.seed("interactive_stories", [anInteractiveStory({ status: "published" })]);
    db.failAlways("interactive_stories", 500);

    await page.goto("/stories");

    await expect(failed(page)).toContainText("Couldn't load stories");
    await expect(page.getByText("No stories yet")).toHaveCount(0);
  });

  test("reading library", async ({ page, db }) => {
    db.seed("authentic_stories", [anAuthenticStory()]);
    db.failAlways("authentic_stories", 500);

    await page.goto("/reading-library");

    await expect(failed(page)).toContainText("Couldn't load the library");
    await expect(page.getByText("No stories available")).toHaveCount(0);
  });

  test("set phrases", async ({ page, db }) => {
    db.seed("set_phrase_occasions", [aSetPhraseOccasion()]);
    db.failAlways("set_phrase_occasions", 500);

    await page.goto("/set-phrases");

    await expect(failed(page)).toContainText("Couldn't load occasions");
    await expect(page.getByText(/No occasions yet/)).toHaveCount(0);
  });

  test("listen", async ({ page, db, signInAs }) => {
    await signInAs("free");
    db.seed("listen_episodes", [aListenEpisode()]);
    db.failAlways("listen_episodes", 500);

    await page.goto("/listen");

    await expect(failed(page)).toContainText("Couldn't load episodes");
  });

  test("retry re-asks the backend", async ({ page, db }) => {
    db.seed("interactive_stories", [anInteractiveStory({ title: "The Souq at Dawn", status: "published" })]);
    db.failAlways("interactive_stories", 500);

    await page.goto("/stories");
    await expect(failed(page)).toBeVisible();

    db.clearFailure("interactive_stories");
    await page.getByRole("button", { name: /try again/i }).click();

    await expect(page.getByText("The Souq at Dawn")).toBeVisible();
    await expect(failed(page)).toHaveCount(0);
  });
});
