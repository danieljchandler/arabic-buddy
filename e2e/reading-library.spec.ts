import { expect, test } from "./support/fixtures";
import {
  anAuthenticStory,
  anAuthenticStoryLine,
  storyId,
  storyLineId,
} from "../src/test/support/factories";

/**
 * The reading library — a public-domain story, read in dialect.
 *
 * The provenance and the lesson pull in opposite directions here, and that is
 * the whole of what is pinned below. A story in this library is a real text,
 * and real Arabic texts are written in Modern Standard Arabic; the app teaches
 * spoken Arabic and nothing else. So the import converts the fusha it took in
 * and the reader shows the conversion, with the original one switch away.
 *
 * It was the other way round for as long as the feature existed: the
 * conversion was an admin button the import flow never pressed, and the reader
 * defaulted to the fusha even when there was a dialect to show. Both halves
 * are asserted here because either one alone puts MSA back in front of the
 * learner.
 *
 * The audio is the same rule applied to the speaker. A recording made from one
 * register played under the other teaches a learner that the two are
 * pronounced alike, so what is spoken is whatever is on screen, in the voice
 * that register calls for.
 */

const STORY = anAuthenticStory({
  id: storyId(0),
  title: "The Generous Host",
  title_arabic: "المضيف الكريم",
  dialect: "Egyptian",
  body_fusha: "أريد أن أذهب إلى السوق\nهو يحب القهوة",
  body_dialect: "عايز أروح السوق\nهو بيحب القهوة",
  status: "published",
});

const LINES = [
  anAuthenticStoryLine({
    id: storyLineId(0),
    story_id: storyId(0),
    line_index: 0,
    arabic: "أريد أن أذهب إلى السوق",
    arabic_vocalized: null,
    dialect: "عايز أروح السوق",
    dialect_vocalized: null,
    english: "I want to go to the market",
    english_literal: null,
  }),
  anAuthenticStoryLine({
    id: storyLineId(1),
    story_id: storyId(0),
    line_index: 1,
    arabic: "هو يحب القهوة",
    arabic_vocalized: null,
    dialect: "هو بيحب القهوة",
    dialect_vocalized: null,
    english: "He likes coffee",
    english_literal: null,
  }),
];

test.describe("reading a library story", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    db.seed("authentic_stories", [STORY]);
    db.seed("authentic_story_lines", LINES);
  });

  test("opens in the dialect, not in the fusha it was imported from", async ({ page }) => {
    await page.goto(`/reading-library/${storyId(0)}`);

    // Asserted on words only one register has: every word is its own tappable
    // span, so a line rendered in the wrong register still shows the words it
    // shares with the right one.
    await expect(page.getByText("عايز", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("أريد", { exact: true })).toHaveCount(0);
  });

  test("shows the original when the learner asks for it", async ({ page }) => {
    await page.goto(`/reading-library/${storyId(0)}`);
    await expect(page.getByText("عايز", { exact: true }).first()).toBeVisible();

    await page.getByRole("switch").first().click();

    // The fusha is the provenance of a public-domain text, so it stays
    // reachable — one switch away rather than as the default.
    await expect(page.getByText("أريد", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("عايز", { exact: true })).toHaveCount(0);
  });

  test("says nothing until it is asked to", async ({ page, backend }) => {
    await page.goto(`/reading-library/${storyId(0)}`);
    await expect(page.getByText("عايز", { exact: true }).first()).toBeVisible();

    // Synthesis is metered against the learner's daily cap.
    expect(backend.callsTo("tts-speak")).toHaveLength(0);
  });

  test("speaks a line in the story's own dialect", async ({ page, backend }) => {
    await page.goto(`/reading-library/${storyId(0)}`);
    await page.getByRole("button", { name: "Play line 2" }).click();

    await expect.poll(() => backend.callsTo("tts-speak").length).toBeGreaterThan(0);
    expect(backend.callsTo("tts-speak")[0].body).toMatchObject({
      text: "هو بيحب القهوة",
      dialect: "Egyptian",
    });
  });

  test("offers the speaker on a story nobody has narrated", async ({ page }) => {
    // The stored recordings are an editor's doing and most stories do not have
    // them. Gating the controls on one, which is what the page used to do,
    // left those stories silent with no way to tell why.
    await page.goto(`/reading-library/${storyId(0)}`);

    await expect(page.getByRole("button", { name: "Play line 1" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Read the story aloud" })).toBeEnabled();
  });

  test("reads the original in MSA rather than in a dialect voice", async ({ page, backend }) => {
    await page.goto(`/reading-library/${storyId(0)}`);
    await page.getByRole("switch").first().click();
    await expect(page.getByText("أريد", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Play line 1" }).click();

    await expect.poll(() => backend.callsTo("tts-speak").length).toBeGreaterThan(0);
    expect(backend.callsTo("tts-speak")[0].body).toMatchObject({
      text: "أريد أن أذهب إلى السوق",
      dialect: "MSA",
    });
  });

  test("plays a stored recording instead of buying one", async ({
    page,
    backend,
    db,
    allowExternalHosts,
  }) => {
    // The clip is served from storage rather than from the test backend, so
    // the request leaving for it is itself the assertion that the stored
    // recording was chosen over a synthesis.
    allowExternalHosts(["cdn.test"]);
    db.seed("authentic_story_lines", [
      { ...LINES[0], audio_url: "https://cdn.test/story-line-0.wav" },
      LINES[1],
    ]);

    await page.goto(`/reading-library/${storyId(0)}`);
    await page.getByRole("button", { name: "Play line 1" }).click();

    // The line has a dialect rendering, so the recording an editor generated
    // is of that dialect — the page is showing what the clip says.
    await page.waitForTimeout(1000);
    expect(backend.callsTo("tts-speak")).toHaveLength(0);
  });

  test("refuses a dialect recording under the fusha", async ({ page, backend, db }) => {
    db.seed("authentic_story_lines", [
      { ...LINES[0], audio_url: "https://cdn.test/story-line-0.wav" },
      LINES[1],
    ]);

    await page.goto(`/reading-library/${storyId(0)}`);
    await page.getByRole("switch").first().click();
    await expect(page.getByText("أريد", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Play line 1" }).click();

    // Nothing on the row says which text a clip was made from, so the register
    // decides: the recording belongs to the dialect, and the learner is
    // reading the fusha. One synthesis is cheaper than teaching the wrong
    // pronunciation.
    await expect.poll(() => backend.callsTo("tts-speak").length).toBe(1);
    expect(backend.callsTo("tts-speak")[0].body).toMatchObject({
      text: "أريد أن أذهب إلى السوق",
      dialect: "MSA",
    });
  });
});
