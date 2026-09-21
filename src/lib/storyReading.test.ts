import { describe, expect, it } from "vitest";
import {
  hasDialect,
  lineRegister,
  storedClipFor,
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
