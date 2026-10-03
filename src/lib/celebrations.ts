import type { DialectModule } from "@/contexts/DialectContext";
import { localDateKey, parseLocalDate } from "@/lib/localDate";

/**
 * Celebration screens — the full-screen "you did it" moment, Hikaya's answer
 * to Duolingo's lesson-complete owl.
 *
 * Where Duolingo shows its mascot, we show a dancer: a short watercolor clip
 * of a traditional dance from the region whose dialect the learner is
 * studying. It plays for a few seconds and then holds on its last frame. The
 * clips rotate, so finishing ten lessons in Gulf Arabic walks a learner past
 * the Ardah, the Ayyala, the Razha and the rest, and the caption under each
 * names the dance and says where it comes from. A reward screen they were
 * going to see anyway becomes a small piece of the culture the dialect lives in.
 *
 * Everything here is pure or touches only localStorage: which scene comes
 * next, which cheer to show, what the screen says for each kind of moment, and
 * the two "has this already been celebrated" rules (daily goal, streak). The
 * overlay is `CelebrationHost`; pages fire a moment with `celebrate()`.
 *
 * The clips were generated with Higgsfield (GPT Image 2.5 stills with the
 * app's own campfire and dialect art as style references, animated with
 * Kling 3.0) — see docs/celebrations.md for the prompts, the research behind
 * each costume and step, and how to add a dance.
 */

export type CelebrationKind = "lesson" | "deck" | "goal" | "streak" | "achievement";

export interface CelebrationEvent {
  kind: CelebrationKind;
  /**
   * What was achieved, when there is something to name: the lesson's title,
   * the badge's name, the streak length, how many cards were reviewed.
   */
  detail?: string | number;
}

export interface DanceScene {
  /** Asset basename under /assets/celebrations/. */
  id: string;
  dialect: DialectModule;
  nameAr: string;
  nameEn: string;
  /** Where it is danced, as a learner would recognise it. */
  region: string;
  /** One line of culture, shown under the clip. */
  blurb: string;
}

/**
 * The dances, grouped by the dialect whose celebrations they rotate through.
 * Order is rotation order, alternating men's and women's dances where a
 * dialect has both so two in a row rarely look alike.
 *
 * Every women's scene shows hair covered — a deliberate choice, made with the
 * product owner, over the Khaleeji hair-toss as danced at women-only weddings.
 */
export const DANCE_SCENES: readonly DanceScene[] = [
  // ── Gulf ────────────────────────────────────────────────────────────────
  {
    id: "gulf-ardah",
    dialect: "Gulf",
    nameAr: "العرضة",
    nameEn: "Al-Ardah",
    region: "Najd, Saudi Arabia",
    blurb:
      "Swords, drums and chanted poetry. The Ardah opens Saudi celebrations and has been on UNESCO's heritage list since 2015.",
  },
  {
    id: "gulf-khaleeji-women",
    dialect: "Gulf",
    nameAr: "الرقص الخليجي",
    nameEn: "Khaleeji dance",
    region: "Across the Gulf",
    blurb:
      "At weddings women dance in the thobe al-nashl, a sheer, gold-embroidered overdress held out so it fans and ripples with every step.",
  },
  {
    id: "gulf-ayyala",
    dialect: "Gulf",
    nameAr: "العيالة",
    nameEn: "Al-Ayyala",
    region: "United Arab Emirates",
    blurb:
      "Two rows of men with thin bamboo canes sway to the drum in a mock battle. UNESCO-listed since 2014.",
  },
  {
    id: "gulf-razha",
    dialect: "Gulf",
    nameAr: "الرزحة",
    nameEn: "Al-Razha",
    region: "Oman",
    blurb:
      "Dancers leap, toss their swords into the air and catch them, while two rows trade lines of poetry. Once a call to arms, now a wedding favourite.",
  },
  {
    id: "gulf-omani-women",
    dialect: "Gulf",
    nameAr: "فنون عُمانية",
    nameEn: "Omani funūn",
    region: "Northern Oman",
    blurb:
      "Omanis name more than two dozen “arts” of song and dance. At a wedding, women circle the frame drummers, clapping and singing as they dance.",
  },
  {
    id: "gulf-mizmar",
    dialect: "Gulf",
    nameAr: "المزمار",
    nameEn: "Al-Mizmar",
    region: "Hejaz, Saudi Arabia",
    blurb:
      "Men twirl long staffs to drums and clapping, sometimes around a fire. A Jeddah wedding staple, UNESCO-listed since 2016.",
  },
  // ── Yemeni ──────────────────────────────────────────────────────────────
  {
    id: "yemen-baraa",
    dialect: "Yemeni",
    nameAr: "البَرَع",
    nameEn: "Al-Bara'a",
    region: "Sana'a, Yemen",
    blurb:
      "Yemen's jambiya dance: dancers step and turn as one to the drum, daggers raised. It began as training for battle and became the sound of every wedding and Eid.",
  },
  {
    id: "yemen-sanaani-women",
    dialect: "Yemeni",
    nameAr: "الرقص الصنعاني",
    nameEn: "Sana'ani dance",
    region: "Sana'a, Yemen",
    blurb:
      "Women dance it at Sana'a weddings in glittering gowns and gold headdresses, with sprigs of basil tucked by the ear.",
  },
  {
    id: "yemen-baraa-haraz",
    dialect: "Yemeni",
    nameAr: "برع حراز",
    nameEn: "Bara'a of Haraz",
    region: "Haraz mountains, Yemen",
    blurb:
      "Every village and tribe has its own Bara'a and its own song. In the Haraz mountains the line steps in unison along the terraces.",
  },
  {
    id: "yemen-zafeen",
    dialect: "Yemeni",
    nameAr: "الزَّفين",
    nameEn: "Al-Zafeen",
    region: "Hadhramaut, Yemen",
    blurb:
      "Light, quick footwork to small marwas drums and the oud. Hadhrami traders carried it as far as Malaysia and Indonesia, where it is danced as zapin.",
  },
  // ── Egyptian ────────────────────────────────────────────────────────────
  {
    id: "egypt-tahtib",
    dialect: "Egyptian",
    nameAr: "التحطيب",
    nameEn: "Tahtib",
    region: "Upper Egypt (Sa'id)",
    blurb:
      "A stick duel in which no blow may land. It is all skill, control and respect, it is drawn on pharaonic tomb walls, and it has been UNESCO-listed since 2016.",
  },
  {
    id: "egypt-assaya",
    dialect: "Egyptian",
    nameAr: "رقص العصاية",
    nameEn: "Raqs al-Assaya",
    region: "Upper Egypt (Sa'id)",
    blurb:
      "Women's answer to tahtib: a light cane, twirled, framed and balanced to the Sa'idi beat.",
  },
  {
    id: "egypt-tanoura",
    dialect: "Egyptian",
    nameAr: "التنورة",
    nameEn: "Tanoura",
    region: "Cairo",
    blurb:
      "A Sufi whirl in a skirt of many colours. The dancer spins for minutes without stopping while the layers flare like a kaleidoscope.",
  },
  {
    id: "egypt-nubian",
    dialect: "Egyptian",
    nameAr: "الكَفّ النوبي",
    nameEn: "Nubian kaff",
    region: "Aswan",
    blurb:
      "Clapping (kaff), the tar frame drum and the Nile. At a Nubian wedding the whole village dances together.",
  },
];

