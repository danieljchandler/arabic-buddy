import { describe, expect, it } from "vitest";
import { loadAllTracks } from "../../scripts/curriculum/loadTracks";
import {
  ACTION_NOUNS,
  ANIMATION_ASPECT,
  ANIMATION_SECONDS,
  asStoredAnimation,
  inkAnimationPosterPrompt,
  inkAnimationPrompt,
  isVerbCategory,
  qualifiesForAnimation,
} from "../../supabase/functions/_shared/wordAnimation";
import {
  animationConcept,
  assetKey,
  INK_ANIMATION_STYLE,
  INK_PICTURE_STYLE,
  NEUTRAL_FIGURE_LINE,
} from "../../supabase/functions/_shared/wordAssets";

/**
 * Animations for action words (`supabase/functions/_shared/wordAnimation.ts`,
 * quiz Phase 5): which words get a clip, how its prompts are built, and what a
 * filed one is.
 *
 * The qualifying rule is held to the authored tracks themselves, because the
 * data is what decides it: the tracks spell a verb's category nine ways, and a
 * rule written against the spelling someone remembered ("Verb") would miss
 * most of Stage 2.
 */

const trackWords = loadAllTracks().flatMap((track) =>
  track.lessons.flatMap((lesson) =>
    lesson.vocabulary.map((word) => ({ ...word, dialect: track.dialect, stage: track.stage })),
  ),
);

describe("which categories are verbs", () => {
  it("takes every way the tracks spell a verb", () => {
    for (const category of [
      "Verb",
      "Verb — routine",
      "Verb — daily routine",
      "Verb — past",
      "Verb — meals",
      "Verb — shopping",
      "Verb — café",
      "Verb — command",
      "Verb — bargaining",
      "verb",
    ]) {
      expect(isVerbCategory(category), category).toBe(true);
    }
  });

  it("does not take a category that only contains the letters, or a verb-shaped one that is no action", () => {
    for (const category of [
      "Adverb",
      "Verb phrase",
      "Verb phrase — command",
      "Verb frame",
      "Pseudo-verb",
      "Modal",
      "Participle",
      "Noun",
      "",
      null,
      undefined,
    ]) {
      expect(isVerbCategory(category), String(category)).toBe(false);
    }
  });

  it("knows every verb category the tracks actually use", () => {
    // If an author adds a tenth spelling, this names it, so the rule is
    // checked against it rather than silently skipping a lesson's verbs.
    const verbish = new Set(trackWords.map((w) => w.category).filter((c) => /^verb\b/i.test(c)));
    const taken = [...verbish].filter(isVerbCategory).sort();
    const left = [...verbish].filter((c) => !isVerbCategory(c)).sort();
    expect(left).toEqual(["Verb frame", "Verb phrase", "Verb phrase — command"]);
    expect(taken.length).toBeGreaterThanOrEqual(8);
  });
});

