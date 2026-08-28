import { expect, test, type Page } from "./support/fixtures";
import { aProfile, aUserXp } from "../src/test/support/factories";
import { streaming } from "../src/test/support/server/functions";

/**
 * The Ask AI panel has to leave the learner looking at whatever they asked
 * about. It's non-modal and only takes part of the screen, which means two
 * things that unit tests can't see: the page behind it is still on screen and
 * still clickable, and the panel doesn't cover the reading material.
 *
 * The dismiss-on-outside-click guard is the fragile one. Radix dismisses a
 * non-modal dialog on any outside pointerdown by default, so losing the guard
 * would silently restore the old "panel closes the moment you touch the page"
 * behaviour while every other test stayed green.
 */

const PASSAGE = {
  title: "في المقهى",
  titleEnglish: "At the cafe",
  passage: "رحت المقهى الصبح. طلبت قهوة.",
  passageEnglish: "I went to the cafe in the morning. I ordered a coffee.",
  lines: [
    { arabic: "رحت المقهى الصبح.", english: "I went to the cafe in the morning." },
    { arabic: "طلبت قهوة.", english: "I ordered a coffee." },
  ],
  vocabulary: [{ arabic: "مقهى", english: "cafe" }],
  questions: [
    {
      question: "Where did the writer go?",
      options: [
        { text: "To the cafe", correct: true },
        { text: "To the market", correct: false },
      ],
    },
  ],
};

/**
 * The floating disc is the assistant's visible opener, so it is what these
 * specs click — a learner without the keyboard shortcut has to be able to get
 * in. (Cmd/Ctrl+K still works and keeps its own spec below.)
 */
