import { expect, test } from "./support/fixtures";
import { aProfile, aUserVocabulary, many, vocabId, TEST_USER_ID } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * My Words — the learner's own saved vocabulary.
 *
 * This is the only data in the app the learner created themselves, so a bug
 * that deletes the wrong card destroys work nothing can restore. The bulk
 * delete is the sharp edge: it chunks ids into batches of 200 and, before the
 * backend honoured filters, no test could tell whether it deleted the selection
 * or the whole deck.
 */

const OTHER_USER = "00000000-0000-4000-8000-000000000009";

function seedWords(db: MemoryDb, count: number, over: (index: number) => Record<string, unknown> = () => ({})) {
  db.seed(
    "user_vocabulary",
    many(aUserVocabulary, count, (index) => ({
      id: vocabId(index),
      user_id: TEST_USER_ID,
      word_arabic: `كلمة${index + 1}`,
      word_english: `word ${index + 1}`,
      ...over(index),
    })),
  );
}

test.describe("the list", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("shows the learner's saved words", async ({ page, db }) => {
    seedWords(db, 3);
    await page.goto("/my-words");

    await expect(page.getByText("كلمة1")).toBeVisible();
    await expect(page.getByText("كلمة3")).toBeVisible();
  });

  test("shows nothing belonging to another learner", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), user_id: TEST_USER_ID, word_arabic: "مِلكي" }),
      aUserVocabulary({ id: vocabId(1), user_id: OTHER_USER, word_arabic: "لغيري" }),
    ]);

    await page.goto("/my-words");

    await expect(page.getByText("مِلكي")).toBeVisible();
    await expect(page.getByText("لغيري")).toHaveCount(0);
  });

  test("reviews every dialect when All Dialects is on", async ({ page, db }) => {
    // The due count follows the toggle, so the deck the button opens must too;
    // it used to open the active dialect's cards under an all-dialect count.
    const past = new Date(Date.now() - 86_400_000).toISOString();
    seedWords(db, 2, (index) => ({ dialect: index === 0 ? "Gulf" : "Egyptian", next_review_at: past }));
    await page.goto("/my-words");

    await page.getByRole("button", { name: "Gulf", exact: true }).click();
    await page.getByRole("button", { name: /^Review \d+ due cards?/ }).click();

    await expect(page).toHaveURL(/\/review\/my-words\?mixed=1$/);
  });

  test("says so when nothing has been saved yet", async ({ page, db }) => {
    db.seed("user_vocabulary", []);
    await page.goto("/my-words");

    await expect(page.getByText(/no words|nothing saved|add from text/i).first()).toBeVisible();
  });

  test("does not claim an empty deck when the query failed", async ({ page, db }) => {
    // "You haven't saved any words" after a failed request tells the learner
    // their vocabulary is gone.
    db.failAlways("user_vocabulary", 500);
    await page.goto("/my-words");

    await expect(page.getByText(/haven't saved|no words yet/i)).toHaveCount(0);
  });

  test("scopes the list to the active dialect", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), dialect: "Gulf", word_arabic: "خليجي" }),
      aUserVocabulary({ id: vocabId(1), dialect: "Egyptian", word_arabic: "مصري" }),
    ]);

    await page.goto("/my-words");

    await expect(page.getByText("خليجي")).toBeVisible();
    await expect(page.getByText("مصري")).toHaveCount(0);
  });
});

