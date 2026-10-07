import type { DialectModule } from "@/contexts/DialectContext";
import { localDateKey, parseLocalDate } from "@/lib/localDate";
import { danceById, dancesFor, type DanceDefinition } from "@/lib/dances";
import { ladderFor, resolveVignette, vignetteById, vignettesFor } from "@/lib/vignettes";

/**
 * Celebration screens: the full-screen "you did it" moment, Hikaya's answer
 * to Duolingo's lesson-complete owl.
 *
 * Where Duolingo shows its mascot, we show dancers: a few seconds of a
 * traditional dance from the region whose dialect the learner is studying,
 * as a cut-paper collage (the dances and their timing are `@/lib/dances`).
 * The dances rotate, so finishing lessons in Gulf Arabic walks a learner
 * past each Gulf dance in turn, and the caption names the dance and where it
 * comes from. A reward screen they were going to see anyway becomes a small
 * piece of the culture the dialect lives in. Beside the dances sit the
 * vignettes (`@/lib/vignettes`): a meal, a ritual or a landmark in the same
 * collage, one of which suits a moment (a pearl for a badge) and takes every
 * other turn, and a streak milestone's own picture, a grill whose fire grows
 * with the days. `takeScene` chooses between them.
 *
 * Everything here is pure or touches only localStorage: how long each moment
 * plays, which scene comes next, which cheer to show, what the screen says
 * for each kind of moment, and the two "has this already been celebrated"
 * rules (daily goal, streak). The overlay is `CelebrationHost`; pages fire a
 * moment with `celebrate()`.
 */

export type CelebrationKind = "lesson" | "letter" | "deck" | "goal" | "streak" | "achievement" | "preview";

export interface CelebrationEvent {
  kind: CelebrationKind;
  /**
   * What was achieved, when there is something to name: the lesson's title,
   * the letter, the badge's name, the streak length, how many cards were
   * reviewed.
   */
  detail?: string | number;
  /**
   * Play this dance (or vignette) rather than the next in the rotation (the
   * preview link).
   */
  danceId?: string;
  /** Play at this tier rather than the kind's own. */
  tier?: CelebrationTier;
  /** A previewed streak ladder plays the rung for this many days. */
  days?: number;
}

// ── Tiers ──────────────────────────────────────────────────────────────────

export type CelebrationTier = "small" | "medium" | "large";

/** How long each tier plays before it dismisses itself. */
export const TIER_DURATION_MS: Record<CelebrationTier, number> = {
  small: 1500,
  medium: 3000,
  large: 6000,
};

/**
 * How big each moment is. The everyday wins (a lesson, a letter, a cleared
 * deck, a badge) play the three-second scene; the day's goal and a streak
 * milestone play the full six.
 */
export const KIND_TIER: Record<CelebrationKind, CelebrationTier> = {
  lesson: "medium",
  letter: "medium",
  deck: "medium",
  achievement: "medium",
  goal: "large",
  streak: "large",
  preview: "medium",
};

export function tierFor(event: CelebrationEvent): CelebrationTier {
  return event.tier ?? KIND_TIER[event.kind];
}

const TIER_ORDER: readonly CelebrationTier[] = ["small", "medium", "large"];

/** The bigger of two tiers: a screen that gains a bigger moment plays its length. */
export function largerTier(a: CelebrationTier, b: CelebrationTier): CelebrationTier {
  return TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b;
}

// ── Storage ────────────────────────────────────────────────────────────────

/** The slice of Storage these helpers use, so tests can hand in a plain object. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readJson<T>(store: KeyValueStore | null, key: string): T | null {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(store: KeyValueStore | null, key: string, value: unknown) {
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or a full quota: the worst case is a repeated dance or a
    // second celebration of the same goal, neither worth an error.
  }
}

// ── Rotation ───────────────────────────────────────────────────────────────

export const ROTATION_KEY = "hikaya:celebration-rotation:v1";

/**
 * The next position in a rotation of `count` dances. A learner with no
 * history starts at a random dance, so two people who start the same day
 * don't see the identical first dance; from then on it walks the list in
 * order, so every dance comes round before any repeats.
 */
