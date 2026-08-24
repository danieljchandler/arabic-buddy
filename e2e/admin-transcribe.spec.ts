import { expect, test } from "./support/fixtures";
import { aDiscoverVideo, videoId } from "../src/test/support/factories";
import type { SupabaseBackend } from "../src/test/support/server/handler";

/**
 * /admin/transcribe — where native speakers check the AI's Arabic and English.
 *
 * The queue and the workspace are the only pages a `transcriber` can open, so
 * the first thing worth proving is that they *can* — the role is useless if the
 * layout's allow-list bounces them — and the second is what the checkmark
 * actually claims. A tick that survives an edit to the line it approved is a
 * false statement that a native speaker read those exact words, and it is the
 * kind of falsehood nobody notices, because a ticked line looks finished.
 */

const VIDEO = videoId(0);
const OTHER_VIDEO = videoId(1);

/**
 * Deliberately tokenless.
 *
 * The card draws its Arabic from the line's tokens, so a line with none used to
 * render as a blank row a reviewer could neither read nor click into. The
 * adapter now falls back to splitting on whitespace, and leaving these empty is
 * what keeps that covered from the outside.
 */
const LINES = [
  { id: "L1", arabic: "شلونك اليوم", translation: "How are you today", startMs: 0, endMs: 1500, tokens: [] },
  { id: "L2", arabic: "زين الحمدلله", translation: "Fine, thank God", startMs: 1500, endMs: 3000, tokens: [] },
];

function seedVideos(db: SupabaseBackend["db"]) {
  db.seed("discover_videos", [
    aDiscoverVideo({
      id: VIDEO,
      title: "Greeting in the souq",
      published: false,
      transcript_lines: LINES,
      cultural_context: "A greeting exchange.",
    }),
    aDiscoverVideo({
      id: OTHER_VIDEO,
      title: "Nothing transcribed yet",
      transcript_lines: [],
    }),
  ]);
}