test.describe("filters", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("narrows to a deck", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), deck_name: "Anki import", word_arabic: "منكي" }),
      aUserVocabulary({ id: vocabId(1), deck_name: null, word_arabic: "بدون" }),
    ]);

    await page.goto("/my-words");
    await expect(page.getByText("منكي")).toBeVisible();

    await page.getByRole("button", { name: /anki import/i }).first().click();

    await expect(page.getByText("منكي")).toBeVisible();
    await expect(page.getByText("بدون")).toHaveCount(0);
  });

  test("narrows to a tag", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), tags: ["food"], word_arabic: "طعام" }),
      aUserVocabulary({ id: vocabId(1), tags: ["travel"], word_arabic: "سفر" }),
    ]);

    await page.goto("/my-words");
    await page.getByRole("button", { name: /^#food/i }).first().click();

    await expect(page.getByText("طعام")).toBeVisible();
    await expect(page.getByText("سفر")).toHaveCount(0);
  });

  test("filtering never touches the server, so nothing can be lost by it", async ({ page, db }) => {
    // The filters are client-side over an already-loaded list. A filter that
    // issued a delete would be catastrophic, so this pins that it does not.
    db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), tags: ["food"], word_arabic: "طعام" }),
      aUserVocabulary({ id: vocabId(1), tags: ["travel"], word_arabic: "سفر" }),
    ]);

    await page.goto("/my-words");
    await page.getByRole("button", { name: /^#food/i }).first().click();

    expect(db.writesTo("user_vocabulary")).toHaveLength(0);
    expect(db.rows("user_vocabulary")).toHaveLength(2);
  });
});

test.describe("deleting", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("removes exactly the card asked for", async ({ page, db }) => {
    seedWords(db, 3);
    await page.goto("/my-words");
    await expect(page.getByText("كلمة1")).toBeVisible();

    // Each card carries its own delete control.
    await page.getByRole("button", { name: "Delete word 1" }).click();

    await expect
      .poll(() => db.rows("user_vocabulary").length, { timeout: 10_000 })
      .toBe(2);

    // Exactly that one — a delete issued without its filter would clear the
    // whole deck, and the count alone would not distinguish the two.
    expect(db.rows("user_vocabulary").map((row) => row.word_english).sort()).toEqual([
      "word 2",
      "word 3",
    ]);
  });

  test("a failed delete leaves the card in place", async ({ page, db, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);

    seedWords(db, 2);
    await page.goto("/my-words");
    await expect(page.getByText("كلمة1")).toBeVisible();

    db.failWrites("user_vocabulary", 403);
    await page.getByRole("button", { name: "Delete word 1" }).click();

    await page.waitForTimeout(500);
    expect(db.rows("user_vocabulary")).toHaveLength(2);
  });
});

test.describe("the free-tier vocabulary cap", () => {
  test("a free learner is not stopped from saving beyond ten words", async ({ page, signInAs, db }) => {
    // Recording current behaviour: no vocabulary cap exists on any tier, and
    // since the pricing page stopped promising one this is now the product's
    // position rather than a gap. This fails if a cap is ever wired up, which
    // is the point — the pricing copy would have to change with it.
    await signInAs("free");
    seedWords(db, 25);

    await page.goto("/my-words");

    await expect(page.getByText("كلمة25")).toBeVisible();
    await expect(page.getByText(/upgrade|limit reached|free plan/i)).toHaveCount(0);
  });
});

