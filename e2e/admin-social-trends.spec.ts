import { expect, test } from "./support/fixtures";
import { aSocialPost, aTrendingTopic, socialPostId, trendingTopicId } from "../src/test/support/factories";

/**
 * `/admin/social-trends` — the review queue for harvested social posts.
 *
 * The whole feature is admin-side: the AI screen only sorts posts into a
 * queue, and this page is where a person publishes or bins them. The seams
 * worth a browser test are the status tabs (a pending post surfacing under
 * "Approved" would read as published), the approve action actually writing
 * the status, and the harvest button reporting its per-dialect result — the
 * signal that tells the reviewer whether Gulf finally has material.
 */

const screenedPost = (over: Record<string, unknown> = {}) =>
  aSocialPost({
    status: "screened",
    screen: { register: "mixed", confidence: 0.55, reason: "Colloquial with some formal phrasing." },
    ...over,
  });

test.describe("the review queue", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("admin");
  });

  test("opens on what needs review, with the screen's case notes", async ({ page, db }) => {
    db.seed("social_posts", [
      screenedPost({ id: socialPostId(0), arabic_text: "شلونكم يا جماعة؟" }),
      aSocialPost({ id: socialPostId(1), external_id: "a/2", arabic_text: "أعلنت الوزارة", status: "rejected" }),
    ]);
    db.seed("trending_topics", [
      aTrendingTopic({ id: trendingTopicId(0), topic: "#يوم_الجمعه", country: "Saudi Arabia" }),
    ]);

    await page.goto("/admin/social-trends");

    // The queue tab is the landing view; the rejected row stays off it.
    await expect(page.getByText("شلونكم يا جماعة؟")).toBeVisible();
    await expect(page.getByText("أعلنت الوزارة")).not.toBeVisible();
    // The verdict is shown so the reviewer judges the screen's call rather
    // than re-analysing from scratch.
    await expect(page.getByText(/mixed \(55%\)/)).toBeVisible();
    // Trend chips ride along for context.
    await expect(page.getByText("#يوم_الجمعه")).toBeVisible();
  });

  test("approving writes the status and clears the post from the queue", async ({ page, db }) => {
    db.seed("social_posts", [screenedPost({ id: socialPostId(0), arabic_text: "وش السالفة؟" })]);

    await page.goto("/admin/social-trends");
    await page.getByRole("button", { name: "Approve" }).click();

    // The human verdict is the publish action — the write is the deliverable.
    await expect(page.getByText("وش السالفة؟")).not.toBeVisible();
    const write = db.writesTo("social_posts").find((w) => w.method === "PATCH");
    expect(write?.payload[0]).toMatchObject({ status: "approved" });

    await page.getByRole("tab", { name: "Approved" }).click();
    await expect(page.getByText("وش السالفة؟")).toBeVisible();
  });

  test("a harvest run reports its per-dialect outcome", async ({ page, db, backend }) => {
    db.seed("social_posts", []);
    backend.stubFunction("harvest-social-trends", {
      topics: 8,
      telegramPosts: 6,
      redditPosts: 0,
      screenCalls: 12,
      allTargetsReached: false,
      review: {
        Gulf: { target: 5, have: 2, screenedThisRun: { screened: 2, rejected: 6 }, queueEmpty: true },
        Egyptian: { target: 5, have: 5, screenedThisRun: { screened: 4 }, queueEmpty: false },
        Yemeni: { target: 5, have: 1, screenedThisRun: { screened: 1 }, queueEmpty: true },
      },
    });

    await page.goto("/admin/social-trends");
    await page.getByRole("button", { name: /run harvest/i }).click();

    // "Gulf 2/5" with an empty queue is the add-more-sources signal; a bare
    // success toast would bury exactly the number the reviewer asked for.
    await expect(page.getByText(/Gulf 2\/5/)).toBeVisible();
    await expect(page.getByText(/Egyptian 5\/5/)).toBeVisible();
  });

  test("an empty queue explains where posts come from", async ({ page, db }) => {
    db.seed("social_posts", []);

    await page.goto("/admin/social-trends");

    await expect(page.getByText("Review queue is empty")).toBeVisible();
    await expect(page.getByText(/run a harvest/i)).toBeVisible();
  });
});
