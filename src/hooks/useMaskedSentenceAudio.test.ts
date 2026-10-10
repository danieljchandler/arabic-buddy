import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { maskedSentence, useMaskedSentenceAudio } from "./useMaskedSentenceAudio";

/**
 * The sentence a gap was cut from, read with the word muted until the
 * answer: the cloze card's audio, and since quiz Phase 6 the story
 * passage's. Two things it must keep. The word is not in what the voice is
 * given before the answer — muted in the text itself, so no voice can say
 * it — and both readings are in the one dialect's voice, so the gap is heard
 * in the voice the rest of the passage is read in.
 */

const tts = vi.hoisted(() => ({
  asked: [] as Array<{ text: string; skip?: boolean; dialect?: string }>,
  urls: {} as Record<string, string>,
}));

vi.mock("@/hooks/useAzureTTS", () => ({
  useAzureTTS: (options: { text: string; skip?: boolean; dialect?: string }) => {
    tts.asked.push(options);
    return { ttsUrl: options.skip ? null : (tts.urls[options.text] ?? null), isLoading: false, regenerate: vi.fn() };
  },
}));

const PASSAGE = "كان الصبح بارد وايد. طلب الريال قهوة حارة.";
const SPAN = { start: PASSAGE.indexOf("قهوة"), end: PASSAGE.indexOf("قهوة") + "قهوة".length };

beforeEach(() => {
  tts.asked = [];
  tts.urls = {};
});

describe("maskedSentence", () => {
  it("reads the span as a pause and everything else as written", () => {
    expect(maskedSentence(PASSAGE, SPAN)).toBe("كان الصبح بارد وايد. طلب الريال ... حارة.");
    expect(maskedSentence("قهوة حارة", { start: 0, end: 4 })).toBe("... حارة");
  });

  it("is the text itself with no span", () => {
    expect(maskedSentence(PASSAGE, null)).toBe(PASSAGE);
  });
});

describe("useMaskedSentenceAudio", () => {
  it("before the answer, plays a reading the word is not in, in the passage's dialect", () => {
    tts.urls["كان الصبح بارد وايد. طلب الريال ... حارة."] = "blob:muted";
    const { result } = renderHook(() => useMaskedSentenceAudio({ text: PASSAGE, span: SPAN, dialect: "Yemeni", revealed: false }));

    expect(result.current.url).toBe("blob:muted");
    const asked = tts.asked.filter((a) => !a.skip);
    expect(asked).toHaveLength(1);
    expect(asked[0].text).not.toContain("قهوة");
    expect(asked[0].dialect).toBe("Yemeni");
  });

  it("after the answer, plays the whole passage in the same dialect's voice", () => {
    tts.urls[PASSAGE] = "blob:whole";
    const { result } = renderHook(() => useMaskedSentenceAudio({ text: PASSAGE, span: SPAN, dialect: "Yemeni", revealed: true }));

    expect(result.current.url).toBe("blob:whole");
    expect(tts.asked.find((a) => a.text === PASSAGE && !a.skip)?.dialect).toBe("Yemeni");
  });

  it("plays a recording once the answer is in, and never before", () => {
    tts.urls["كان الصبح بارد وايد. طلب الريال ... حارة."] = "blob:muted";
    const before = renderHook(() =>
      useMaskedSentenceAudio({ text: PASSAGE, span: SPAN, revealed: false, recordingUrl: "https://cdn.test/line.mp3" }),
    );
    expect(before.result.current.url).toBe("blob:muted");

    tts.asked = [];
    const after = renderHook(() =>
      useMaskedSentenceAudio({ text: PASSAGE, span: SPAN, revealed: true, recordingUrl: "https://cdn.test/line.mp3" }),
    );
    expect(after.result.current.url).toBe("https://cdn.test/line.mp3");
    // Nothing synthesised for a sentence that has a recording.
    expect(tts.asked.find((a) => a.text === PASSAGE)?.skip).toBe(true);
  });

  it("reads nothing before the answer when there is no gap", () => {
    const { result } = renderHook(() => useMaskedSentenceAudio({ text: PASSAGE, span: null, revealed: false }));
    expect(result.current.url).toBeNull();
    expect(tts.asked.every((a) => a.skip)).toBe(true);
  });

  it("leaves the voice to the learner's dialect when the passage names none", () => {
    renderHook(() => useMaskedSentenceAudio({ text: PASSAGE, span: SPAN, dialect: null, revealed: false }));
    expect(tts.asked[0].dialect).toBeUndefined();
  });
});