test.describe("root families", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("groups the deck by root, whatever spelling each card was saved with", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      // Three spellings of one root. Before roots were canonicalised these were
      // three strangers, and the grouping this test asserts was impossible.
      aUserVocabulary({ id: vocabId(0), user_id: TEST_USER_ID, word_arabic: "كتب", root: "ك-ت-ب" }),
      aUserVocabulary({ id: vocabId(1), user_id: TEST_USER_ID, word_arabic: "كتاب", root: "ك ت ب" }),
      aUserVocabulary({ id: vocabId(2), user_id: TEST_USER_ID, word_arabic: "مكتبة", root: "كتب" }),
      aUserVocabulary({ id: vocabId(3), user_id: TEST_USER_ID, word_arabic: "درس", root: "د ر س" }),
      aUserVocabulary({ id: vocabId(4), user_id: TEST_USER_ID, word_arabic: "مدرسة", root: "د ر س" }),
    ]);

    await page.goto("/my-words");

    await expect(page.getByText("Roots", { exact: true })).toBeVisible();
    // Biggest family first.
    await expect(page.getByRole("button", { name: /ك · ت · ب · 3/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /د · ر · س · 2/ })).toBeVisible();
  });

  test("filtering by a root narrows the list to that family", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), user_id: TEST_USER_ID, word_arabic: "كتاب", root: "ك ت ب" }),
      aUserVocabulary({ id: vocabId(1), user_id: TEST_USER_ID, word_arabic: "مكتبة", root: "ك-ت-ب" }),
      aUserVocabulary({ id: vocabId(2), user_id: TEST_USER_ID, word_arabic: "مدرسة", root: "د ر س" }),
      aUserVocabulary({ id: vocabId(3), user_id: TEST_USER_ID, word_arabic: "درس", root: "د ر س" }),
    ]);

    await page.goto("/my-words");
    await page.getByRole("button", { name: /ك · ت · ب · 2/ }).click();

    await expect(page.getByText("مكتبة")).toBeVisible();
    await expect(page.getByText("مدرسة")).toHaveCount(0);
  });

  test("keeps quiet when no two words share a root", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), user_id: TEST_USER_ID, word_arabic: "كتاب", root: "ك ت ب" }),
      aUserVocabulary({ id: vocabId(1), user_id: TEST_USER_ID, word_arabic: "مدرسة", root: "د ر س" }),
    ]);

    await page.goto("/my-words");

    await expect(page.getByText("كتاب")).toBeVisible();
    // Two families of one is not a shelf worth showing. The backfill prompt is
    // also absent, because every word here already has a root.
    await expect(page.getByText("Roots", { exact: true })).toHaveCount(0);
  });

  test("offers to look up the roots that are missing, and never does it unasked", async ({ page, db, backend }) => {
    db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), user_id: TEST_USER_ID, word_arabic: "كتاب", root: null }),
      aUserVocabulary({ id: vocabId(1), user_id: TEST_USER_ID, word_arabic: "مكتبة", root: null }),
    ]);
    backend.stubFunction("enrich-word-roots", { ok: true, examined: 2, resolved: 2, skippedFree: 0 });

    await page.goto("/my-words");
    await expect(page.getByRole("button", { name: /find roots for 2 words/i })).toBeVisible();

    // Nothing has been spent just by opening the page: this is the only part of
    // the feature that costs credits, and it waits to be asked twice.
    expect(backend.functionCalls.filter((c) => c.name === "enrich-word-roots")).toHaveLength(0);

    await page.getByRole("button", { name: /find roots for 2 words/i }).click();
    await page.getByRole("button", { name: /^find roots$/i }).click();

    await expect
      .poll(() => backend.functionCalls.filter((c) => c.name === "enrich-word-roots").length)
      .toBe(1);
  });
});

