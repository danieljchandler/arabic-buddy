import { expect, test } from "./support/fixtures";
import { aDiscoverVideo, aSetPhrase, setPhraseId, videoId } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * /admin/chunks — the chunk-candidate promotion queue.
 *
 * Native reviewers mark multi-word units in transcripts, and those marks are
 * the only dialect-native chunk inventory anywhere — so the queue's job is to
 * turn them into set-phrase drafts without re-offering what the deck already
 * holds. The dedupe matters as much as the listing: a queue that keeps
 * offering promoted phrases trains admins to ignore it.
 */

/** A line whose reviewers marked الله يعطيك العافية as one compound. */
const blessingLine = (id: string) => ({
  id,
  arabic: "قال الله يعطيك العافية",
  translation: "He said: may God give you strength",
  startMs: 0,
  endMs: 3000,
  tokens: [
    { id: `${id}-t0`, surface: "قال", gloss: "he said" },
    { id: `${id}-t1`, surface: "الله", gloss: "may God give you strength" },
    { id: `${id}-t2`, surface: "يعطيك", compoundRef: "الله" },
    { id: `${id}-t3`, surface: "العافية", compoundRef: "الله" },
  ],
});

/** A second compound, already present in the deck. */
const knownLine = (id: string) => ({
  id,
  arabic: "يلا نروح السوق",
  translation: "Let's go to the market",
  startMs: 4000,
  endMs: 7000,
  tokens: [
    { id: `${id}-t0`, surface: "يلا", gloss: "let's go" },
    { id: `${id}-t1`, surface: "نروح", compoundRef: "يلا" },
    { id: `${id}-t2`, surface: "السوق", gloss: "the market" },
  ],
});

function seedCorpus(db: MemoryDb) {
  db.seed("discover_videos", [
    aDiscoverVideo({
      id: videoId(0),
      title: "Souq walk",
      dialect: "Gulf",
      transcript_lines: [blessingLine("l1"), knownLine("l2")],
    }),
    aDiscoverVideo({
      id: videoId(1),
      title: "Kitchen chat",
      dialect: "Kuwaiti",
      transcript_lines: [blessingLine("l3")],
    }),
  ]);
  // The deck already holds يلا نروح — in a variant spelling, which must still
  // count as covered.
  db.seed("set_phrases", [
    aSetPhrase({ id: setPhraseId(0), phrase_arabic: "يَلا نروح", dialect: "Gulf" }),
  ]);
}

test.describe("the candidate queue", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("admin");
  });

  test("lists marked compounds the deck doesn't hold, counted across the module", async ({
    page,
    db,
  }) => {
    seedCorpus(db);

    await page.goto("/admin/chunks");

    // The blessing was marked in a Gulf clip and a Kuwaiti one — the module
    // is the unit, so both sightings count toward one candidate.
    await expect(page.getByText("الله يعطيك العافية").first()).toBeVisible();
    await expect(page.getByText("marked 2×")).toBeVisible();
    await expect(page.getByText("may God give you strength").first()).toBeVisible();

    // يلا نروح is already in the deck (in a variant spelling) — re-offering it
    // would train admins to ignore the queue.
    await expect(page.getByText("marked 1×")).toBeHidden();
  });

  test("promotes a candidate into a set-phrase draft for the editorial pass", async ({
    page,
    db,
  }) => {
    seedCorpus(db);

    await page.goto("/admin/chunks");
    await page.getByRole("button", { name: "Promote" }).click();

    await expect(page.getByText("drafted")).toBeVisible();

    // Promotion is sourcing, not publishing: the row lands as a draft, tagged
    // with where it came from, carrying the gloss and an example line as raw
    // material for the editorial pass on /admin/set-phrases.
    const drafts = db
      .rows("set_phrases")
      .filter((row) => row.status === "draft");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      dialect: "Gulf",
      phrase_arabic: "الله يعطيك العافية",
      phrase_english: "may God give you strength",
      tags: ["transcript"],
    });
    expect(String(drafts[0].scenario_english)).toContain("may God give you strength");
  });

  test("says plainly when there is nothing to promote", async ({ page, db }) => {
    db.seed("discover_videos", []);
    db.seed("set_phrases", []);

    await page.goto("/admin/chunks");

    await expect(page.getByText(/Nothing to promote/)).toBeVisible();
  });
});