export function nextDanceIndex(
  cursor: number | null | undefined,
  count: number,
  random: () => number = Math.random,
): number {
  if (count <= 0) return 0;
  if (cursor == null || !Number.isInteger(cursor) || cursor < 0) {
    return Math.min(count - 1, Math.floor(random() * count));
  }
  return (cursor + 1) % count;
}

/**
 * Take the next dance for `dialect` and advance that dialect's rotation.
 * Null while the dialect has no dance drawn yet.
 */
export function takeNextDance(
  dialect: DialectModule,
  store: KeyValueStore | null = defaultStore(),
  random: () => number = Math.random,
): DanceDefinition | null {
  const dances = dancesFor(dialect);
  if (dances.length === 0) return null;
  const rotation = readJson<Partial<Record<DialectModule, number>>>(store, ROTATION_KEY) ?? {};
  const index = nextDanceIndex(rotation[dialect], dances.length, random);
  writeJson(store, ROTATION_KEY, { ...rotation, [dialect]: index });
  return dances[index];
}

// ── Which scene: a dance, or a vignette that suits the moment ──────────────

export const SCENE_KEY = "hikaya:celebration-scenes:v1";

/**
 * The scene for a moment.
 *
 * A streak milestone plays the dialect's ladder at the rung its length has
 * reached (`@/lib/vignettes`): the picture grows with the days, so it is
 * never the dance rotation's turn. Every other moment alternates the dance
 * rotation with the vignettes that suit it, a dance first, so a learner's
 * first lesson, badge or letter is still the dance they were promised and a
 * kind with no matching vignette is only ever a dance. The count lives per
 * dialect and per kind, so a badge's turn for a pearl does not move the
 * lesson's.
 */
export function takeScene(
  event: CelebrationEvent,
  dialect: DialectModule,
  store: KeyValueStore | null = defaultStore(),
  random: () => number = Math.random,
): DanceDefinition | null {
  if (event.kind === "streak") {
    const ladder = ladderFor(dialect);
    if (ladder) return resolveVignette(ladder, dialect, Number(event.detail) || undefined);
    return takeNextDance(dialect, store, random);
  }
  const matching = vignettesFor(dialect, event.kind);
  if (matching.length === 0) return takeNextDance(dialect, store, random);

  const counts = readJson<Record<string, number>>(store, SCENE_KEY) ?? {};
  const slot = `${dialect}:${event.kind}`;
  const turn = Number.isInteger(counts[slot]) && counts[slot] >= 0 ? counts[slot] : 0;
  writeJson(store, SCENE_KEY, { ...counts, [slot]: turn + 1 });
  if (turn % 2 === 0) return takeNextDance(dialect, store, random);
  return resolveVignette(matching[((turn - 1) / 2) % matching.length], dialect);
}

/**
 * The dance or vignette a preview link names, played for `dialect` (the
 * learner's own, when the vignette is made for it; a dance is always its
 * region's). Null for an id that matches nothing.
 */
export function previewScene(
  id: string,
  dialect: DialectModule,
  days?: number,
): { scene: DanceDefinition; dialect: DialectModule } | null {
  const dance = danceById(id);
  if (dance) return { scene: dance, dialect: dance.dialect };
  const vignette = vignetteById(id);
  if (!vignette) return null;
  const played = vignette.dialects.includes(dialect) ? dialect : vignette.dialect;
  return { scene: resolveVignette(vignette, played, days ?? 100), dialect: played };
}

// ── Cheers ─────────────────────────────────────────────────────────────────

export interface Cheer {
  ar: string;
  translit: string;
  en: string;
}

/**
 * What the screen shouts, in the learner's dialect, never فصحى. Each is an
 * exclamation rather than an address, so none of them has to guess whether
 * the learner is a man or a woman (عليك / عليكي, عساك / عساچ). They are run
 * through the MSA-leak detector for their dialect in the tests.
 */
