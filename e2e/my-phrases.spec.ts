import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { aUserPhrase, phraseId } from "../src/test/support/factories";
import type { Row } from "../src/test/support/postgrest/types";

/**
 * My Phrases in the quiz style: the saved-phrase deck's own wiring.
 *
 * The frame, the boss and the lightning round have unit tests of their own;
 * what only this page decides is the deck it hands them and what it does with
 * an answer: a due phrase asked for its meaning and paid for, its worst leech
 * opening the session, and the round offered after it, writing nothing.
 */

const DAY = 86_400_000;
const yesterday = () => new Date(Date.now() - DAY).toISOString();
const nextMonth = () => new Date(Date.now() + 30 * DAY).toISOString();

/** Saved phrases that are not due: in the pool of wrong meanings, not in the deck. */
const pool = (): Row[] =>
  [
    ["كيف حالك", "how are you"],
    ["مع السلامة", "goodbye"],
    ["تصبح على خير", "good night"],
    ["الله يعطيك العافية", "God give you strength"],
  ].map(([arabic, english], index) =>
    aUserPhrase({ id: phraseId(index + 10), phrase_arabic: arabic, phrase_english: english, next_review_at: nextMonth() }),
  );

/** A phrase seen once and barely held: asked as a first look. */
const firstLook = (index: number, arabic: string, english: string, over: Row = {}) =>
  aUserPhrase({
    id: phraseId(index),
    phrase_arabic: arabic,
    phrase_english: english,
    ease_factor: 0,
    repetitions: 0,
    next_review_at: yesterday(),
    ...over,
  });

test.describe("reviewing saved phrases in the quiz style", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free", { profile: { review_style: "quiz" } });
  });

  test("asks a due phrase for its meaning, rates it, and pays for it", async ({ page, db, backend }) => {
    db.seed("user_phrases", [firstLook(0, "على راسي", "with pleasure"), ...pool()]);

    await page.goto("/review/my-phrases");

    await expect(page.getByText("What does it mean?")).toBeVisible();
    await expect(page.getByText(/how well did you remember/i)).toHaveCount(0);
    await page.getByRole("radio", { name: "with pleasure" }).click();
    await page.getByRole("button", { name: /continue/i }).click();

    await expect.poll(() => db.rows("user_phrases").find((r) => r.id === phraseId(0))?.repetitions).toBe(1);
    await expect.poll(() => backend.rpcCallsTo("award_xp").length).toBeGreaterThan(0);
  });

  test("opens on the worst leech as a first look, and beating it is celebrated", async ({ page, db }) => {
    const HOOK = "A head with a hat on it, saying yes";
    db.seed("user_phrases", [
      // More overdue, but no leech.
      aUserPhrase({
        id: phraseId(0),
        phrase_arabic: "ما عليه",
        phrase_english: "never mind",
        ease_factor: 3,
        repetitions: 3,
        next_review_at: new Date(Date.now() - 3 * DAY).toISOString(),
      }),
      // The boss: held well enough for a harder question, and asked as a
      // first look all the same.
      aUserPhrase({
        id: phraseId(1),
        phrase_arabic: "على راسي",
        phrase_english: "with pleasure",
        ease_factor: 3,
        repetitions: 3,
        is_leech: true,
        lapses: 7,
        mnemonic: HOOK,
        next_review_at: yesterday(),
      }),
      ...pool(),
    ]);

    await page.goto("/review/my-phrases");

    const boss = page.getByRole("region", { name: "Boss card" });
    await expect(boss).toContainText("missed 7 times");
    await expect(page.getByText("What does it mean?")).toBeVisible();
    await expect(page.getByText(HOOK)).toHaveCount(0);

    await page.getByRole("radio", { name: "with pleasure" }).click();
    await expect(boss.getByText(HOOK)).toBeVisible();
    await page.getByRole("button", { name: /continue/i }).click();

    await expect(page.getByRole("dialog", { name: "Boss beaten!" })).toBeVisible();
    await expect.poll(() => db.rows("user_phrases").find((r) => r.id === phraseId(1))?.repetitions).toBe(4);
    await expect(page.getByRole("region", { name: "Boss card" })).toHaveCount(0);
  });

  test("offers the lightning round after the session, and the round writes nothing", async ({ page, db, backend }) => {
    const PHRASES: Array<[string, string]> = [
      ["على راسي", "with pleasure"],
      ["ما عليه", "never mind"],
      ["إن شاء الله", "God willing"],
    ];
    db.seed("user_phrases", [
      ...PHRASES.map(([arabic, english], index) => firstLook(index, arabic, english)),
      ...pool(),
    ]);
    // The phrase on screen, among those not yet answered, once it is there.
    const nextPhrase = async (scope: Page | Locator, answered: Set<string>) => {
      let shown = "";
      await expect
        .poll(async () => {
          shown = "";
          for (const [arabic] of PHRASES) {
            if (answered.has(arabic)) continue;
            if (await scope.getByText(arabic, { exact: true }).first().isVisible()) shown = arabic;
          }
          return shown;
        })
        .not.toBe("");
      return PHRASES.find(([arabic]) => arabic === shown)!;
    };

    await page.goto("/review/my-phrases");
    const asked = new Set<string>();
    for (let i = 0; i < 3; i++) {
      await expect(page.getByText("What does it mean?")).toBeVisible();
      const [arabic, english] = await nextPhrase(page, asked);
      asked.add(arabic);
      await page.getByRole("radio", { name: english }).click();
      await page.getByRole("button", { name: /continue/i }).click();
    }

    await expect(page.getByText(/60 seconds over the 3 words you got right/i)).toBeVisible();
    await expect.poll(() => backend.rpcCallsTo("award_xp").length).toBeGreaterThanOrEqual(3);
    // Let the session's own writes land before taking the snapshot.
    await page.waitForTimeout(1000);
    const rows = JSON.stringify(db.rows("user_phrases"));
    const xp = backend.rpcCallsTo("award_xp").length;

    await page.getByRole("button", { name: /^start$/i }).click();
    const round = page.getByTestId("lightning-round");
    const played = new Set<string>();
    for (let i = 0; i < 3; i++) {
      await expect(round.getByText(`${i + 1} / 3`)).toBeVisible();
      const [arabic, english] = await nextPhrase(round, played);
      played.add(arabic);
      await round.getByRole("radio", { name: english }).click();
    }
    await expect(page.getByLabel(/lightning round score/i)).toHaveText("3 / 3");

    // Nothing the round did is a rating or paid anything, not even a moment later.
    await page.waitForTimeout(1000);
    expect(JSON.stringify(db.rows("user_phrases"))).toBe(rows);
    expect(backend.rpcCallsTo("award_xp")).toHaveLength(xp);
  });
});
