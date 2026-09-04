import { expect, test } from "./support/fixtures";
import { aDiscoverVideo, videoId as makeVideoId } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";
import type { Page } from "@playwright/test";

/**
 * The Discover video editor — at 1564 lines the largest file in the repo, and
 * the one an admin spends the most time in.
 *
 * It does four separable jobs: resolve a pasted URL into a platform and an
 * embed, stage audio and kick off the server transcription pipeline, edit what
 * the pipeline produced (transcript, vocabulary, grammar points, CEFR band),
 * and save. The interesting behaviour is in the seams — the row is created
 * before the pipeline starts, so a kickoff that fails leaves a row behind, and
 * the save writes the whole form back over whatever the pipeline wrote.
 *
 * The audio download and file-upload paths reach for `MediaRecorder`,
 * `AudioContext` and remote media, so those are exercised through their
 * observable effects — the status the row is left in, and what the pipeline is
 * asked to do — rather than through the browser's media stack.
 */

const VIDEO = makeVideoId(0);
const YOUTUBE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

const urlField = (page: Page) => page.getByPlaceholder(/youtube.com\/watch/);
const titleField = (page: Page) =>
  page.getByPlaceholder("Auto-generated from transcript if left blank");
const saveButton = (page: Page) => page.getByRole("button", { name: /^(Save Video|Update Video)$/ });

function seedVideo(db: MemoryDb, over: Record<string, unknown> = {}) {
  db.seed("discover_videos", [
    aDiscoverVideo({
      id: VIDEO,
      title: "Coffee shop chat",
      title_arabic: "حديث في المقهى",
      source_url: YOUTUBE_URL,
      embed_url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
      platform: "youtube",
      dialect: "Gulf",
      difficulty: "Beginner",
      published: false,
      transcription_status: "complete",
      ...over,
    }),
  ]);
}

const aLine = (index: number) => ({
  id: `l${index}`,
  arabic: `سطر ${index}`,
  english: `Line ${index}`,
  startMs: index * 1000,
  endMs: (index + 1) * 1000,
});

/** Wait for a write to land, then return its payload. */
async function writtenTo(db: MemoryDb, table: string): Promise<Record<string, unknown>[]> {
  await expect.poll(() => db.writesTo(table).length).toBeGreaterThan(0);
  return db.lastWriteTo(table)!.payload as Record<string, unknown>[];
}

test.beforeEach(async ({ signInAs, backend }) => {
  await signInAs("admin");
  // Every edit-save first reports transcript corrections to the flywheel
  // (record-transcript-corrections) before overwriting the row. The capture is
  // fire-and-forget, so acknowledging it is all these tests need.
  backend.stubFunction("record-transcript-corrections", { recorded: 0 });
});