export const CHEERS: Record<DialectModule, readonly Cheer[]> = {
  Gulf: [
    { ar: "كفو!", translit: "Kafu!", en: "Well done!" },
    { ar: "ما شاء الله!", translit: "Mā shā' Allāh!", en: "Look at that!" },
    { ar: "شي يرفع الراس!", translit: "Shay yirfa' ar-rās!", en: "That makes us proud!" },
    { ar: "يا سلام!", translit: "Yā salām!", en: "How wonderful!" },
    { ar: "مبروك!", translit: "Mabrūk!", en: "Congratulations!" },
  ],
  Egyptian: [
    { ar: "برافو!", translit: "Brāvo!", en: "Bravo!" },
    { ar: "عاش!", translit: "'Āsh!", en: "Nice one!" },
    { ar: "جامد أوي!", translit: "Gāmid awi!", en: "That was awesome!" },
    { ar: "إيه الحلاوة دي!", translit: "Ēh il-ḥalāwa di!", en: "How sweet is that!" },
    { ar: "مبروك!", translit: "Mabrūk!", en: "Congratulations!" },
  ],
  Yemeni: [
    { ar: "ما شاء الله!", translit: "Mā shā' Allāh!", en: "Look at that!" },
    { ar: "والله حالي!", translit: "Wallāh ḥālī!", en: "That's lovely!" },
    { ar: "يا سلام!", translit: "Yā salām!", en: "How wonderful!" },
    { ar: "مبروك!", translit: "Mabrūk!", en: "Congratulations!" },
  ],
};

export function pickCheer(dialect: DialectModule, random: () => number = Math.random): Cheer {
  const cheers = CHEERS[dialect];
  return cheers[Math.min(cheers.length - 1, Math.floor(random() * cheers.length))];
}

/**
 * The cheer for a scene: the one it has to shout (a goal's «قوووول!», a
 * pearl's, a lit fire's), else one of the dialect's.
 */
export function pickSceneCheer(
  scene: DanceDefinition | null,
  dialect: DialectModule,
  random: () => number = Math.random,
): Cheer {
  const own = scene?.cheers;
  if (!own?.length) return pickCheer(dialect, random);
  return own[Math.min(own.length - 1, Math.floor(random() * own.length))];
}

// ── Copy ───────────────────────────────────────────────────────────────────

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** Headline and one-line subtitle for a moment. */
export function celebrationCopy(event: CelebrationEvent): { title: string; subtitle: string } {
  const { kind, detail } = event;
  switch (kind) {
    case "lesson":
      return {
        title: "Lesson complete!",
        subtitle: detail ? `You finished “${detail}”.` : "Another lesson behind you.",
      };
    case "letter":
      return {
        title: "Letter mastered!",
        subtitle: detail ? `${detail} is yours to read and write.` : "Another letter you can read and write.",
      };
    case "deck":
      return {
        title: "All caught up!",
        subtitle:
          typeof detail === "number" && detail > 0
            ? `${plural(detail, "card")} reviewed. Nothing left due.`
            : "Every card due today is done.",
      };
    case "goal":
      return {
        title: "Daily goal reached!",
        subtitle: "Everything on today's list is done. Come back tomorrow to keep your streak.",
      };
    case "streak": {
      const days = typeof detail === "number" ? detail : Number(detail) || 0;
      return {
        title: days > 0 ? `${days}-day streak!` : "Streak milestone!",
        subtitle: days > 0 ? `You've practised ${plural(days, "day")} in a row.` : "Keep the run going.",
      };
    }
    case "achievement":
      return {
        title: "Badge earned!",
        subtitle: detail ? String(detail) : "A new badge for your collection.",
      };
    case "preview":
      return { title: "Preview", subtitle: "How a celebration looks." };
  }
}

/**
 * The one-line form of a moment, for when a second one lands while the
 * screen is already up: two badges from one card, a lesson that also
 * finishes the day. They join the open screen as lines rather than queueing
 * a second dance behind the first.
 */
export function celebrationSummary(event: CelebrationEvent): string {
  const { title, subtitle } = celebrationCopy(event);
  return event.kind === "achievement" || event.kind === "lesson" || event.kind === "letter"
    ? `${title} ${subtitle}`
    : title;
}

// ── Daily goal: once a day ─────────────────────────────────────────────────

export const GOAL_KEY = "hikaya:celebrated-goal:v1";

/**
 * True the first time it is asked on a given local day, false after. The Today
 * page re-renders its "all done" state on every visit; the full screen should
 * only appear the first time.
 */
