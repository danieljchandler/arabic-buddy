import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  hasDialect,
  isDialectTarget,
  lineRegister,
  storedClipFor,
  storedClipRegister,
  storyLineText,
  ttsDialectFor,
  type ReadableStoryLine,
} from "./storyReading";

/**
 * Which of a story's two Arabics is on screen, and what says it.
 *
 * A reading-library story holds the same sentence twice — the public-domain
 * fusha it was imported from and the dialect rendering the app teaches — and
 * the bug these rules exist to prevent is the two coming apart: dialect on the
 * page, MSA in the speaker. That is not a cosmetic mismatch. A learner who
 * hears a recording read under a sentence takes the recording to be that
 * sentence, so playing the fusha under the dialect teaches them the dialect is
 * pronounced like fusha.
 */

const aLine = (over: Partial<ReadableStoryLine> = {}): ReadableStoryLine => ({
  arabic: "أريد أن أذهب إلى السوق",
  arabic_vocalized: "أُرِيدُ أَنْ أَذْهَبَ إِلَى السُّوق",
  dialect: "أبغى أروح السوق",
  dialect_vocalized: "أَبْغَى أَرُوح السُّوق",
  audio_url: null,
  ...over,
});

describe("what the line can show", () => {
  it("counts a line with either dialect form as having one", () => {
    expect(hasDialect(aLine())).toBe(true);
    expect(hasDialect(aLine({ dialect_vocalized: null }))).toBe(true);
    expect(hasDialect(aLine({ dialect: null }))).toBe(true);
  });

  it("does not count whitespace as a rendering", () => {
    // The converter pads a line it could not do rather than shifting the rest
    // into place, so an empty string here is the ordinary case, not an error.
    expect(hasDialect(aLine({ dialect: "  ", dialect_vocalized: "" }))).toBe(false);
  });

  it("falls a line with no dialect back to fusha even when dialect was asked for", () => {
    const skipped = aLine({ dialect: null, dialect_vocalized: null });
    expect(lineRegister(skipped, "dialect")).toBe("fusha");
    expect(storyLineText(skipped, "dialect")).toBe("أُرِيدُ أَنْ أَذْهَبَ إِلَى السُّوق");
  });
});

describe("the text on screen", () => {
  it("prefers the vocalized form within the register it was asked for", () => {
    expect(storyLineText(aLine(), "dialect")).toBe("أَبْغَى أَرُوح السُّوق");
    expect(storyLineText(aLine(), "fusha")).toBe("أُرِيدُ أَنْ أَذْهَبَ إِلَى السُّوق");
  });

  it("never crosses registers to find diacritics", () => {
    // The trap: fusha *with* tashkeel looks like the better rendering of a
    // dialect line that has none. It is the wrong sentence, and this is the
    // ordering the narration path used to get wrong.
    expect(storyLineText(aLine({ dialect_vocalized: null }), "dialect")).toBe("أبغى أروح السوق");
  });
});

describe("the stored recording", () => {
  const recorded = (over: Partial<ReadableStoryLine> = {}) =>
    aLine({ audio_url: "https://cdn.test/line-0.wav", ...over });

  it("plays under the dialect it was made from", () => {
    expect(storedClipFor(recorded(), "dialect")).toBe("https://cdn.test/line-0.wav");
  });

  it("plays under the fusha when the line has no dialect at all", () => {
    // Nothing else could have been narrated, so the stored clip is the fusha.
    const clip = storedClipFor(
      recorded({ dialect: null, dialect_vocalized: null }),
      "fusha",
    );
    expect(clip).toBe("https://cdn.test/line-0.wav");
  });

  it("is refused when the learner switched to the fusha of a dialect recording", () => {
    // The page then synthesises the fusha instead. One TTS call is cheaper
    // than teaching the wrong pronunciation.
    expect(storedClipFor(recorded(), "fusha")).toBeNull();
  });

  it("is nothing at all when the story was never narrated", () => {
    expect(storedClipFor(aLine(), "dialect")).toBeNull();
    expect(storedClipFor(aLine({ audio_url: "   " }), "dialect")).toBeNull();
  });
});