test.describe("resolving a URL", () => {
  test("offers nothing to parse before a URL is typed", async ({ page }) => {
    await page.goto("/admin/videos/new");

    await expect(page.getByRole("heading", { name: "Add Video" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Parse" })).toBeDisabled();
  });

  test("resolves a YouTube URL into a platform and a thumbnail", async ({ page, allowExternalHosts }) => {
    allowExternalHosts(["img.youtube.com", "i.ytimg.com"]);

    await page.goto("/admin/videos/new");
    await urlField(page).fill(YOUTUBE_URL);
    await page.getByRole("button", { name: "Parse" }).click();

    await expect(page.getByText("Detected youtube video")).toBeVisible();
    await expect(page.getByText("youtube", { exact: true })).toBeVisible();
  });

  test("refuses a URL from a platform it cannot embed", async ({ page }) => {
    await page.goto("/admin/videos/new");
    await urlField(page).fill("https://vimeo.com/123456");
    await page.getByRole("button", { name: "Parse" }).click();

    // The embed URL is what the Discover player loads; guessing one for an
    // unsupported host produces a card that renders as a blank frame.
    await expect(page.getByText("Unsupported URL")).toBeVisible();
  });

  test("parses on save when the admin never pressed Parse", async ({ page, db }) => {
    await page.goto("/admin/videos/new");
    await urlField(page).fill(YOUTUBE_URL);
    await saveButton(page).click();

    // Parse is a preview, not a required step — the same resolution runs again
    // at save time so a forgotten click cannot store an unplayable row.
    const written = (await writtenTo(db, "discover_videos"))[0];
    expect(written.platform).toBe("youtube");
    // youtube-nocookie is the host the player is pointed at, deliberately —
    // it is what keeps a learner watching a clip out of Google's ad profile.
    expect(String(written.embed_url)).toContain("youtube-nocookie.com/embed/");
  });
});

test.describe("saving a new video", () => {
  test("needs a URL", async ({ page, db }) => {
    await page.goto("/admin/videos/new");
    await titleField(page).fill("Coffee shop chat");
    await saveButton(page).click();

    await expect(page.getByText("Please enter a video URL")).toBeVisible();
    expect(db.lastWriteTo("discover_videos")).toBeUndefined();
  });

  test("saves the metadata as entered", async ({ page, db }) => {
    await page.goto("/admin/videos/new");
    await urlField(page).fill(YOUTUBE_URL);
    await titleField(page).fill("Coffee shop chat");
    await page.getByPlaceholder("يُولَّد تلقائياً من النص").fill("حديث في المقهى");
    await page.getByPlaceholder("Optional cultural notes for viewers...").fill("Gulf coffee etiquette");
    await saveButton(page).click();

    expect((await writtenTo(db, "discover_videos"))[0]).toMatchObject({
      title: "Coffee shop chat",
      title_arabic: "حديث في المقهى",
      source_url: YOUTUBE_URL,
      cultural_context: "Gulf coffee etiquette",
      dialect: "Gulf",
      published: false,
      is_meme: false,
    });
  });

  test("falls back to a placeholder title", async ({ page, db }) => {
    await page.goto("/admin/videos/new");
    await urlField(page).fill(YOUTUBE_URL);
    await saveButton(page).click();

    // Pinned. An untitled video is saved as "Untitled Video" rather than
    // refused, so the Discover list can carry rows nobody has named. The
    // transcription pipeline later replaces exactly this placeholder, which is
    // why it is a fixed string and not empty.
    expect((await writtenTo(db, "discover_videos"))[0].title).toBe("Untitled Video");
  });

  test("titles an untitled video from its first line when one exists", async ({ page, db }) => {
    seedVideo(db, { title: "", transcript_lines: [aLine(0), aLine(1)] });

    await page.goto(`/admin/videos/${VIDEO}/edit`);
    await saveButton(page).click();

    expect((await writtenTo(db, "discover_videos"))[0].title).toBe("سطر 0");
  });

  test("records the chosen dialect and difficulty", async ({ page, db }) => {
    await page.goto("/admin/videos/new");
    await urlField(page).fill(YOUTUBE_URL);
    await titleField(page).fill("Coffee shop chat");
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Egyptian" }).click();
    await saveButton(page).click();

    expect((await writtenTo(db, "discover_videos"))[0]).toMatchObject({ dialect: "Egyptian" });
  });

  test("stores a duration typed by hand", async ({ page, db }) => {
    await page.goto("/admin/videos/new");
    await urlField(page).fill(YOUTUBE_URL);
    await titleField(page).fill("Coffee shop chat");
    await page.locator('input[type="number"]').first().fill("125");
    await saveButton(page).click();

    // Duration drives the CEFR words-per-minute metric, so a wrong one silently
    // shifts the rating.
    expect((await writtenTo(db, "discover_videos"))[0].duration_seconds).toBe(125);
  });

  test("keeps a new video unpublished unless the switch is thrown", async ({ page, db }) => {
    await page.goto("/admin/videos/new");
    await urlField(page).fill(YOUTUBE_URL);
    await titleField(page).fill("Coffee shop chat");
    await page.getByRole("switch").first().click();
    await saveButton(page).click();

    expect((await writtenTo(db, "discover_videos"))[0].published).toBe(true);
  });

  test("marks a meme from the query flag", async ({ page, db }) => {
    // The meme shelf links here with ?meme=1 so the pipeline reads on-screen
    // text rather than assuming the joke is spoken.
    await page.goto("/admin/videos/new?meme=1");
    await urlField(page).fill(YOUTUBE_URL);
    await titleField(page).fill("A meme");
    await saveButton(page).click();

    expect((await writtenTo(db, "discover_videos"))[0].is_meme).toBe(true);
  });

  test("goes back to the video list once saved", async ({ page }) => {
    await page.goto("/admin/videos/new");
    await urlField(page).fill(YOUTUBE_URL);
    await titleField(page).fill("Coffee shop chat");
    await saveButton(page).click();

    await expect(page.getByText("Video created!")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/videos$/);
  });

  test("says so when the save is refused", async ({ page, db, expectConsoleErrors }) => {
    expectConsoleErrors([/Save error/]);
    db.failWrites("discover_videos", 403, { message: "new row violates row-level security policy" });

    await page.goto("/admin/videos/new");
    await urlField(page).fill(YOUTUBE_URL);
    await titleField(page).fill("Coffee shop chat");
    await saveButton(page).click();

    await expect(page.getByText("Failed to save")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/videos\/new$/);
  });
});

test.describe("the thumbnail", () => {
  /**
   * TikTok does not hand out an address for a still, it hands out a signed one
   * — `x-expires` about forty-eight hours out. Storing what the platform said
   * is why videos kept losing their picture days after being added, and why
   * pressing Fetch again always seemed to fix it: it minted another two-day
   * URL. `persist-video-thumbnail` keeps a copy of the image instead, which is
   * work only the server can do — the CDN answers without CORS headers, so
   * this page can display those bytes and cannot read them.
   */
  const SIGNED_STILL =
    "https://p16.tiktokcdn.test/obj/still.image?x-expires=1788613200&x-signature=abc";

  const fetchThumbnail = (page: Page) =>
    page.getByRole("button", { name: /(Re-)?[Ff]etch thumbnail/ });

  test("swaps a still that expires for one of ours", async ({ page, db, allowExternalHosts }) => {
    // The still itself, and the embedded player the edit page renders beside it.
    allowExternalHosts(["tiktok.com", "tiktokcdn.test"]);
    seedVideo(db, {
      platform: "tiktok",
      source_url: "https://www.tiktok.com/@creator/video/7451234567890123456",
      embed_url: "https://www.tiktok.com/player/v1/7451234567890123456",
      thumbnail_url: SIGNED_STILL,
    });

    await page.goto(`/admin/videos/${VIDEO}/edit`);
    await fetchThumbnail(page).click();

    await expect(page.getByText("Thumbnail fetched!")).toBeVisible();
    const stored = db.rows("discover_videos")[0].thumbnail_url as string;
    expect(stored).toContain("/storage/v1/object/public/flashcard-images/video-stills/");
    expect(stored).not.toContain("x-expires");
  });

  test("does not leave a borrowed still on a video it just created", async ({
    page,
    db,
    allowExternalHosts,
  }) => {
    // The create path: the oEmbed answer is good enough to preview with, and
    // the save is where it has to be turned into something permanent.
    allowExternalHosts(["tiktok.com", "tiktokcdn.test"]);
    await page.route("**/www.tiktok.com/oembed**", (route) =>
      route.fulfill({ json: { thumbnail_url: SIGNED_STILL, html: 'data-video-id="7451234567890123456"' } }),
    );

    await page.goto("/admin/videos/new");
    await urlField(page).fill("https://www.tiktok.com/@creator/video/7451234567890123456");
    await page.getByRole("button", { name: "Parse" }).click();
    await expect(page.getByText(/TikTok video detected/)).toBeVisible();

    await titleField(page).fill("A meme");
    await saveButton(page).click();
    await expect(page.getByText("Video created!")).toBeVisible();

    await expect
      .poll(() => db.rows("discover_videos")[0]?.thumbnail_url as string)
      .toContain("/storage/v1/object/public/flashcard-images/video-stills/");
  });
});

test.describe("editing an existing video", () => {
  test("loads the video into the form", async ({ page, db }) => {
    seedVideo(db);

    await page.goto(`/admin/videos/${VIDEO}/edit`);

    await expect(page.getByRole("heading", { name: "Edit Video" })).toBeVisible();
    await expect(urlField(page)).toHaveValue(YOUTUBE_URL);
    await expect(titleField(page)).toHaveValue("Coffee shop chat");
  });

  test("updates rather than inserting a second row", async ({ page, db }) => {
    seedVideo(db);

    await page.goto(`/admin/videos/${VIDEO}/edit`);
    await titleField(page).fill("Tea house chat");
    await saveButton(page).click();

    await expect(page.getByText("Video updated!")).toBeVisible();
    const write = db.writesTo("discover_videos").at(-1);
    expect(write?.method).toBe("PATCH");
    expect(write?.payload[0]).toMatchObject({ title: "Tea house chat" });
  });

  test("says a transcription is still running", async ({ page, db }) => {
    seedVideo(db, { transcription_status: "processing" });

    await page.goto(`/admin/videos/${VIDEO}/edit`);

    await expect(page.getByText(/Transcription is being processed on the server/)).toBeVisible();
  });

  test("asks the pipeline to resume a run that has stopped moving", async ({ page, db, backend }) => {
    // A worker torn down mid-run leaves the row on processing with nothing
    // left to send the next stage. The page polls the row anyway; when it has
    // not moved for longer than a live run ever goes quiet, it asks the
    // function to continue from its checkpoint.
    seedVideo(db, {
      transcription_status: "processing",
      updated_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    });

    await page.goto(`/admin/videos/${VIDEO}/edit`);

    await expect.poll(() => backend.lastCallTo("process-approved-video")?.body).toEqual({
      videoId: VIDEO,
      resume: true,
    });
  });

  test("leaves a run that is still moving alone", async ({ page, db, backend }) => {
    seedVideo(db, { transcription_status: "processing", updated_at: new Date().toISOString() });

    await page.goto(`/admin/videos/${VIDEO}/edit`);

    await expect(page.getByText(/Transcription is being processed on the server/)).toBeVisible();
    expect(backend.callsTo("process-approved-video")).toHaveLength(0);
  });

  test("says a transcription is queued", async ({ page, db }) => {
    // Freshly queued — the stalled-pending detection keys off updated_at, and
    // the factory's default timestamp is old enough to read as stalled.
    seedVideo(db, { transcription_status: "pending", updated_at: new Date().toISOString() });

    await page.goto(`/admin/videos/${VIDEO}/edit`);

    await expect(page.getByText(/Transcription is queued/)).toBeVisible();
  });

  test("re-enables re-transcribing when a queued run has stalled", async ({ page, db }) => {
    // Queued long ago with no progress: the kickoff was lost. The banner says
    // so and the controls stop disabling their own escape hatch — a stuck
    // 'pending' video used to have no UI path to retry at all.
    seedVideo(db, {
      transcription_status: "pending",
      updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });

    await page.goto(`/admin/videos/${VIDEO}/edit`);

    await expect(page.getByText(/without starting/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Download & Re-transcribe/ })).toBeEnabled();
  });

  test("surfaces why a transcription failed", async ({ page, db }) => {
    seedVideo(db, {
      transcription_status: "failed",
      transcription_error: "Download failed (502): no downloader available",
    });

    await page.goto(`/admin/videos/${VIDEO}/edit`);

    // The reason is the difference between "retry" and "upload the file by
    // hand", and the banner says which one to reach for.
    await expect(page.getByText("Background transcription failed")).toBeVisible();
    await expect(page.getByText(/no downloader available/)).toBeVisible();
    await expect(page.getByText(/manually download and transcribe/)).toBeVisible();
  });

  test("shows no banner once transcription is complete", async ({ page, db }) => {
    seedVideo(db, { transcription_status: "complete" });

    await page.goto(`/admin/videos/${VIDEO}/edit`);

    await expect(page.getByText(/Transcription is being processed/)).toHaveCount(0);
    await expect(page.getByText("Background transcription failed")).toHaveCount(0);
  });
});

test.describe("the transcript, vocabulary and grammar", () => {
  test("shows no editors until the pipeline has produced something", async ({ page, db }) => {
    seedVideo(db, { transcript_lines: [], vocabulary: [], grammar_points: [] });

    await page.goto(`/admin/videos/${VIDEO}/edit`);

    await expect(page.getByText("Transcript", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/^Vocabulary \(/)).toHaveCount(0);
    await expect(page.getByText(/^Grammar Points \(/)).toHaveCount(0);
  });

  test("counts what the pipeline produced", async ({ page, db }) => {
    seedVideo(db, {
      transcript_lines: [aLine(0), aLine(1), aLine(2)],
      vocabulary: [{ arabic: "قهوة", english: "coffee", root: "ق ه و" }],
      grammar_points: [{ title: "Definite article", explanation: "al- prefixes the noun" }],
    });

    await page.goto(`/admin/videos/${VIDEO}/edit`);

    await expect(page.getByText("Vocabulary (1)")).toBeVisible();
    await expect(page.getByText("Grammar Points (1)")).toBeVisible();
  });

  // The vocabulary and grammar lists live in the Notes & grammar editor — the
  // one folded in from the native-speaker workspace — and save through the
  // `transcript-review` function, which is what writes the revision log.

  test("edits a vocabulary entry and saves it back", async ({ page, db }) => {
    seedVideo(db, {
      transcript_lines: [aLine(0)],
      vocabulary: [{ arabic: "قهوة", english: "coffee", root: "ق ه و" }],
    });

    await page.goto(`/admin/videos/${VIDEO}/edit`);
    await page.getByLabel("Vocabulary 1 English").fill("Arabic coffee");
    await page.getByRole("button", { name: "Save notes" }).click();

    await expect
      .poll(() => db.rows("discover_videos").find((r) => r.id === VIDEO)?.vocabulary)
      .toEqual([{ arabic: "قهوة", english: "Arabic coffee", root: "ق ه و" }]);
  });

  test("adds and removes a vocabulary entry", async ({ page, db }) => {
    seedVideo(db, {
      transcript_lines: [aLine(0)],
      vocabulary: [{ arabic: "قهوة", english: "coffee", root: "ق ه و" }],
    });

    await page.goto(`/admin/videos/${VIDEO}/edit`);
    // The vocabulary card's Add button is the last one; the grammar card's
    // sits above it.
    await page.getByRole("button", { name: "Add", exact: true }).last().click();
    await page.getByLabel("Vocabulary 2 Arabic").fill("شاي");
    await page.getByLabel("Vocabulary 2 English").fill("tea");
    await page.getByRole("button", { name: "Save notes" }).click();

    await expect
      .poll(
        () =>
          (db.rows("discover_videos").find((r) => r.id === VIDEO)?.vocabulary as unknown[])
            ?.length,
      )
      .toBe(2);
    const vocab = db.rows("discover_videos").find((r) => r.id === VIDEO)!
      .vocabulary as Array<Record<string, string>>;
    expect(vocab[1]).toMatchObject({ arabic: "شاي", english: "tea" });
  });

  test("edits a grammar point", async ({ page, db }) => {
    seedVideo(db, {
      grammar_points: [{ title: "Definite article", explanation: "al- prefixes the noun" }],
    });

    await page.goto(`/admin/videos/${VIDEO}/edit`);
    await page
      .getByLabel("Grammar point 1 explanation")
      .fill("The prefix al- makes a noun definite.");
    await page.getByRole("button", { name: "Save notes" }).click();

    await expect
      .poll(() => db.rows("discover_videos").find((r) => r.id === VIDEO)?.grammar_points)
      .toEqual([
        { title: "Definite article", explanation: "The prefix al- makes a noun definite." },
      ]);
  });

  test("adds an empty grammar point to fill in", async ({ page, db }) => {
    seedVideo(db, {
      grammar_points: [{ title: "Definite article", explanation: "al- prefixes the noun" }],
    });

    await page.goto(`/admin/videos/${VIDEO}/edit`);
    await page.getByRole("button", { name: "Add", exact: true }).first().click();
    await page.getByLabel("Grammar point 2 title").fill("Idafa");
    await page.getByRole("button", { name: "Save notes" }).click();

    await expect
      .poll(
        () =>
          (db.rows("discover_videos").find((r) => r.id === VIDEO)?.grammar_points as unknown[])
            ?.length,
      )
      .toBe(2);
    const points = db.rows("discover_videos").find((r) => r.id === VIDEO)!
      .grammar_points as Array<Record<string, string>>;
    expect(points[1]).toMatchObject({ title: "Idafa" });
  });

  test("removes a grammar point", async ({ page, db }) => {
    seedVideo(db, {
      grammar_points: [
        { title: "Definite article", explanation: "a" },
        { title: "Idafa", explanation: "b" },
      ],
    });

    await page.goto(`/admin/videos/${VIDEO}/edit`);
    await page.getByLabel("Remove grammar point 1").click();
    await page.getByRole("button", { name: "Save notes" }).click();

    await expect
      .poll(
        () =>
          (db.rows("discover_videos").find((r) => r.id === VIDEO)?.grammar_points as unknown[])
            ?.length,
      )
      .toBe(1);
    const points = db.rows("discover_videos").find((r) => r.id === VIDEO)!
      .grammar_points as Array<Record<string, string>>;
    expect(points[0].title).toBe("Idafa");
  });

  test("no longer overwrites the pipeline's notes on save", async ({ page, db }) => {
    seedVideo(db, {
      transcript_lines: [aLine(0)],
      vocabulary: [{ arabic: "قهوة", english: "coffee", root: "ق ه و" }],
      grammar_points: [{ title: "Definite article", explanation: "a" }],
    });

    await page.goto(`/admin/videos/${VIDEO}/edit`);
    await expect(page.getByText("Vocabulary (1)")).toBeVisible();
    await saveButton(page).click();

    // Pinned, and deliberately the inverse of what this test used to pin. The
    // notes save through the revision-logged editor and the transcript through
    // `transcript-review`, so Update Video writing this form's stale copies
    // over them would silently undo a save made minutes ago.
    const written = (await writtenTo(db, "discover_videos"))[0];
    expect(written).not.toHaveProperty("vocabulary");
    expect(written).not.toHaveProperty("grammar_points");
    expect(written).not.toHaveProperty("cultural_context");
    expect(written).toHaveProperty("published");
  });
});

test.describe("unpublished transcript changes", () => {
  /** Correct the first line's Arabic the way a reviewer does — click a word, type, click away. */
  async function correctFirstLine(page: Page, text: string) {
    await page.locator('[data-segment-id] span[dir="rtl"] span[role="button"]').first().click();
    const box = page.locator('textarea[dir="rtl"]').first();
    await box.fill(text);
    await box.blur();
  }

  test("shows the correction on the line as soon as the box closes", async ({ page, db }) => {
    seedVideo(db, { transcript_lines: [aLine(0)] });

    await page.goto(`/admin/videos/${VIDEO}/edit`);
    await correctFirstLine(page, "سطر مصحح");

    // The card draws its Arabic from the word list, which an edit used not to
    // rebuild — so the old wording came straight back and an admin who had just
    // fixed a word saw nothing change.
    await expect(page.locator("[data-segment-id]").first()).toContainText("مصحح");
  });

  test("says the changes are auto-saved but not published", async ({ page, db }) => {
    seedVideo(db, { transcript_lines: [aLine(0)] });

    await page.goto(`/admin/videos/${VIDEO}/edit`);
    await correctFirstLine(page, "سطر مصحح");

    await expect(page.getByText("Unpublished changes", { exact: true })).toBeVisible();
    await expect(page.getByText(/auto-saved to this device at/i)).toBeVisible();
    // Nothing has been written: the transcript learners see is still the old one.
    expect(db.writesTo("discover_videos")).toHaveLength(0);
  });

  test("keeps the correction across a reload and offers it back", async ({ page, db }) => {
    seedVideo(db, { transcript_lines: [aLine(0)] });

    await page.goto(`/admin/videos/${VIDEO}/edit`);
    await correctFirstLine(page, "سطر مصحح");
    await expect(page.getByText(/auto-saved to this device at/i)).toBeVisible();

    // The whole point: a closed tab used to take the session's work with it.
    await page.reload();

    await expect(page.getByText(/unpublished transcript edits from/i)).toBeVisible();
    await page.getByRole("button", { name: /restore edits/i }).click();
    await expect(page.locator("[data-segment-id]").first()).toContainText("مصحح");
  });

  test("publishes the correction, and the word layer under it, on Update Video", async ({ page, db }) => {
    seedVideo(db, { transcript_lines: [aLine(0)] });

    await page.goto(`/admin/videos/${VIDEO}/edit`);
    await correctFirstLine(page, "سطر مصحح");
    await expect(page.getByText("Unpublished changes", { exact: true })).toBeVisible();

    await saveButton(page).click();

    // The lines land through `transcript-review`'s save_lines — that is what
    // writes the revision log — so the proof is the stored row, not the form's
    // own update payload (which deliberately no longer carries the transcript).
    await expect
      .poll(() => {
        const lines = db.rows("discover_videos").find((r) => r.id === VIDEO)
          ?.transcript_lines as Array<Record<string, unknown>> | undefined;
        return lines?.[0]?.arabic;
      })
      .toBe("سطر مصحح");
    const storedLines = db.rows("discover_videos").find((r) => r.id === VIDEO)!
      .transcript_lines as Array<Record<string, unknown>>;
    // And the word layer under it, which is what the next reviewer will read.
    expect((storedLines[0].tokens as Array<Record<string, string>>).map((t) => t.surface)).toEqual([
      "سطر",
      "مصحح",
    ]);
  });
});

test.describe("auto-rating the difficulty", () => {
  test("offers no rating with nothing to rate", async ({ page, db }) => {
    seedVideo(db, { transcript_lines: [] });

    await page.goto(`/admin/videos/${VIDEO}/edit`);

    // The rater reads the transcript; without one it would band the video off
    // metadata alone.
    await expect(page.getByRole("button", { name: "Auto-rate" })).toBeDisabled();
  });

  test("sends the transcript, duration, vocabulary and dialect", async ({ page, db, backend }) => {
    seedVideo(db, {
      transcript_lines: [aLine(0), aLine(1)],
      vocabulary: [{ arabic: "قهوة", english: "coffee" }],
      duration_seconds: 90,
      dialect: "Gulf",
    });
    backend.stubFunction("rate-video-cefr", {
      cefr_level: "B1",
      difficulty: "Intermediate",
      rationale: "Fast speech with common vocabulary.",
      metric_floor: "A2",
    });

    await page.goto(`/admin/videos/${VIDEO}/edit`);
    await page.getByRole("button", { name: "Auto-rate" }).click();

    await expect(page.getByText("Rated B1 (Intermediate) — floor A2")).toBeVisible();
    expect(backend.lastCallTo("rate-video-cefr")?.body).toMatchObject({
      duration_seconds: 90,
      dialect: "Gulf",
    });
  });

  test("shows the band and the reasoning behind it", async ({ page, db, backend }) => {
    seedVideo(db, { transcript_lines: [aLine(0)] });
    backend.stubFunction("rate-video-cefr", {
      cefr_level: "B1",
      difficulty: "Intermediate",
      rationale: "Fast speech with common vocabulary.",
      metric_floor: "A2",
    });

    await page.goto(`/admin/videos/${VIDEO}/edit`);
    await page.getByRole("button", { name: "Auto-rate" }).click();

    await expect(page.getByText("CEFR: B1")).toBeVisible();
    await expect(page.getByText("Fast speech with common vocabulary.")).toBeVisible();
  });

  test("saves the band and its rationale with the video", async ({ page, db, backend }) => {
    seedVideo(db, { transcript_lines: [aLine(0)] });
    backend.stubFunction("rate-video-cefr", {
      cefr_level: "B1",
      difficulty: "Intermediate",
      rationale: "Fast speech with common vocabulary.",
      metric_floor: "A2",
    });

    await page.goto(`/admin/videos/${VIDEO}/edit`);
    await page.getByRole("button", { name: "Auto-rate" }).click();
    await expect(page.getByText("CEFR: B1")).toBeVisible();
    await saveButton(page).click();

    expect((await writtenTo(db, "discover_videos"))[0]).toMatchObject({
      cefr_level: "B1",
      difficulty: "Intermediate",
      difficulty_rationale: "Fast speech with common vocabulary.",
    });
  });

  test("leaves the form alone when the rater answers without a band", async ({ page, db, backend }) => {
    // No band yet, so the badge appearing would mean the answer was applied.
    seedVideo(db, { transcript_lines: [aLine(0)], difficulty: "Beginner", cefr_level: null });
    backend.stubFunction("rate-video-cefr", { error: "could not rate" });

    await page.goto(`/admin/videos/${VIDEO}/edit`);
    await page.getByRole("button", { name: "Auto-rate" }).click();

    // Pinned. A 200 with no `cefr_level` is silently ignored: no toast, no
    // error, nothing changes. The admin presses Auto-rate and the page simply
    // does not respond, which is indistinguishable from a dead button.
    await expect(page.getByText(/CEFR:/)).toHaveCount(0);
    await expect(page.getByText(/Rating failed/)).toHaveCount(0);
  });

  test("says so when the rater fails outright", async ({ page, db, backend }) => {
    seedVideo(db, { transcript_lines: [aLine(0)] });
    backend.stubFunctionFailure("rate-video-cefr", 500, { error: "model unavailable" });

    await page.goto(`/admin/videos/${VIDEO}/edit`);
    await page.getByRole("button", { name: "Auto-rate" }).click();

    await expect(page.getByText(/Rating failed/)).toBeVisible();
  });
});

test.describe("generating grammar notes", () => {
  test("asks for notes at the chosen level and count", async ({ page, db, backend }) => {
    seedVideo(db, { transcript_lines: [aLine(0)] });
    backend.stubFunction("extract-grammar-points", { added: 3 });

    await page.goto(`/admin/videos/${VIDEO}/edit`);
    await page.getByRole("button", { name: "Generate" }).click();

    await expect(page.getByText("Added 3 grammar notes at B1")).toBeVisible();
    expect(backend.lastCallTo("extract-grammar-points")?.body).toMatchObject({
      video_id: VIDEO,
      target_level: "B1",
      count: 4,
    });
  });

  test("clamps the count to what the generator will accept", async ({ page, db, backend }) => {
    seedVideo(db, { transcript_lines: [aLine(0)] });
    backend.stubFunction("extract-grammar-points", { added: 1 });

    await page.goto(`/admin/videos/${VIDEO}/edit`);
    await page.locator('input[type="number"]').last().fill("40");
    await page.getByRole("button", { name: "Generate" }).click();
    await expect(page.getByText(/Added 1 grammar note at/)).toBeVisible();

    // Eight is the ceiling the prompt is built for; asking for forty produces a
    // truncated answer the admin cannot see the edges of.
    expect(backend.lastCallTo("extract-grammar-points")?.body).toMatchObject({ count: 8 });
  });

  test("says when there were no new notes to add", async ({ page, db, backend }) => {
    seedVideo(db, { transcript_lines: [aLine(0)] });
    backend.stubFunction("extract-grammar-points", { added: 0, message: "All points already present" });

    await page.goto(`/admin/videos/${VIDEO}/edit`);
    await page.getByRole("button", { name: "Generate" }).click();

    // Existing titles are skipped, so zero is a normal outcome rather than a
    // failure — saying nothing would read as a broken button.
    await expect(page.getByText("All points already present")).toBeVisible();
  });

  test("says so when the generator fails", async ({ page, db, backend }) => {
    seedVideo(db, { transcript_lines: [aLine(0)] });
    backend.stubFunctionFailure("extract-grammar-points", 500, { error: "model unavailable" });

    await page.goto(`/admin/videos/${VIDEO}/edit`);
    await page.getByRole("button", { name: "Generate" }).click();

    await expect(page.getByText(/non-2xx status code/)).toBeVisible();
  });
});

test.describe("getting in", () => {
  test("turns a plain learner away", async ({ page, signInAs }) => {
    await signInAs("free");

    await page.goto("/admin/videos/new");

    await expect(page.getByRole("heading", { name: "Add Video" })).toHaveCount(0);
  });

  test("lets a content reviewer in", async ({ page, signInAs }) => {
    // `/admin/videos` is on the reviewer allow-list, and the form is under it —
    // reviewing a clip means being able to correct its transcript.
    await signInAs("content_reviewer");

    await page.goto("/admin/videos/new");

    await expect(page.getByRole("heading", { name: "Add Video" })).toBeVisible();
  });
});