export function claimDailyGoalCelebration(
  today: string = localDateKey(),
  store: KeyValueStore | null = defaultStore(),
): boolean {
  if (readJson<string>(store, GOAL_KEY) === today) return false;
  writeJson(store, GOAL_KEY, today);
  return true;
}

// ── Streak milestones ──────────────────────────────────────────────────────

export const STREAK_MILESTONES: readonly number[] = [3, 7, 14, 30, 50, 100, 150, 200, 365, 500, 1000];
export const STREAK_KEY = "hikaya:celebrated-streak:v1";

export function isStreakMilestone(days: number): boolean {
  return STREAK_MILESTONES.includes(days);
}

export interface StreakMark {
  streak: number;
  date: string;
}

function daysBetween(from: string, to: string): number {
  return Math.round((parseLocalDate(to).getTime() - parseLocalDate(from).getTime()) / 86_400_000);
}

/**
 * Whether a streak of `current` days is a milestone that has not yet been
 * celebrated in *this* run.
 *
 * The streak row is read on every page, and a streak still reads 7 on the
 * morning after it reached 7 (until that day's review moves it on), so "is it
 * a milestone" alone would celebrate the same week twice. A milestone counts
 * as already celebrated when the last one shown was this same number, fewer
 * days ago than the run is long. A streak that broke and climbed back to 7
 * has to have taken at least 8 days, so it is celebrated again.
 */
export function shouldCelebrateStreak(
  current: number,
  last: StreakMark | null,
  today: string = localDateKey(),
): boolean {
  if (!isStreakMilestone(current)) return false;
  if (!last || last.streak !== current) return true;
  return daysBetween(last.date, today) >= current;
}

/**
 * Check `current` against what this device last celebrated for this learner,
 * recording it when it fires. Keyed per user so a shared device doesn't hand
 * one learner's milestone to another.
 */
export function claimStreakCelebration(
  userId: string,
  current: number,
  today: string = localDateKey(),
  store: KeyValueStore | null = defaultStore(),
): boolean {
  const marks = readJson<Record<string, StreakMark>>(store, STREAK_KEY) ?? {};
  if (!shouldCelebrateStreak(current, marks[userId] ?? null, today)) return false;
  writeJson(store, STREAK_KEY, { ...marks, [userId]: { streak: current, date: today } });
  return true;
}

// ── The preview link ───────────────────────────────────────────────────────

/**
 * `?celebrate=ardah` plays a dance on any page, so a scene can be reviewed
 * without earning the moment (a lesson only celebrates the first time it is
 * finished). A tier can follow: `?celebrate=ardah-large`. Medium when it
 * doesn't.
 */
export const CELEBRATE_PARAM = "celebrate";
/**
 * `?celebrate=mishkak&celebratedays=100` plays a streak ladder's rung for that
 * many days (a hundred when it is left off).
 */
export const CELEBRATE_DAYS_PARAM = "celebratedays";

export function parseCelebrateParam(
  search: string,
): { dance: DanceDefinition; tier: CelebrationTier; days?: number } | null {
  const params = new URLSearchParams(search);
  const raw = params.get(CELEBRATE_PARAM);
  if (!raw) return null;
  const [id, tierPart] = raw.trim().toLowerCase().split("-");
  const dance = danceById(id) ?? vignetteById(id);
  if (!dance) return null;
  const tier: CelebrationTier = tierPart === "small" || tierPart === "large" ? tierPart : "medium";
  const days = Number.parseInt(params.get(CELEBRATE_DAYS_PARAM) ?? "", 10);
  return days > 0 ? { dance, tier, days } : { dance, tier };
}

// ── The bus ────────────────────────────────────────────────────────────────

type Listener = (event: CelebrationEvent) => void;
const listeners = new Set<Listener>();

/**
 * Fire a celebration from anywhere: a page, a hook's onSuccess. The mounted
 * `CelebrationHost` shows it; with no host mounted (a unit test rendering one
 * page) it is a no-op, so callers never need to check.
 */
export function celebrate(event: CelebrationEvent): void {
  listeners.forEach((listener) => listener(event));
}

/** Used by `CelebrationHost`. Returns the unsubscribe. */
export function subscribeCelebrations(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