test.describe("reviewing in the quiz style", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free", { profile: { review_style: "quiz" } });
  });

  test("asks a saved word to fill the gap in the sentence it came from, and pays for it", async ({ page, db, backend }) => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    db.seed("user_vocabulary", [
      aUserVocabulary({
        id: vocabId(0),
        word_arabic: "السوق",
        word_english: "the market",
        sentence_text: "رحت السوق أمس",
        sentence_english: "I went to the market yesterday",
        repetitions: 0,
        ease_factor: 0,
        next_review_at: past,
      }),
      ...many(aUserVocabulary, 4, (index) => ({
        id: vocabId(index + 1),
        word_arabic: ["بيت", "مدرسة", "مطعم", "سيارة"][index],
        word_english: ["house", "school", "restaurant", "car"][index],
        // Not due: in the pool of wrong options, not in the deck.
        next_review_at: new Date(Date.now() + 86_400_000 * 30).toISOString(),
      })),
    ]);

    await page.goto("/review/my-words");

    await expect(page.getByText("Fill in the missing word")).toBeVisible();
    await expect(page.getByText(/how well did you remember/i)).toHaveCount(0);

    await page.getByRole("button", { name: "السوق", exact: true }).click();
    await page.getByRole("button", { name: /continue/i }).click();

    // The rating lands on the card's own schedule, and — unlike this deck's
    // flip cards, which pay nothing — a graded answer earns the review XP.
    await expect.poll(() => db.rows("user_vocabulary").find((r) => r.id === vocabId(0))?.repetitions).toBe(1);
    await expect.poll(() => backend.rpcCallsTo("award_xp").length).toBeGreaterThan(0);
  });

  test("offers the lightning round after the session, and the round writes nothing", async ({ page, db, backend }) => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const WORDS: Array<[string, string, string]> = [
      ["السوق", "the market", "رحت السوق أمس"],
      ["قهوة", "coffee", "شربت قهوة الصبح"],
      ["البحر", "the sea", "البحر حلو اليوم"],
    ];
    db.seed("user_vocabulary", [
      ...WORDS.map(([arabic, english, sentence], index) =>
        aUserVocabulary({
          id: vocabId(index),
          word_arabic: arabic,
          word_english: english,
          sentence_text: sentence,
          // Seen once and barely held: a first look.
          repetitions: 1,
          ease_factor: 0.5,
          next_review_at: past,
        }),
      ),
      ...many(aUserVocabulary, 4, (index) => ({
        id: vocabId(index + 3),
        word_arabic: ["بيت", "مدرسة", "مطعم", "سيارة"][index],
        word_english: ["house", "school", "restaurant", "car"][index],
        next_review_at: new Date(Date.now() + 86_400_000 * 30).toISOString(),
      })),
    ]);
    // Which word a card is about: the hint names its meaning; a gap leaves its
    // sentence's last word, which is never the word itself.
    const wordFor = (text: string) =>
      WORDS.find(([, english, sentence]) => text.includes(english) || text.includes(sentence.split(" ").at(-1)!))![0];

    await page.goto("/review/my-words");
    for (let i = 0; i < 3; i++) {
      const hint = (await page.getByText(/the missing word means/i).textContent()) ?? "";
      await page.getByRole("button", { name: wordFor(hint), exact: true }).click();
      await page.getByRole("button", { name: /continue/i }).click();
    }

    await expect(page.getByText(/60 seconds over the 3 words you got right/i)).toBeVisible();
    await expect.poll(() => backend.rpcCallsTo("award_xp").length).toBeGreaterThanOrEqual(3);
    // Let the session's own writes land before taking the snapshot.
    await page.waitForTimeout(1000);
    const rows = JSON.stringify(db.rows("user_vocabulary"));
    const xp = backend.rpcCallsTo("award_xp").length;

    await page.getByRole("button", { name: /^start$/i }).click();
    const round = page.getByTestId("lightning-round");
    for (let i = 0; i < 3; i++) {
      await expect(round.getByText(`${i + 1} / 3`)).toBeVisible();
      const sentence = (await round.locator("[dir='rtl']").first().textContent()) ?? "";
      await round.getByRole("button", { name: wordFor(sentence), exact: true }).click();
    }
    await expect(page.getByLabel(/lightning round score/i)).toHaveText("3 / 3");

    // Nothing the round did is a rating or paid anything, not even a moment later.
    await page.waitForTimeout(1000);
    expect(JSON.stringify(db.rows("user_vocabulary"))).toBe(rows);
    expect(backend.rpcCallsTo("award_xp")).toHaveLength(xp);
  });

  test("opens on the worst leech as a first look, and beating it is celebrated", async ({ page, db }) => {
    const HOOK = "A souq stall selling socks";
    const day = 86_400_000;
    db.seed("user_vocabulary", [
      // More overdue, but no leech.
      aUserVocabulary({
        id: vocabId(0),
        word_arabic: "قهوة",
        word_english: "coffee",
        sentence_text: "شربت قهوة الصبح",
        ease_factor: 10,
        repetitions: 4,
        next_review_at: new Date(Date.now() - 3 * day).toISOString(),
      }),
      // The boss: settled enough to be heard alone (step 4), missed on both
      // schedules, and asked as a first look all the same.
      aUserVocabulary({
        id: vocabId(1),
        word_arabic: "السوق",
        word_english: "the market",
        sentence_text: "رحت السوق أمس",
        ease_factor: 10,
        repetitions: 4,
        is_leech: true,
        lapses: 4,
        production_lapses: 3,
        mnemonic: HOOK,
        next_review_at: new Date(Date.now() - day).toISOString(),
      }),
      ...many(aUserVocabulary, 4, (index) => ({
        id: vocabId(index + 2),
        word_arabic: ["بيت", "مدرسة", "مطعم", "سيارة"][index],
        word_english: ["house", "school", "restaurant", "car"][index],
        next_review_at: new Date(Date.now() + 30 * day).toISOString(),
      })),
    ]);

    await page.goto("/review/my-words");

    const boss = page.getByRole("region", { name: "Boss card" });
    await expect(boss).toContainText("missed 7 times");
    await expect(page.getByText(/the missing word means/i)).toContainText("the market");
    await expect(page.getByText(HOOK)).toHaveCount(0);

    await page.getByRole("button", { name: "السوق", exact: true }).click();
    await expect(boss.getByText(HOOK)).toBeVisible();
    await page.getByRole("button", { name: /continue/i }).click();

    // Closed at once: a small celebration closes itself after a moment, and
    // it hides the page from the accessibility tree while it is open.
    const beaten = page.getByRole("dialog", { name: "Boss beaten!" });
    await expect(beaten).toBeVisible();
    await beaten.getByRole("button", { name: "Continue" }).click();
    // Graded as a first look, Good, on the leech's own row.
    await expect.poll(() => db.rows("user_vocabulary").find((r) => r.id === vocabId(1))?.repetitions).toBe(5);
    // The next word is an ordinary card.
    await expect(page.getByRole("img", { name: /step \d+ of 10/i })).toBeVisible();
    await expect(page.getByRole("region", { name: "Boss card" })).toHaveCount(0);
  });

  test("serves the flip card when the deck is too thin for a question", async ({ page, db }) => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), word_arabic: "السوق", word_english: "the market", sentence_text: "رحت السوق أمس", next_review_at: past }),
    ]);

    await page.goto("/review/my-words");

    // One saved word cannot be asked among four; the ordinary card stands in.
    await expect(page.getByText("السوق")).toBeVisible();
    await expect(page.getByText("Fill in the missing word")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /reveal english/i })).toBeVisible();
  });
});