const openPanel = async (page: Page) => {
  await page.getByRole("button", { name: "Ask AI" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
};

test.describe("Ask AI panel", () => {
  test.beforeEach(async ({ signInAs, backend, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile()]);
    db.seed("reading_passages", []);
    db.seed("user_xp", [aUserXp()]);
    backend.stubFunction("reading-passage", { passage: PASSAGE });
  });

  test("leaves the page visible above it on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/reading");

    const heading = page.getByRole("heading", { name: /reading practice/i });
    await expect(heading).toBeVisible();

    await openPanel(page);

    // The panel peeks from the bottom, so the top of the page is untouched.
    const dialog = page.getByRole("dialog");
    const panel = (await dialog.boundingBox())!;
    expect(panel.y).toBeGreaterThan(844 * 0.35);
    await expect(heading).toBeInViewport();

    await page.screenshot({ path: "/tmp/ask-ai-mobile-peek.png" });
  });

  test("does not close when the page behind it is clicked", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/reading");
    await expect(page.getByRole("heading", { name: /reading practice/i })).toBeVisible();
    await openPanel(page);

    // Tapping the page is how you'd pause a video or pick another line. It must
    // not dismiss the panel.
    await page.getByRole("heading", { name: /reading practice/i }).click();

    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("expands and collapses between the two heights", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/reading");
    await expect(page.getByRole("heading", { name: /reading practice/i })).toBeVisible();
    await openPanel(page);

    const dialog = page.getByRole("dialog");
    const peekTop = (await dialog.boundingBox())!.y;

    await page.getByRole("button", { name: "Expand panel" }).click();
    await expect(page.getByRole("button", { name: "Collapse panel" })).toBeVisible();
    const fullTop = (await dialog.boundingBox())!.y;
    expect(fullTop).toBeLessThan(peekTop);

    await page.screenshot({ path: "/tmp/ask-ai-mobile-full.png" });

    await page.getByRole("button", { name: "Collapse panel" }).click();
    await expect(page.getByRole("button", { name: "Expand panel" })).toBeVisible();
  });

  test("gives the whole screen to the conversation on request", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/reading");
    await expect(page.getByRole("heading", { name: /reading practice/i })).toBeVisible();
    await openPanel(page);

    const dialog = page.getByRole("dialog");
    expect((await dialog.boundingBox())!.height).toBeLessThan(844 * 0.7);

    await page.getByRole("button", { name: "Read full screen" }).click();
    await expect(page.getByRole("button", { name: "Exit full screen" })).toBeVisible();

    // The whole point: no more reading an answer through a letterbox. The
    // sheet grows upward from a pinned bottom edge, so poll on the top edge —
    // it only reaches the top of the screen once the animation has settled,
    // where a height threshold is satisfied part-way there.
    await expect.poll(async () => (await dialog.boundingBox())!.y).toBeLessThan(2);
    expect((await dialog.boundingBox())!.height).toBeGreaterThan(844 * 0.95);

    await page.screenshot({ path: "/tmp/ask-ai-mobile-fullscreen.png" });

    await page.getByRole("button", { name: "Exit full screen" }).click();
    await expect(page.getByRole("button", { name: "Read full screen" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /reading practice/i })).toBeInViewport();
  });

  test("widens past the rail into a reading column on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/reading");
    await expect(page.getByRole("heading", { name: /reading practice/i })).toBeVisible();
    await openPanel(page);

    const dialog = page.getByRole("dialog");
    expect((await dialog.boundingBox())!.width).toBeLessThan(1440 * 0.5);

    await page.getByRole("button", { name: "Read full screen" }).click();
    await expect(page.getByRole("button", { name: "Exit full screen" })).toBeVisible();
    // The rail widens rather than snapping, so poll past the transition.
    await expect
      .poll(async () => (await dialog.boundingBox())!.width)
      .toBeGreaterThan(1440 * 0.95);

    // Full width, but the text itself stays in a column you can read across.
    const column = page.locator("#ask-ai-body");
    expect((await column.boundingBox())!.width).toBeLessThan(900);

    await page.screenshot({ path: "/tmp/ask-ai-desktop-fullscreen.png" });
  });

  test("shows the sentence it was opened about, with the passage still on screen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/reading");
    await page.getByText("Read a Passage").click();
    await page.getByRole("button", { name: /beginner/i }).click();

    // The passage renders one tappable span per word, so match a word.
    const line = page.getByText("المقهى", { exact: true }).first();
    await expect(line).toBeVisible();

    // The per-line chip is what seeds the panel with the sentence — the
    // floating disc would carry the page context but no sentence. Chip and
    // disc share the name "Ask AI"; the chip comes first, the disc is
    // mounted last at the app root.
    await page.getByRole("button", { name: "Ask AI" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // The card names the sentence, and the passage is still readable above it.
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Sentence")).toBeVisible();
    await expect(dialog.getByText("رحت المقهى الصبح.").first()).toBeVisible();
    await expect(line).toBeInViewport();

    await page.screenshot({ path: "/tmp/ask-ai-seeded.png" });
  });

  test("does not dim the page on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/reading");
    await expect(page.getByRole("heading", { name: /reading practice/i })).toBeVisible();
    await openPanel(page);

    // The old panel painted a bg-black/80 scrim over everything.
    const dialog = page.getByRole("dialog");
    const panel = (await dialog.boundingBox())!;
    expect(panel.width).toBeLessThan(1440 * 0.5);
    await expect(page.getByRole("heading", { name: /reading practice/i })).toBeInViewport();

    await page.screenshot({ path: "/tmp/ask-ai-desktop.png" });
  });
});

/**
 * The panel embedded in a preview pane.
 *
 * A hosted preview (Lovable's, an editor's live pane, an embedded demo) puts
 * the app in an iframe whose *layout* viewport is whatever the host asked for,
 * which is routinely much taller than the pane the reader is looking at. Every
 * `dvh` measurement and every `bottom: 0` then points at a part of the frame
 * nobody can see, and a bottom sheet lands below the fold.
 *
 * That failure is quiet, which is what makes it worth a spec of its own: the
 * sheet is a thousand pixels tall, so its transcript never overflows, never
 * grows a scrollbar, and simply strands the rest of a long answer underneath
 * the visible pane — a learner sees the first paragraph of a reply, no
 * scrollbar, and no way to reach the rest. Nothing errors and nothing looks
 * broken from the inside.
 */
