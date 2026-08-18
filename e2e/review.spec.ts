import { expect, test } from "@playwright/test";
import { signIn, stubSupabase } from "./support/supabase";

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