describe("which words qualify", () => {
  it("takes a verb whose gloss is an action", () => {
    expect(qualifiesForAnimation({ category: "Verb — routine", gloss: "I eat" })).toBe(true);
    expect(qualifiesForAnimation({ category: "Verb", gloss: "laughed" })).toBe(true);
  });

  it("does not take a verb with nothing to watch", () => {
    for (const gloss of ["I want", "was / were", "I think (that)", "I hate", "I feel", "forgot", "happened"]) {
      expect(qualifiesForAnimation({ category: "Verb", gloss }), gloss).toBe(false);
    }
  });

  it("does not take a verb whose gloss is a note", () => {
    for (const gloss of ["do you want? (to a man)", "I would (unreal)", "then … would have"]) {
      expect(qualifiesForAnimation({ category: "Verb", gloss }), gloss).toBe(false);
    }
  });

  it("takes an action noun by its action, and no other noun", () => {
    expect(qualifiesForAnimation({ category: "Noun", gloss: "traffic / crowd" })).toBe(true);
    expect(qualifiesForAnimation({ category: "Noun — travel", gloss: "trip" })).toBe(true);
    expect(qualifiesForAnimation({ category: "Noun", gloss: "coffee" })).toBe(false);
    expect(qualifiesForAnimation({ category: "Adverb", gloss: "suddenly" })).toBe(false);
  });

  it("does not take a word with no category, which is every learner's saved word", () => {
    // `user_vocabulary` carries no part of speech, and an English gloss
    // cannot tell "to fly" from "a fly" once it is written "fly".
    expect(qualifiesForAnimation({ category: null, gloss: "to jump" })).toBe(false);
    expect(qualifiesForAnimation({ gloss: "I eat" })).toBe(false);
  });

  it("lists only action nouns some track word is", () => {
    // An entry no word folds to is a typo that qualifies nothing.
    const actions = new Set(trackWords.map((w) => animationConcept(w.english)));
    for (const noun of ACTION_NOUNS) expect(actions.has(noun), noun).toBe(true);
  });

  it("gives the tracks a clip per action, shared across dialects", () => {
    const qualifying = trackWords.filter((w) => qualifiesForAnimation({ category: w.category, gloss: w.english }));
    const keys = new Set(
      qualifying.map((w) => assetKey({ kind: "animation", word: w.arabic, gloss: w.english, dialect: w.dialect })?.conceptKey),
    );
    expect(keys.has(undefined)).toBe(false);
    // Fewer clips than words: Gulf's آكل, Egyptian's باكل and Yemeni's آكل are one "eat".
    expect(keys.size).toBeLessThan(qualifying.length);
    expect(keys.has("eat")).toBe(true);
    // Every qualifying word is a verb or an action noun, never an adverb.
    for (const w of qualifying) expect(w.category).not.toMatch(/^Adverb/);
  });

  it("finds Stage 1's one action and Stage 2's routine", () => {
    // Stage 1's verbs are mostly "I want"; the clips start to matter at
    // Stage 2's daily routine.
    const byStage = (stage: number) =>
      new Set(
        trackWords
          .filter((w) => w.stage === stage && qualifiesForAnimation({ category: w.category, gloss: w.english }))
          .map((w) => animationConcept(w.english)),
      );
    expect([...byStage(1)]).toEqual(["give me / pass me"]);
    for (const action of ["eat", "drink", "sleep", "wake up", "pray"]) expect(byStage(2).has(action), action).toBe(true);
  });
});

describe("the prompts", () => {
  it("draws the poster in the Ink picture style, framed for the clip, with nobody from one country", () => {
    const prompt = inkAnimationPosterPrompt("jump");
    expect(prompt).toContain('the action "jump"');
    expect(prompt).toContain(INK_PICTURE_STYLE);
    expect(prompt).toContain(NEUTRAL_FIGURE_LINE);
    expect(prompt).toContain("16:9");
    // A picture's dialect setting (kandura, a Cairo street, Sana'a) never reaches a clip every dialect is shown.
    expect(prompt).not.toMatch(/kandura|Cairo|Sana'a|galabeya/i);
  });

  it("animates the poster in the Ink motion style: one action, a still camera, no text", () => {
    const prompt = inkAnimationPrompt("jump");
    expect(prompt).toContain('the action "jump"');
    expect(prompt).toContain(INK_ANIMATION_STYLE);
    expect(INK_ANIMATION_STYLE).toMatch(/ending in exactly the pose/);
    expect(INK_ANIMATION_STYLE).toMatch(/camera never moves/);
    expect(INK_ANIMATION_STYLE).toMatch(/No text appears/);
  });

  it("cannot be steered by quotes in the action", () => {
    const prompt = inkAnimationPrompt('jump" and add a caption "hello');
    expect(prompt).not.toContain('"hello');
  });

  it("asks for the shortest clip, wide", () => {
    expect(ANIMATION_SECONDS).toBe(4);
    expect(ANIMATION_ASPECT).toBe("16:9");
  });
});

describe("a filed animation", () => {
  const clip = "https://cdn.test/word-animations/word-assets/animation/ink-1/any/abc/clip.mp4";
  const poster = "https://cdn.test/word-animations/word-assets/animation/ink-1/any/abc/poster.png";

  it("is a clip and its poster", () => {
    expect(asStoredAnimation({ url: clip, payload: { poster, seconds: 4, aspect: "16:9" } })).toEqual({ clip, poster });
  });

  it("is nothing without a poster, since reduced motion would have nothing to show", () => {
    expect(asStoredAnimation({ url: clip, payload: null })).toBeNull();
    expect(asStoredAnimation({ url: clip, payload: { poster: "" } })).toBeNull();
    expect(asStoredAnimation({ url: clip, payload: { poster: "javascript:alert(1)" } })).toBeNull();
  });

  it("is nothing without a clip", () => {
    expect(asStoredAnimation({ url: null, payload: { poster } })).toBeNull();
    expect(asStoredAnimation(null)).toBeNull();
  });
});
