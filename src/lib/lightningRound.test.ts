import { describe, expect, it } from "vitest";
import {
  LIGHTNING_MIN_WORDS,
  LIGHTNING_MS,
  addLightningWord,
  answerLightning,
  canOfferLightning,
  currentLightningId,
  expireLightning,
  lightningFormat,
  lightningOver,
  lightningRemainingMs,
  lightningResult,
  lightningWordFor,
  nextLightning,
  startLightning,
  storedRecording,
  type LightningState,
} from "./lightningRound";

/**
 * The lightning round (quiz Phase 7): sixty seconds over the session's right
 * answers at steps 1–4, score and time only. What has to hold: only right
 * answers on the first four steps are in it, each word once; the clock ends
 * the round on the minute whatever is on screen; the last answer ends it at
 * once, and the time it took is the result; and nothing after the end counts.
 */

const T0 = 1_000_000;

describe("which right answers are in the round, and how each is asked", () => {
  it("asks a gap as a gap, without the first look's hint", () => {
    expect(lightningFormat({ correct: true, step: 1, format: "cloze-hint" }, true)).toBe("cloze");
    expect(lightningFormat({ correct: true, step: 2, format: "cloze" }, true)).toBe("cloze");
  });

  it("asks a picture, or a meaning, as the word shown to pick its meaning", () => {
    expect(lightningFormat({ correct: true, step: 3, format: "picture-choice" }, true)).toBe("meaning");
    expect(lightningFormat({ correct: true, step: 1, format: "meaning" }, false)).toBe("meaning");
  });

  it("asks a word heard alone the same way only when it has a recording; the round synthesises nothing", () => {
    expect(lightningFormat({ correct: true, step: 4, format: "listen" }, true)).toBe("listen");
    expect(lightningFormat({ correct: true, step: 4, format: "listen" }, false)).toBe("meaning");
  });

  it("leaves out a wrong answer", () => {
    expect(lightningFormat({ correct: false, step: 2, format: "cloze" }, true)).toBeNull();
  });

  it("leaves out everything above the fourth step, a fallback question included", () => {
    expect(lightningFormat({ correct: true, step: 5, format: "word-choice" }, true)).toBeNull();
    // Step 6 with no dialogue falls back to picking the word; step 7 on is spoken.
    expect(lightningFormat({ correct: true, step: 6, format: "word-choice" }, true)).toBeNull();
    expect(lightningFormat({ correct: true, step: 7, format: "speak" }, true)).toBeNull();
    // A step-5 card can never be a listen question, but a step number is what decides.
    expect(lightningFormat({ correct: true, step: 5, format: "listen" }, true)).toBeNull();
  });

  it("leaves out a question the round does not ask", () => {
    expect(lightningFormat({ correct: true, step: 1, format: "flashcard" }, true)).toBeNull();
    expect(lightningFormat({ correct: true, step: 0, format: "cloze" }, true)).toBeNull();
  });
});

describe("a session's answer as a word for the round", () => {
  const item = { id: "w1:recognition", arabic: "سوق", audioUrl: "https://audio.test/souq.mp3" };

  it("keeps the card, and asks it the round's question", () => {
    expect(lightningWordFor({ correct: true, step: 4, format: "listen" }, item)).toEqual({
      id: "w1:recognition",
      format: "listen",
      item,
    });
  });

  it("drops a voice the page synthesised: it is revoked by the end of the session, and the round makes none", () => {
    const word = lightningWordFor({ correct: true, step: 4, format: "listen" }, { ...item, audioUrl: "blob:http://app/1" });
    expect(word).toEqual({ id: "w1:recognition", format: "meaning", item: { ...item, audioUrl: null } });
    expect(storedRecording("blob:http://app/1")).toBeNull();
    expect(storedRecording(null)).toBeNull();
    expect(storedRecording("https://audio.test/a.mp3")).toBe("https://audio.test/a.mp3");
  });

  it("is nothing for an answer the round leaves out", () => {
    expect(lightningWordFor({ correct: false, step: 1, format: "cloze" }, item)).toBeNull();
    expect(lightningWordFor({ correct: true, step: 5, format: "word-choice" }, item)).toBeNull();
  });
});

describe("today's words", () => {
  it("keeps a word once, the first time it is right", () => {
    let words = addLightningWord([], { id: "a", format: "cloze", item: 1 });
    words = addLightningWord(words, { id: "b", format: "listen", item: 2 });
    words = addLightningWord(words, { id: "a", format: "meaning", item: 3 });
    expect(words).toEqual([
      { id: "a", format: "cloze", item: 1 },
      { id: "b", format: "listen", item: 2 },
    ]);
  });

  it("offers a round from three words", () => {
    expect(LIGHTNING_MIN_WORDS).toBe(3);
    expect(canOfferLightning(["a", "b"])).toBe(false);
    expect(canOfferLightning(["a", "b", "c"])).toBe(true);
  });
});