/**
 * Two learners who saved the same word share its first jingle.
 *
 * The first "Generate jingle" asks with `share: true`; the generator answers
 * from the shared asset store with a url, which goes on the saved word as it
 * is, with nothing uploaded. The regenerate button asks for a different jingle,
 * so it stays the learner's own.
 */
test.describe("a saved word's first jingle", () => {
  const SHARED =
    "https://e2e.supabase.co/storage/v1/object/public/flashcard-audio/word-assets/jingle/jingle-1/gulf/abc/1.wav";
  const past = () => new Date(Date.now() - 86_400_000).toISOString();

  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("is the shared one, kept by its url", async ({ page, db, backend }) => {
    db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), word_arabic: "السوق", word_english: "the market", next_review_at: past() }),
    ]);
    backend.stubFunction("generate-word-jingle", { audioUrl: SHARED, lyrics: "السوق السوق", cached: true });

    await page.goto("/review/my-words");
    await page.getByRole("button", { name: /Generate jingle/ }).click();

    await expect.poll(() => db.rows("user_vocabulary").find((r) => r.id === vocabId(0))?.jingle_audio_url).toBe(SHARED);
    expect(backend.lastCallTo("generate-word-jingle")?.body).toMatchObject({ word_arabic: "السوق", share: true });
    expect(backend.uploads().filter((key) => key.includes("jingles/"))).toEqual([]);
  });

  test("is asked for afresh, and uploaded as before, on a regenerate", async ({ page, db, backend }) => {
    db.seed("user_vocabulary", [
      aUserVocabulary({
        id: vocabId(0),
        word_arabic: "السوق",
        word_english: "the market",
        jingle_audio_url: SHARED,
        jingle_lyrics: "السوق",
        next_review_at: past(),
      }),
    ]);

    await page.goto("/review/my-words");
    await page.getByTitle("Regenerate jingle").click();

    await expect.poll(() => backend.uploads().some((key) => key.includes("jingles/"))).toBe(true);
    expect(backend.lastCallTo("generate-word-jingle")?.body).toMatchObject({ share: false });
  });
});
