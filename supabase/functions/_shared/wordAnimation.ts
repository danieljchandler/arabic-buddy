/**
 * An animation for an action word (quiz Phase 5): a short looping clip of the
 * action, kept in the shared store as `kind: "animation"` and shown where the
 * quiz would show the word's picture.
 *
 * Three things live here, shared by the function that makes a clip, the
 * script that asks for the curriculum's, and the quiz that shows them:
 *
 * - **which words qualify** (`qualifiesForAnimation`): a curriculum word
 *   whose category is a verb, or whose action is on `ACTION_NOUNS`, and whose
 *   gloss keys an action at all (`animationConcept` in `wordAssets.ts`, which
 *   is also the key, so the rule for "is an action" and the rule for "which
 *   clip" cannot disagree);
 * - **how a clip is made**: a poster first, a still of the action in the Ink
 *   picture style (`inkAnimationPosterPrompt`), then the clip, animated from
 *   that poster as its first and its last frame (`inkAnimationPrompt`), so it
 *   loops and keeps the look. Both prompts are built from the key's action
 *   alone: a clip is shown to every dialect's learners of the action, and
 *   nothing a caller says reaches it;
 * - **what a filed one is** (`asStoredAnimation`): a clip url and its
 *   poster's, both or nothing, read the same way everywhere.
 *
 * Pure: the browser imports it verbatim, and `src/test/wordAnimation.test.ts`
 * covers it.
 */

import {
  animationConcept,
  INK_ANIMATION_STYLE,
  INK_PICTURE_STYLE,
  NEUTRAL_FIGURE_LINE,
} from "./wordAssets.ts";

/** Seconds of clip: one action, once. Veo's shortest, and the cheapest. */
export const ANIMATION_SECONDS = 4;

/** Veo renders 16:9 or 9:16; the quiz's frames are landscape or square, cropped from the centre. */
export const ANIMATION_ASPECT = "16:9" as const;

/** The card shows a clip a few hundred pixels wide; 720p is plenty, and the cheapest. */
export const ANIMATION_RESOLUTION = "720p" as const;

/**
 * The largest clip the store keeps. A four-second 720p MP4 is one to three
 * megabytes; anything past this is not the clip that was asked for, and the
 * `word-animations` bucket refuses it as well (its `file_size_limit`).
 */
export const MAX_ANIMATION_BYTES = 8 * 1024 * 1024;

// ── Which words qualify ─────────────────────────────────────────────────────

/**
 * A curriculum category that names a verb.
 *
 * The tracks do not spell it one way: "Verb", "Verb — routine",
 * "Verb — daily routine", "Verb — past", "Verb — meals", "Verb — shopping",
 * "Verb — café", "Verb — command", "Verb — bargaining". So the rule is the
 * category's head, the part before a dash: exactly "verb". That keeps out the
 * categories that merely contain the letters ("Adverb") and the verb-shaped
 * ones that are not actions: "Verb phrase" ("I'm full", "I don't want"),
 * "Verb frame" (كان هـ "would"), "Pseudo-verb", "Modal", "Participle".
 */
export function isVerbCategory(category: string | null | undefined): boolean {
  const head = (category ?? "").split(/\s+[—–-]\s+/)[0].trim().toLowerCase();
  return head === "verb";
}

/**
 * Nouns that name an action, keyed on their action exactly as
 * `animationConcept` folds their gloss. The tracks' few, each because the
 * motion is the meaning: a learner shown a still of a road cannot tell
 * "traffic" from "road", and can from cars crawling bumper to bumper.
 * The content team adds to it; a noun that is a thing (a car, a cup) belongs
 * with pictures, not here.
 */
export const ACTION_NOUNS: ReadonlySet<string> = new Set([
  // زحمة (Gulf, Egyptian, Yemeni Stage 3)
  "traffic / crowd",
  "traffic / crowding",
  // رحلة, مشوار, كشتة (Gulf and Yemeni Stages 2–3): going somewhere is the word.
  "trip",
  "errand / short trip",
  "errand / trip out",
  "desert outing / picnic trip",
]);

/**
 * Whether a word gets an animation: its gloss keys an action, and it is a verb
 * by its category or an action noun by that action.
 *
 * Only a curriculum word can say: `vocabulary_words.category` is authored.
 * A learner's saved word carries no part of speech (`user_vocabulary` has no
 * category, and its `tags` are the learner's own), so its gloss is the only
 * evidence, and an English gloss is exactly what cannot tell "a fly" from
 * "to fly" or "run (a business)" from "run" once a learner or a model wrote it
 * as "to run". Those words keep their pictures.
 */
export function qualifiesForAnimation(word: { category?: string | null; gloss: string | null | undefined }): boolean {
  const action = animationConcept(word.gloss);
  if (!action) return false;
  return isVerbCategory(word.category) || ACTION_NOUNS.has(action);
}

// ── How a clip is made ──────────────────────────────────────────────────────

/** Glosses arrive folded; the prompt still carries a short, quote-free copy. */
function promptSafe(text: string): string {
  return text.replace(/["“”]/g, "'").replace(/\s+/g, " ").trim().slice(0, 120);
}

/**
 * The frame a clip is drawn for: wide, with the action kept to the centre
 * square, since the quiz crops it to a square on the picture question.
 */
export const ANIMATION_FRAME_LINE = [
  "The frame is wide (16:9). The square the style speaks of is its centre: the figure and the",
  "action stay inside that centre square, with plain cream ground to either side.",
].join(" ");

/**
 * The poster: the still a clip starts and ends on, and the picture shown in
 * its place to a learner who asked for reduced motion. Drawn in the Ink
 * picture style, from the action alone.
 */
export function inkAnimationPosterPrompt(action: string): string {
  const safe = promptSafe(action);
  return [
    `A picture of the action "${safe}", caught at the one moment that shows it best, so that it`,
    "could not be taken for any other action. The pose is balanced, a natural start for the action",
    "and the pose it comes back to.",
    INK_PICTURE_STYLE,
    ANIMATION_FRAME_LINE,
    NEUTRAL_FIGURE_LINE,
  ].join("\n");
}

/** The clip, animated from the poster as its first and its last frame. */
export function inkAnimationPrompt(action: string): string {
  const safe = promptSafe(action);
  return [
    `Animate this picture: the figure performs the action "${safe}" once, clearly enough that`,
    `someone watching knows at once that the action is "${safe}".`,
    INK_ANIMATION_STYLE,
    NEUTRAL_FIGURE_LINE,
  ].join("\n");
}

// ── What a filed one is ─────────────────────────────────────────────────────

/** What an animation's row carries beyond its clip url. */
export interface AnimationPayload {
  /** The still the clip starts and ends on. */
  poster: string;
  seconds: number;
  aspect: string;
}

/** An animation as the quiz shows it. */
export interface StoredAnimation {
  /** The looping clip (MP4). */
  clip: string;
  /** Its first frame, shown before it plays and instead of it under reduced motion. */
  poster: string;
}

const isWebUrl = (value: unknown): value is string => typeof value === "string" && /^https?:\/\/\S+$/.test(value);

/**
 * A filed animation as the quiz shows it, or null when it is not one: a clip
 * with no poster would leave a learner who asked for reduced motion with
 * nothing to look at, so it is not served.
 */
export function asStoredAnimation(asset: { url: string | null; payload: unknown } | null): StoredAnimation | null {
  if (!asset || !isWebUrl(asset.url)) return null;
  const payload = asset.payload as Partial<AnimationPayload> | null;
  if (!payload || typeof payload !== "object" || !isWebUrl(payload.poster)) return null;
  return { clip: asset.url, poster: payload.poster };
}