export function scenesFor(dialect: DialectModule): DanceScene[] {
  return DANCE_SCENES.filter((s) => s.dialect === dialect);
}

/** Where a scene's clip and still live. Mirrors LoopingMedallion's mp4 + webm + poster. */
export function sceneAssets(id: string) {
  const base = `/assets/celebrations/${id}`;
  return { mp4: `${base}.mp4`, webm: `${base}.webm`, poster: `${base}-poster.webp` };
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
    // Private mode or a full quota: the worst case is a repeated scene or a
    // second celebration of the same goal, neither worth an error.
  }
}

// ── Rotation ───────────────────────────────────────────────────────────────

export const ROTATION_KEY = "hakiya:celebration-rotation:v1";

/**
 * The next position in a rotation of `count` scenes. A learner with no history
 * starts at a random scene, so two people who start the same day don't see
 * the identical first dance; from then on it walks the list in order, so
 * every dance comes round before any repeats.
 */
export function nextSceneIndex(
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

/** Take the next scene for `dialect` and advance that dialect's rotation. */
export function takeNextScene(
  dialect: DialectModule,
  store: KeyValueStore | null = defaultStore(),
  random: () => number = Math.random,
): DanceScene {
  const scenes = scenesFor(dialect);
  const rotation = readJson<Partial<Record<DialectModule, number>>>(store, ROTATION_KEY) ?? {};
  const index = nextSceneIndex(rotation[dialect], scenes.length, random);
  writeJson(store, ROTATION_KEY, { ...rotation, [dialect]: index });
  return scenes[index];
}

// ── Cheers ─────────────────────────────────────────────────────────────────

export interface Cheer {
  ar: string;
  translit: string;
  en: string;
}

/**
 * What the screen shouts, in the learner's dialect — never فصحى. Each is an
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
  }
}

/**
 * The one-line form of a moment, for when a second one lands while the
 * screen is already up — two badges from one card, a lesson that also
 * finishes the day. They join the open screen as lines rather than queueing
 * a second dance behind the first.
 */
export function celebrationSummary(event: CelebrationEvent): string {
  const { title, subtitle } = celebrationCopy(event);
  return event.kind === "achievement" || event.kind === "lesson" ? `${title} ${subtitle}` : title;
}

// ── Daily goal: once a day ─────────────────────────────────────────────────

export const GOAL_KEY = "hakiya:celebrated-goal:v1";

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
export const STREAK_KEY = "hakiya:celebrated-streak:v1";

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

// ── The bus ────────────────────────────────────────────────────────────────

type Listener = (event: CelebrationEvent) => void;
const listeners = new Set<Listener>();

/**
 * Fire a celebration from anywhere — a page, a hook's onSuccess. The mounted
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
