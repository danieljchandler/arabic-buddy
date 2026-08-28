import { expect, test } from "./support/fixtures";
import {
  aSocialPost,
  aTrendingTopic,
  socialPostId,
  trendingTopicId,
} from "../src/test/support/factories";

/**
 * The Trending page: per-country X trend chips plus the screened social feed.
 *
 * The property worth a browser test is the seam between the two halves of the
 * feature — the harvester's screening decisions (rows in the table) and what a
 * visitor actually sees. A pending row leaking into the page would mean
 * unscreened content in front of learners, which is the one thing the whole
 * pipeline exists to prevent.
 */

test("a visitor sees trend chips and only screened posts", async ({ page, db }) => {
  db.seed("trending_topics", [
    aTrendingTopic({ id: trendingTopicId(0), topic: "#يوم_الجمعه", country: "Saudi Arabia" }),
    aTrendingTopic({ id: trendingTopicId(1), topic: "#الكويت", country: "Kuwait", rank: 1 }),
  ]);
  db.seed("social_posts", [
    aSocialPost({ id: socialPostId(0), arabic_text: "شلونكم يا جماعة؟ خبر حلو اليوم" }),
    aSocialPost({
      id: socialPostId(1),
      external_id: "kuwaitnews/999",
      arabic_text: "أعلنت الوزارة عن قرار جديد",
      status: "pending",
    }),
  ]);

  // Signed out on purpose: /trending is a public door like /discover.
  await page.goto("/trending");

  await expect(page.getByText("#يوم_الجمعه")).toBeVisible();
  await expect(page.getByText("Saudi Arabia")).toBeVisible();
  await expect(page.getByText("شلونكم يا جماعة؟ خبر حلو اليوم")).toBeVisible();
  // The pending row exists in the table but has not passed the screen.
  await expect(page.getByText("أعلنت الوزارة عن قرار جديد")).not.toBeVisible();
});

test("Study hands the post to Translate with nothing to paste", async ({ page, db }) => {
  db.seed("social_posts", [
    aSocialPost({ id: socialPostId(0), arabic_text: "وش رايكم بهالمطعم الجديد؟" }),
  ]);

  await page.goto("/trending");
  await page.getByRole("button", { name: "Study this" }).click();

  // The share-handoff route: Translate picks the text up on mount and runs
  // with it — the tap on Study was the "go" gesture.
  await expect(page).toHaveURL(/\/translate/);
  await expect(page.getByText("وش رايكم بهالمطعم الجديد؟")).toBeVisible();
});

test("an empty harvest shows an explanation, not a broken page", async ({ page }) => {
  await page.goto("/trending");

  await expect(page.getByText("No trends captured yet")).toBeVisible();
  // The empty state names the screening on purpose: "nothing here" on a feed
  // page reads as a bug unless it says why the bar exists.
  await expect(page.getByText("Nothing has passed the screen yet")).toBeVisible();
});