describe("a recording made before the narration path was fixed", () => {
  /**
   * The chain that made the clips on disk was `dialect_vocalized ||
   * arabic_vocalized || dialect`. It agrees with today's `spokenStoryLine`
   * everywhere except on a line converted to dialect without tashkeel, where
   * it reached past the dialect for the vocalized fusha. Those rows still
   * exist, and their clips are fusha while their text is dialect.
   */
  const legacy = (over: Partial<ReadableStoryLine> = {}) =>
    aLine({
      audio_url: "https://cdn.test/line-0.wav",
      dialect_vocalized: null,
      ...over,
    });

  it("cannot say which register an unvocalized dialect line was narrated in", () => {
    expect(storedClipRegister(legacy())).toBeNull();
  });

  it("refuses that clip rather than guessing from the row", () => {
    // Guessing "dialect" because the row has one is precisely how a fusha
    // recording ends up playing under dialect text.
    expect(storedClipFor(legacy(), "dialect")).toBeNull();
    expect(storedClipFor(legacy(), "fusha")).toBeNull();
  });

  it("is certain again once the dialect carries tashkeel", () => {
    // Which is what every writer now stores, falling back to the plain
    // rendering — so the ambiguous shape cannot be created any more.
    expect(storedClipRegister(aLine())).toBe("dialect");
  });

  it("reads a line with nothing vocalized at all as dialect", () => {
    // Both chains run out of vocalized forms and land on `dialect`.
    const bare = legacy({ arabic_vocalized: null });
    expect(storedClipRegister(bare)).toBe("dialect");
    expect(storedClipFor(bare, "dialect")).toBe("https://cdn.test/line-0.wav");
  });

  it("reads a line with no dialect as fusha whatever else it has", () => {
    expect(storedClipRegister(legacy({ dialect: null }))).toBe("fusha");
  });
});

describe("which voice reads the page", () => {
  it("uses the story's own dialect for the dialect view", () => {
    expect(ttsDialectFor("Egyptian", "dialect")).toBe("Egyptian");
  });

  it("reads the original in MSA rather than in a dialect voice", () => {
    // `tts-speak` understands "MSA" and routes it to its own voice; a Gulf
    // voice reading case endings is neither one register nor the other.
    expect(ttsDialectFor("Egyptian", "fusha")).toBe("MSA");
  });

  it("falls back to Gulf for a story filed under nothing", () => {
    expect(ttsDialectFor(null, "dialect")).toBe("Gulf");
  });
});

describe("what counts as a dialect to convert to", () => {
  it("takes the three dialects and refuses the register", () => {
    expect(isDialectTarget("Gulf")).toBe(true);
    expect(isDialectTarget("Egyptian")).toBe(true);
    expect(isDialectTarget("MSA")).toBe(false);
    expect(isDialectTarget("fusha")).toBe(false);
    expect(isDialectTarget(null)).toBe(false);
  });

  it("agrees with the edge function that enforces it", () => {
    // Two copies because one runs in the browser and one in Deno, and the
    // Deno module imports the Brain so it cannot be shared. They have to say
    // the same thing: this side decides whether to offer the button, that
    // side refuses the request, and a disagreement means an editor is offered
    // an action that can only fail.
    const shared = readFileSync(
      join(process.cwd(), "supabase", "functions", "_shared", "storyDialect.ts"),
      "utf8",
    );
    const labels = shared.match(/const FUSHA_LABELS = new Set\(\[([^\]]*)\]\)/);
    expect(labels, "FUSHA_LABELS not found in storyDialect.ts").not.toBeNull();
    const theirs = [...labels![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();

    const ours = ["msa", "fusha", "fus7a", "standard", "classical"].sort();
    expect(theirs).toEqual(ours);
    // And every one of them is actually refused on this side.
    theirs.forEach((label) => expect(isDialectTarget(label)).toBe(false));
  });
});
