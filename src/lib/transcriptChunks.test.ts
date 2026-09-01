import { describe, expect, it } from "vitest";
import {
  collectCompoundCandidates,
  filterNewCandidates,
  multiWordEntries,
} from "./transcriptChunks";
import type { TranscriptLine, WordToken } from "@/types/transcript";

/**
 * Mining chunk candidates out of the compound marks native reviewers leave in
 * transcripts. The convention being parsed is the one the transcript
 * renderers read: the compound's first token carries the whole-phrase gloss,
 * the following tokens are marked as continuations (compoundRef, or the
 * legacy "(→ …)" gloss). Getting a run boundary wrong doesn't error — it
 * silently offers admins half a phrase, which then gets drilled as a chunk.
 */

let nextId = 0;
const tok = (surface: string, over: Partial<WordToken> = {}): WordToken => ({
  id: `t-${nextId++}`,
  surface,
  ...over,
});

const line = (tokens: WordToken[], over: Partial<TranscriptLine> = {}): TranscriptLine =>
  ({
    id: `l-${nextId++}`,
    arabic: tokens.map((t) => t.surface).join(" "),
    translation: "an example line",
    tokens,
    startMs: 0,
    endMs: 2000,
    ...over,
  }) as TranscriptLine;

const video = (lines: TranscriptLine[], id = "vid-1", title = "Souq walk") => ({
  id,
  title,
  lines,
});

/** الله يعطيك العافية — a marked three-word compound with a gloss up front. */
const blessing = () => [
  tok("الله", { gloss: "may God give you strength" }),
  tok("يعطيك", { compoundRef: "الله" }),
  tok("العافية", { compoundRef: "الله" }),
];

describe("collectCompoundCandidates", () => {
  it("assembles a marked run into one candidate with the first token's gloss", () => {
    const out = collectCompoundCandidates([video([line([tok("قال"), ...blessing()])])]);

    expect(out).toHaveLength(1);
    expect(out[0].arabic).toBe("الله يعطيك العافية");
    expect(out[0].gloss).toBe("may God give you strength");
    expect(out[0].contexts[0]).toMatchObject({ videoId: "vid-1", videoTitle: "Souq walk" });
  });

  it("understands the legacy gloss marker as a continuation", () => {
    const out = collectCompoundCandidates([
      video([
        line([
          tok("شخبارك", { gloss: "how are you" }),
          tok("اليوم", { gloss: "(→ شخبارك)" }),
        ]),
      ]),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].arabic).toBe("شخبارك اليوم");
    // The pointer gloss is plumbing, not a translation.
    expect(out[0].gloss).toBe("how are you");
  });

  it("counts the same compound across videos and spelling variants", () => {
    const out = collectCompoundCandidates([
      video([line(blessing())], "vid-1"),
      // Diacritics on the second sighting — same phrase, same candidate.
      video(
        [
          line([
            tok("اللهُ", { gloss: "may God give you strength" }),
            tok("يعطيكَ", { compoundRef: "الله" }),
            tok("العافية", { compoundRef: "الله" }),
          ]),
        ],
        "vid-2",
        "Kitchen chat",
      ),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(2);
    expect(out[0].contexts.map((c) => c.videoId)).toEqual(["vid-1", "vid-2"]);
  });

  it("ranks by how often reviewers marked it, then by phrase length", () => {
    const twice = [video([line(blessing()), line(blessing())])];
    const once = [
      video([
        line([tok("يلا", { gloss: "let's go" }), tok("نروح", { compoundRef: "يلا" })]),
      ]),
    ];
    const out = collectCompoundCandidates([...twice, ...once]);

    expect(out.map((c) => c.arabic)).toEqual(["الله يعطيك العافية", "يلا نروح"]);
  });

  it("keeps two separate compounds in one line apart", () => {
    const out = collectCompoundCandidates([
      video([
        line([
          tok("يلا", { gloss: "let's go" }),
          tok("نروح", { compoundRef: "يلا" }),
          tok("و"),
          tok("ان", { gloss: "God willing" }),
          tok("شاء", { compoundRef: "ان" }),
          tok("الله", { compoundRef: "ان" }),
        ]),
      ]),
    ]);

    expect(out.map((c) => c.arabic).sort()).toEqual(["ان شاء الله", "يلا نروح"]);
  });

  it("offers nothing from a transcript with no compound marks", () => {
    const out = collectCompoundCandidates([
      video([line([tok("مرحبا", { gloss: "hello" }), tok("شباب", { gloss: "guys" })])]),
    ]);
    expect(out).toEqual([]);
  });

  it("caps the example contexts rather than building a concordance", () => {
    const lines = Array.from({ length: 6 }, (_, i) =>
      line(blessing(), { arabic: `سياق ${i} الله يعطيك العافية` }),
    );
    const out = collectCompoundCandidates([video(lines)]);

    expect(out[0].count).toBe(6);
    expect(out[0].contexts.length).toBeLessThanOrEqual(3);
  });
});

describe("filterNewCandidates", () => {
  const candidates = () => collectCompoundCandidates([video([line(blessing())])]);

  it("drops a candidate the deck already holds, across spelling variants", () => {
    // Tashkeel and hamza seats differ on the page, not in the mouth — the
    // deck holding a variant spelling still means the phrase is covered.
    expect(filterNewCandidates(candidates(), ["اللهُ يعطيكَ العافية"])).toEqual([]);
  });

  it("keeps candidates the deck has never seen", () => {
    const out = filterNewCandidates(candidates(), ["صباح الخير", null, undefined]);
    expect(out).toHaveLength(1);
  });
});

describe("multiWordEntries", () => {
  it("flags lesson vocabulary that is secretly a phrase", () => {
    const entries = [
      { arabic: "بيت", english: "house" },
      { arabic: "وش رايك", english: "what do you think" },
      { arabic: "  الله يسلمك ", english: "reply to a blessing" },
    ];
    expect(multiWordEntries(entries).map((e) => e.arabic)).toEqual([
      "وش رايك",
      "  الله يسلمك ",
    ]);
  });
});