test.describe("who may open it", () => {
  test("lets a transcriber in", async ({ page, signInAs, db }) => {
    // `signInAs` seeds the persona's roles, so the role itself needs no setup.
    await signInAs("transcriber");
    seedVideos(db);

    await page.goto("/admin/transcribe");

    await expect(page.getByRole("heading", { name: "Transcription review" })).toBeVisible();
  });

  test("lets an admin in", async ({ page, signInAs, db }) => {
    await signInAs("admin");
    seedVideos(db);

    await page.goto("/admin/transcribe");

    await expect(page.getByRole("heading", { name: "Transcription review" })).toBeVisible();
  });

  test("keeps a transcriber out of the rest of the console", async ({ page, signInAs }) => {
    await signInAs("transcriber");

    await page.goto("/admin/bible-access");

    // Back to the dashboard: they hold a privileged role, just not this one.
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("turns a plain learner away", async ({ page, signInAs }) => {
    await signInAs("free");

    await page.goto("/admin/transcribe");

    await expect(page).toHaveURL(/\/admin\/login$/);
  });
});

test.describe("the queue", () => {
  test("lists a video that has lines and hides one that has none", async ({ page, signInAs, db }) => {
    await signInAs("transcriber");
    seedVideos(db);

    await page.goto("/admin/transcribe");

    await expect(page.getByText("Greeting in the souq")).toBeVisible();
    // Nothing to review on a video with no transcript.
    await expect(page.getByText("Nothing transcribed yet")).toHaveCount(0);
  });

  test("shows how much of a video is left", async ({ page, signInAs, db }) => {
    await signInAs("transcriber");
    seedVideos(db);

    await page.goto("/admin/transcribe");

    await expect(page.getByText("0/2")).toBeVisible();
  });

  test("opens the workspace", async ({ page, signInAs, db }) => {
    await signInAs("transcriber");
    seedVideos(db);

    await page.goto("/admin/transcribe");
    await page.getByText("Greeting in the souq").click();

    await expect(page).toHaveURL(new RegExp(`/admin/transcribe/${VIDEO}$`));
  });
});

test.describe("the workspace", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("transcriber");
    seedVideos(db);
  });

  test("shows the transcript and the progress", async ({ page }) => {
    await page.goto(`/admin/transcribe/${VIDEO}`);

    await expect(page.getByText("0 / 2 lines checked")).toBeVisible();
    await expect(page.getByText("How are you today")).toBeVisible();
  });

  test("records a line as checked by a human", async ({ page, db }) => {
    await page.goto(`/admin/transcribe/${VIDEO}`);

    await page.getByRole("checkbox", { name: /Mark line 1 as reviewed/ }).click();

    await expect(page.getByText("1 / 2 lines checked")).toBeVisible();

    const rows = db.rows("transcript_line_reviews");
    expect(rows).toHaveLength(1);
    // The text signed off is stored, not just the fact of signing off.
    expect(rows[0].reviewed_arabic).toBe("شلونك اليوم");
  });

  test("takes the tick back", async ({ page, db }) => {
    await page.goto(`/admin/transcribe/${VIDEO}`);

    const box = page.getByRole("checkbox", { name: /line 1/i });
    await box.click();
    await expect(page.getByText("1 / 2 lines checked")).toBeVisible();

    await box.click();

    await expect(page.getByText("0 / 2 lines checked")).toBeVisible();
    expect(db.rows("transcript_line_reviews")).toHaveLength(0);
  });

  test("stops claiming a line is checked once it changes", async ({ page }) => {
    // The whole point of storing the approved text. A tick that survives an
    // edit is a false statement that a native speaker read those exact words,
    // and it is the kind nobody catches, because a ticked line looks finished.
    await page.goto(`/admin/transcribe/${VIDEO}`);

    await page.getByRole("checkbox", { name: /Mark line 1 as reviewed/ }).click();
    await expect(page.getByText("1 / 2 lines checked")).toBeVisible();

    // Click a word to open the inline editor, then commit without splitting.
    await page.locator('[data-segment-id] span[dir="rtl"] span[role="button"]').first().click();
    const box = page.locator('textarea[dir="rtl"]').first();
    await box.fill("شخبارك اليوم");
    await box.press("Control+Enter");

    await expect(page.getByText("0 / 2 lines checked")).toBeVisible();
    await expect(page.getByText("1 changed since being checked")).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: /changed since it was reviewed/ }),
    ).toBeVisible();
  });

  test("offers the per-line listening controls", async ({ page }) => {
    await page.goto(`/admin/transcribe/${VIDEO}`);

    await expect(page.getByText("Listen at")).toBeVisible();
    await expect(page.getByRole("button", { name: "0.5×" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Play line 1 slowly" })).toBeVisible();
  });

  test("says the speed does not change the published video", async ({ page }) => {
    await page.goto(`/admin/transcribe/${VIDEO}`);

    await expect(page.getByText(/not the published video/i)).toBeVisible();
  });

  test("lists the keyboard shortcuts", async ({ page }) => {
    await page.goto(`/admin/transcribe/${VIDEO}`);

    await page.getByRole("button", { name: /Shortcuts/ }).click();

    await expect(page.getByRole("dialog", { name: /Keyboard shortcuts/i })).toBeVisible();
    await expect(page.getByText("Play this line slowly")).toBeVisible();
  });

  test("leaves a comment on a line", async ({ page, db }) => {
    await page.goto(`/admin/transcribe/${VIDEO}`);

    await page.getByRole("button", { name: /Comments on line 1/ }).click();
    await page.getByLabel("Comment", { exact: true }).fill("وايد is Gulf, not Egyptian.");
    await page.getByRole("button", { name: "Add comment" }).click();

    await expect
      .poll(() => db.rows("transcript_line_comments").length)
      .toBe(1);
    expect(db.rows("transcript_line_comments")[0].body).toBe("وايد is Gulf, not Egyptian.");
  });

  test("saves the cultural notes", async ({ page, db }) => {
    await page.goto(`/admin/transcribe/${VIDEO}`);

    await page.getByRole("tab", { name: /Notes/ }).click();
    await page.getByLabel("Cultural notes").fill("A greeting between neighbours.");
    await page.getByRole("button", { name: "Save notes" }).click();

    await expect
      .poll(() => db.rows("discover_videos").find((r) => r.id === VIDEO)?.cultural_context)
      .toBe("A greeting between neighbours.");
  });

  test("logs the note change with both versions", async ({ page, db }) => {
    await page.goto(`/admin/transcribe/${VIDEO}`);

    await page.getByRole("tab", { name: /Notes/ }).click();
    await page.getByLabel("Cultural notes").fill("Revised note.");
    await page.getByRole("button", { name: "Save notes" }).click();

    await expect.poll(() => db.rows("transcript_line_revisions").length).toBe(1);

    await page.getByRole("tab", { name: "Activity" }).click();

    await expect(page.getByText("Before")).toBeVisible();
    await expect(page.getByText("A greeting exchange.")).toBeVisible();
    await expect(page.getByText("After")).toBeVisible();
    await expect(page.getByText("Revised note.")).toBeVisible();
  });

  test("narrows a video from a region to a sub-dialect", async ({ page, db }) => {
    // The whole point of the two-level picker, driven end to end: the fixture
    // arrives labelled "Gulf", which is the resolution of a passport rather
    // than of a dialect, and comes out as Jeddah.
    await page.goto(`/admin/transcribe/${VIDEO}`);

    await page.getByRole("tab", { name: /Notes/ }).click();
    await page.getByLabel("Dialect", { exact: true }).click();
    await page.getByRole("option", { name: "Saudi" }).click();
    await page.getByLabel("Sub-dialect").click();
    await page.getByRole("option", { name: /Ḥijāzi/ }).click();
    await page.getByRole("button", { name: "Save notes" }).click();

    await expect
      .poll(() => db.rows("discover_videos").find((r) => r.id === VIDEO)?.dialect_subvariety)
      .toBe("hijazi");
    expect(db.rows("discover_videos").find((r) => r.id === VIDEO)?.dialect).toBe("Saudi");
  });

  test("records a dialect-specific feature apart from the grammar points", async ({ page, db }) => {
    // The separation is the feature: the grammar card above is what a learner
    // should take away about Arabic, this one is what places the speaker.
    await page.goto(`/admin/transcribe/${VIDEO}`);

    await page.getByRole("tab", { name: /Notes/ }).click();
    await page.getByRole("button", { name: "Add a dialect feature" }).click();
    await page
      .getByLabel("Dialect feature 1 contrast")
      .fill("Riyadh would say وش here.");
    await page.getByRole("button", { name: "Save notes" }).click();

    await expect
      .poll(
        () =>
          (db.rows("discover_videos").find((r) => r.id === VIDEO)
            ?.dialect_features as unknown[])?.length,
      )
      .toBe(1);

    const video = db.rows("discover_videos").find((r) => r.id === VIDEO)!;
    const feature = (video.dialect_features as Record<string, unknown>[])[0];
    expect(feature.contrast).toBe("Riyadh would say وش here.");
    // It did not leak into the grammar points, which are a different question.
    expect(video.grammar_points).toEqual([]);
  });

  test("clears a sub-dialect stranded by a change of dialect", async ({ page, db }) => {
    // A reviewer correcting a mis-tagged video must not leave it claiming
    // "Ḥijāzi" under "Egyptian" — nobody ever asserted that pair.
    db.raw("discover_videos").find((r) => r.id === VIDEO)!.dialect_subvariety = "khaliji-hadar";

    await page.goto(`/admin/transcribe/${VIDEO}`);
    await page.getByRole("tab", { name: /Notes/ }).click();
    await page.getByLabel("Dialect", { exact: true }).click();
    await page.getByRole("option", { name: "Egyptian" }).click();
    await page.getByRole("button", { name: "Save notes" }).click();

    await expect
      .poll(() => db.rows("discover_videos").find((r) => r.id === VIDEO)?.dialect)
      .toBe("Egyptian");
    expect(
      db.rows("discover_videos").find((r) => r.id === VIDEO)?.dialect_subvariety,
    ).toBeNull();
  });

  test("has no way to publish the video", async ({ page }) => {
    // The reason this workspace exists rather than reusing the admin video
    // form: a reviewer must not be one misclick from shipping a clip.
    await page.goto(`/admin/transcribe/${VIDEO}`);

    await expect(page.getByRole("button", { name: /^Publish/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Delete/ })).toHaveCount(0);
  });
});