describe("a round", () => {
  const start = (ids = ["a", "b", "c"]) => startLightning(ids, "seed", T0);

  it("never deals the last round's order again", () => {
    const ids = ["a", "b", "c"];
    for (let seed = 0; seed < 20; seed++) {
      const first = startLightning(ids, `${seed}`, T0).order;
      const again = startLightning(ids, `${seed}`, T0, first).order;
      expect(again).not.toEqual(first);
      expect([...again].sort()).toEqual(ids);
    }
    // One word has one order.
    expect(startLightning(["a"], "0", T0, ["a"]).order).toEqual(["a"]);
  });

  it("deals every word once, in an order of its own that a re-deal keeps", () => {
    const state = start(["a", "b", "c", "b"]);
    expect([...state.order].sort()).toEqual(["a", "b", "c"]);
    expect(startLightning(["a", "b", "c"], "seed", T0).order).toEqual(state.order);
    expect(currentLightningId(state)).toBe(state.order[0]);
    expect(lightningResult(state)).toBeNull();
  });

  it("counts the right answers, and moves on only once the reveal is over", () => {
    let state = start();
    const first = currentLightningId(state);
    state = answerLightning(state, true, T0 + 2000);
    expect(state).toMatchObject({ answered: 1, right: 1, revealing: true });
    // A second tap on the same word changes nothing.
    expect(answerLightning(state, true, T0 + 2100)).toBe(state);
    expect(currentLightningId(state)).toBe(first);

    state = nextLightning(state, T0 + 2500);
    expect(state.revealing).toBe(false);
    expect(currentLightningId(state)).toBe(state.order[1]);
    state = answerLightning(state, false, T0 + 4000);
    expect(state).toMatchObject({ answered: 2, right: 1 });
  });

  it("ends when the last word is answered, shows its answer, and the time it took is the result", () => {
    let state = start();
    state = nextLightning(answerLightning(state, true, T0 + 3000), T0 + 3500);
    state = nextLightning(answerLightning(state, false, T0 + 7000), T0 + 8200);
    const last = state.order[2];
    state = answerLightning(state, true, T0 + 12_300);

    // The clock stops on the answer, and the answer stays on screen for its beat.
    expect(lightningRemainingMs(state, T0 + 50_000)).toBe(LIGHTNING_MS - 12_300);
    expect(currentLightningId(state)).toBe(last);
    expect(lightningOver(state)).toBe(false);
    expect(lightningResult(state)).toBeNull();

    // A reveal that runs past the minute changes nothing: the round was over.
    state = nextLightning(state, T0 + 70_000);
    expect(currentLightningId(state)).toBeNull();
    expect(lightningOver(state)).toBe(true);
    expect(lightningResult(state)).toEqual({ right: 2, answered: 3, total: 3, seconds: 13, cleared: true });
  });

  it("ends on the minute, with the word on screen unanswered", () => {
    let state = start();
    state = nextLightning(answerLightning(state, true, T0 + 3000), T0 + 3500);
    expect(lightningRemainingMs(state, T0 + 59_000)).toBe(1000);
    expect(expireLightning(state, T0 + 59_999)).toBe(state);

    state = expireLightning(state, T0 + 61_500);
    expect(currentLightningId(state)).toBeNull();
    expect(lightningRemainingMs(state, T0 + 70_000)).toBe(0);
    expect(lightningResult(state)).toEqual({ right: 1, answered: 1, total: 3, seconds: 60, cleared: false });
  });

  it("does not count an answer given after the minute", () => {
    let state: LightningState = start();
    state = answerLightning(state, true, T0 + LIGHTNING_MS + 1);
    expect(state.answered).toBe(0);
    expect(lightningResult(state)).toMatchObject({ right: 0, seconds: 60, cleared: false });
  });

  it("ends a round whose clock ran out during a reveal, rather than dealing the next word", () => {
    let state = start();
    state = answerLightning(state, true, T0 + 59_800);
    state = nextLightning(state, T0 + 60_300);
    expect(currentLightningId(state)).toBeNull();
    expect(lightningResult(state)).toMatchObject({ right: 1, answered: 1, seconds: 60 });
  });

  it("is over before it starts with no words", () => {
    expect(lightningResult(startLightning([], "seed", T0))).toEqual({
      right: 0,
      answered: 0,
      total: 0,
      seconds: 0,
      cleared: true,
    });
  });
});