test.describe("Ask AI panel, embedded in a preview", () => {
  // Long enough that the reply cannot fit any plausible pane — the end of it
  // has to be reachable by scrolling rather than by luck.
  const LONG_REPLY = Array.from(
    { length: 20 },
    (_, i) =>
      `Paragraph ${i + 1}: what the word means, the grammar behind it, and how a Gulf speaker would actually use it.\n\n`,
  ).concat(["The last thing the answer says. ENDMARKER"]);

  /** The pane the reader can see; the frame's own viewport is far taller. */
  const PANE = { width: 1200, height: 700 };

  test.beforeEach(async ({ signInAs, backend, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile()]);
    db.seed("reading_passages", []);
    db.seed("user_xp", [aUserXp()]);
    backend.stubFunction("reading-passage", { passage: PASSAGE });
    backend.stubFunction("assistant-chat", () => streaming(...LONG_REPLY));
  });

  test("keeps a long answer readable inside the visible pane", async ({ page }) => {
    await page.setViewportSize(PANE);
    // Load the app once so the frame below is same-origin and signed in.
    await page.goto("/reading");
    await expect(page.getByRole("heading", { name: /reading practice/i })).toBeVisible();

    await page.setContent(`
      <style>html,body{margin:0;height:100%;overflow:hidden}
      .preview{position:absolute;top:0;left:0;width:390px;height:2000px;border:0}</style>
      <iframe class="preview" src="/reading"></iframe>
    `);

    const app = page.frameLocator("iframe.preview");
    const heading = app.getByRole("heading", { name: /reading practice/i });
    await expect(heading).toBeVisible();

    // Cmd/Ctrl+K goes to whichever frame has focus, so give it to the app.
    await heading.click();
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = app.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await app.getByPlaceholder("Ask a question…").fill("explain this");
    // A plain click, deliberately: Playwright refuses to click something
    // outside the window, which is exactly what the composer used to be.
    await app.getByRole("button", { name: "Send" }).click();
    await expect(app.getByText(/Paragraph 1:/)).toBeVisible();

    // The whole panel — transcript, composer and all — is inside the pane.
    const panel = (await dialog.boundingBox())!;
    expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.y + panel.height).toBeLessThanOrEqual(PANE.height + 1);

    // And the transcript overflows it, which is what gives the reader a
    // scrollbar instead of an answer that runs off into the dark.
    const transcript = app.locator("#ask-ai-body > div").first();
    const overflow = await transcript.evaluate(
      (el) => el.scrollHeight - el.clientHeight,
    );
    expect(overflow).toBeGreaterThan(0);

    // The end of the answer is reachable, and lands where it can be read.
    const end = app.getByText(/ENDMARKER/);
    await end.scrollIntoViewIfNeeded();
    const last = (await end.boundingBox())!;
    expect(last.y).toBeGreaterThanOrEqual(0);
    expect(last.y + last.height).toBeLessThanOrEqual(PANE.height + 1);

    await page.screenshot({ path: "/tmp/ask-ai-embedded-preview.png" });
  });

  test("spans the visible pane rather than the frame as a desktop rail", async ({ page }) => {
    await page.setViewportSize(PANE);
    await page.goto("/reading");
    await expect(page.getByRole("heading", { name: /reading practice/i })).toBeVisible();

    // The same host, at a width where the panel is a side rail: the rail runs
    // the height of the viewport, which is the measure that goes wrong here.
    await page.setContent(`
      <style>html,body{margin:0;height:100%;overflow:hidden}
      .preview{position:absolute;top:0;left:0;width:900px;height:2000px;border:0}</style>
      <iframe class="preview" src="/reading"></iframe>
    `);

    const app = page.frameLocator("iframe.preview");
    const heading = app.getByRole("heading", { name: /reading practice/i });
    await expect(heading).toBeVisible();
    await heading.click();
    await page.keyboard.press("ControlOrMeta+k");

    const dialog = app.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await app.getByPlaceholder("Ask a question…").fill("explain this");
    await app.getByRole("button", { name: "Send" }).click();
    await expect(app.getByText(/Paragraph 1:/)).toBeVisible();

    const panel = (await dialog.boundingBox())!;
    expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.y + panel.height).toBeLessThanOrEqual(PANE.height + 1);

    const overflow = await app
      .locator("#ask-ai-body > div")
      .first()
      .evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow).toBeGreaterThan(0);
  });
});
