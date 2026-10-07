import type { DialectModule } from "@/contexts/DialectContext";
import type { CelebrationKind, Cheer } from "@/lib/celebrations";
import type { DanceDefinition, SceneEffect } from "@/lib/dances";

/**
 * The milestone vignettes: small collage scenes that sit beside the dances.
 *
 * A dance says "here is a tradition from the region you are learning"; a
 * vignette says the same thing with a meal, a ritual or a landmark, and picks
 * a picture that suits the moment: a pearl for a badge, a football goal for
 * the day's goal, a reed pen for a letter, and for a streak, a fire that
 * grows with the days. They are drawn exactly like the dances (grayscale
 * cutouts with a paper edge on mustard paper; `@/lib/dances` and
 * docs/celebrations.md describe the look) and the stage plays them through the
 * same `poseAt`, so a vignette *is* a `DanceDefinition` that happens to set
 * the optional scene fields (`about`, `effects`, `heat`, `cheers`).
 *
 * Unlike the dances, nothing here is timed from footage. There is no
 * reference video of a grill being turned, so every beat below is a chosen
 * number, named and explained where it is set, and docs/celebrations-vignettes.md
 * lists what a native reviewer still has to check.
 *
 * Where a vignette plays is `takeScene` in `@/lib/celebrations`.
 */

/** A rung of a streak ladder: what the picture shows from this many days on. */
export interface LadderRung {
  /** The first streak length that plays this rung. */
  fromDays: number;
  /** Which of the figure's stills it shows, in order (`DanceDefinition.sequence`). */
  sequence: readonly number[];
  /** How strong the flames and smoke are, 1 to 5. */
  heat: number;
  /** What the picture says, in English. Used by the tests and the docs. */
  says: string;
  /**
   * What is drawn over it, when that is not the ladder's own. The fire is lit
   * only while there is a grill: once the food is off it, the steam rises from
   * the dishes and the sparkle is the party.
   */
  effects?: readonly SceneEffect[];
  /** Where those effects rise from, when not where the fire is. */
  fxAnchor?: { x: number; y: number };
  /** What the stage shouts on this rung; unset, a cheer from the dialect's list. */
  cheer?: Cheer;
}

export interface VignetteDefinition extends DanceDefinition {
  /**
   * Whose learners see it. `dialect` (the frame's architecture, the paper's
   * print) is the first of these until a learner is known; `forDialect` makes
   * the copy that is played.
   */
  dialects: readonly DialectModule[];
  /**
   * The moments it suits. `streak` belongs to the ladders alone; every other
   * moment alternates a matching vignette with the dance rotation.
   */
  moments: readonly CelebrationKind[];
  /** What differs for a dialect when one vignette serves several (the football's name). */
  localized?: Partial<
    Record<DialectModule, Partial<Pick<DanceDefinition, "title" | "gloss" | "region" | "about" | "cheers">>>
  >;
  /** A streak ladder's rungs, lowest first. Unset for every other vignette. */
  ladder?: readonly LadderRung[];
}

// ── Timing: chosen, not measured ───────────────────────────────────────────

/** A pose of the figure holds for this long. A grill's turn, a pour, a lid lifting: unhurried. */
export const VIGNETTE_BEAT_MS = 600;
/** The grill ladder turns a little faster: a sizzle, not a stroll. */
export const LADDER_BEAT_MS = 500;
/** The cook's fan changes every quarter second: one stroke each way, four a second. */
export const FAN_STROKE_MS = 250;
/** The helper in the one-offs (a guest's cup, a trilling woman) changes at half a beat. */
export const HELPER_STROKE_MS = VIGNETTE_BEAT_MS / 2;

const repeat = (pose: number, times: number) => Array<number>(times).fill(pose);

// ── Cheers (drafts: a native reviewer signs each off) ──────────────────────

const cheer = (ar: string, translit: string, en: string): Cheer => ({ ar, translit, en });

const FIRE_CAUGHT = {
  Gulf: cheer("شبّت النار!", "Shabbat an-nār!", "The fire's caught!"),
  Egyptian: cheer("النار ولّعت!", "An-nār wallaʿit!", "The fire's caught!"),
} as const;
const BLESS_HANDS = {
  Gulf: cheer("تسلم الأيادي!", "Tislam al-ayādi!", "Blessings on the hands!"),
  Egyptian: cheer("تسلم الأيادي!", "Tislam il-ayādi!", "Blessings on the hands!"),
} as const;
const TO_YOUR_HEALTH = {
  Gulf: cheer("ألف عافية!", "Alf ʿāfiya!", "A thousand blessings of health!"),
  Egyptian: cheer("بالهنا والشفا!", "Bil-hana wish-shifa!", "Eat and be well!"),
  Yemeni: cheer("بالعافية!", "Bil-ʿāfiya!", "To your health!"),
} as const;

// ── The streak ladders ─────────────────────────────────────────────────────

/**
 * The same story in every dialect: the figure's six stills are, in order, the
 * empty grill with its coals, the raw meat on it, the meat seared, the
 * platter, the table, and the whole roast lamb. The rungs walk up them.
 */
const COALS = 0;
const RAW = 1;
const SEARED = 2;
const PLATTER = 3;
const SPREAD = 4;
const LAMB = 5;

/** Steam from the dishes and a sparkle over the table, once the grill is gone. */
const FEAST_FX = { effects: ["steam", "sparkle"], fxAnchor: { x: 50, y: 66 } } as const;

function ladder(cheers: { [days: number]: Cheer | undefined }): readonly LadderRung[] {
  const rungs: Omit<LadderRung, "cheer">[] = [
    { fromDays: 3, sequence: [COALS], heat: 1, says: "The coals catch." },
    { fromDays: 7, sequence: [RAW], heat: 2, says: "The first meat goes on." },
    { fromDays: 14, sequence: [...repeat(RAW, 2), ...repeat(SEARED, 2)], heat: 3, says: "Sizzle and smoke." },
    { fromDays: 30, sequence: [SEARED], heat: 3, says: "Seared, and turned." },
    { fromDays: 100, sequence: [PLATTER, SPREAD, SPREAD], heat: 4, says: "Off the fire: the platter, then the table.", ...FEAST_FX },
    { fromDays: 365, sequence: [SPREAD, LAMB, LAMB], heat: 5, says: "A feast for a whole year.", ...FEAST_FX },
    { fromDays: 1000, sequence: [LAMB, LAMB, SPREAD], heat: 5, says: "The whole street is fed.", ...FEAST_FX },
  ];
  return rungs.map((r) => (cheers[r.fromDays] ? { ...r, cheer: cheers[r.fromDays] } : r));
}

/** The flames rise from the coals, which sit about halfway down the grill's box. */
const LADDER_FX = { x: 52, y: 50 } as const;

const ladderBase = {
  beatMs: LADDER_BEAT_MS,
  musicianMs: FAN_STROKE_MS,
  swayDeg: 0,
  swayPeriodMs: 0,
  bobPct: 0,
  bobPeriodMs: 0,
  // Cook with the fan raised, then swung forward.
  musicianSequence: [0, 1],
  pumpOnHold: false,
  effects: ["fire", "smoke"],
  fxAnchor: LADDER_FX,
  moments: ["streak"],
} as const;

export const MISHKAK: VignetteDefinition = {
  ...ladderBase,
  id: "mishkak",
  dialect: "Gulf",
  dialects: ["Gulf"],
  title: "المشاكيك",
  gloss: "Mishkak",
  region: "Saudi Arabia and the Gulf",
  about: "a street grill from Saudi Arabia and the Gulf",
  // 0 coals · 1 raw skewers · 2 seared, mid-turn · 3 platter · 4 the sofra · 5 whole lamb on mandi rice
  sequence: [COALS],
  ladder: ladder({ 3: FIRE_CAUGHT.Gulf, 30: BLESS_HANDS.Gulf, 100: TO_YOUR_HEALTH.Gulf }),
};

export const KABABGI: VignetteDefinition = {
  ...ladderBase,
  id: "kababgi",
  dialect: "Egyptian",
  dialects: ["Egyptian"],
  title: "الكبابجي",
  gloss: "Al-Kababgi",
  region: "Cairo, Egypt",
  about: "a grill house from Cairo, Egypt",
  sequence: [COALS],
  ladder: ladder({ 3: FIRE_CAUGHT.Egyptian, 30: BLESS_HANDS.Egyptian, 100: TO_YOUR_HEALTH.Egyptian }),
};

export const MADHBI: VignetteDefinition = {
  ...ladderBase,
  id: "madhbi",
  dialect: "Yemeni",
  dialects: ["Yemeni"],
  title: "المضبي",
  gloss: "Al-Madhbi",
  region: "Yemen",
  about: "a hot-stone grill from Yemen",
  sequence: [COALS],
  ladder: ladder({ 100: TO_YOUR_HEALTH.Yemeni }),
};

// ── The one-offs ───────────────────────────────────────────────────────────

const oneOff = {
  beatMs: VIGNETTE_BEAT_MS,
  musicianMs: HELPER_STROKE_MS,
  swayDeg: 0,
  swayPeriodMs: 0,
  bobPct: 0,
  bobPeriodMs: 0,
  pumpOnHold: false,
} as const;

/** A host pours; the guest holds a cup out and, at the end, shakes it to say "enough". */
export const DALLAH: VignetteDefinition = {
  ...oneOff,
  id: "dallah",
  dialect: "Gulf",
  dialects: ["Gulf"],
  moments: ["goal"],
  title: "الدلة",
  gloss: "Al-Dallah",
  region: "Saudi Arabia and the Gulf",
  about: "the coffee ritual from Saudi Arabia and the Gulf",
  effects: ["steam"],
  heat: 2,
  // The steam curls up from the dallah's spout, held at the host's hip.
  fxAnchor: { x: 36, y: 56 },
  // 0 standing, dallah low · 1 dallah raised, cup held out to catch it · 2 offering the cup
  sequence: [0, 0, 1, 1, 2, 2, 1, 1, 0, 0],
  // 0 cup held out, steady · 1 cup rocked: the shake that means "enough, thank you"
  musicianSequence: [...repeat(0, 8), 1, 0, 1, 0],
  cheers: [cheer("هلا والله!", "Halā wallāh!", "Welcome!"), TO_YOUR_HEALTH.Gulf],
};

export const LULU: VignetteDefinition = {
  ...oneOff,
  id: "lulu",
  dialect: "Gulf",
  dialects: ["Gulf"],
  moments: ["achievement"],
  title: "اللولو",
  gloss: "Al-Lulu",
  region: "Bahrain and the Gulf",
  about: "a pearl dive from Bahrain and the Gulf",
  effects: ["sparkle"],
  heat: 3,
  // 0 the shell closed · 1 half open · 2 open, the pearl in it
  sequence: [0, 1, 2, 2, 2],
  musicianSequence: [],
  cheers: [cheer("طلع اللولو!", "Ṭilaʿ al-lūlu!", "The pearl's come up!")],
};

export const LUQAIMAT: VignetteDefinition = {
  ...oneOff,
  id: "luqaimat",
  dialect: "Gulf",
  dialects: ["Gulf"],
  moments: ["deck"],
  title: "لقيمات",
  gloss: "Luqaimat",
  region: "the Gulf",
  about: "a sweet from the Gulf",
  effects: ["steam", "sparkle"],
  heat: 2,
  fxAnchor: { x: 50, y: 56 },
  // 0 frying · 1 the plate heaped · 2 glazed with date syrup
  sequence: [0, 0, 1, 2, 2],
  musicianSequence: [],
  cheers: [TO_YOUR_HEALTH.Gulf],
};

export const BAKHOOR: VignetteDefinition = {
  ...oneOff,
  id: "bakhoor",
  dialect: "Gulf",
  dialects: ["Gulf"],
  moments: ["lesson"],
  title: "البخور",
  gloss: "Al-Bakhoor",
  region: "the Gulf",
  about: "a welcome with incense from the Gulf",
  effects: ["smoke"],
  heat: 3,
  // The smoke rises from the burner, held out in front of his chest.
  fxAnchor: { x: 66, y: 44 },
  // 0 the burner low · 1 held out · 2 swept to the side
  sequence: [0, 1, 2, 1, 2],
  musicianSequence: [],
  cheers: [cheer("هلا والله!", "Halā wallāh!", "Welcome!")],
};

export const ZAFFA: VignetteDefinition = {
  ...oneOff,
  id: "zaffa",
  dialect: "Egyptian",
  dialects: ["Egyptian"],
  moments: ["lesson"],
  // Drums land faster than a pour: the procession keeps a quick pulse.
  beatMs: 400,
  title: "الزفة",
  gloss: "Al-Zaffa",
  region: "Egypt",
  about: "a wedding procession from Egypt",
  effects: ["sparkle"],
  heat: 3,
  // 0 sticks up · 1 sticks down on the drums · 2 right arms up, hips swung
  sequence: [0, 1, 0, 2, 0, 1, 0, 2],
  // 0 one hand fluttering by the mouth · 1 both hands up
  musicianSequence: [0, 0, 1, 0, 1, 1],
  cheers: [cheer("زغروطة!", "Zaghrouta!", "A trill of joy!"), cheer("ألف مبروك!", "Alf mabrūk!", "A thousand congratulations!")],
};

export const FANOUS: VignetteDefinition = {
  ...oneOff,
  id: "fanous",
  dialect: "Egyptian",
  dialects: ["Egyptian"],
  moments: ["achievement"],
  title: "الفانوس",
  gloss: "Al-Fanous",
  region: "Cairo, Egypt",
  about: "a lantern from Cairo, Egypt",
  effects: ["sparkle"],
  heat: 3,
  // 0 unlit · 1 lit · 2 three lit
  sequence: [0, 1, 2, 2, 2],
  musicianSequence: [],
  cheers: [cheer("الله ينور!", "Allāh yinawwar!", "How bright!")],
};

export const HONEY: VignetteDefinition = {
  ...oneOff,
  id: "honey",
  dialect: "Yemeni",
  dialects: ["Yemeni"],
  moments: ["deck"],
  title: "عسل دوعني",
  gloss: "Do'ani Honey",
  region: "Hadramawt, Yemen",
  about: "a honey harvest from Hadramawt, Yemen",
  effects: ["sparkle"],
  heat: 2,
  // 0 the comb with its bees · 1 the dipper, a thread of honey · 2 the full jar
  sequence: [0, 1, 2, 2, 2],
  musicianSequence: [],
  cheers: [cheer("والله حالي!", "Wallāh ḥālī!", "That's lovely!")],
};

export const BUNN: VignetteDefinition = {
  ...oneOff,
  id: "bunn",
  dialect: "Yemeni",
  dialects: ["Yemeni"],
  moments: ["goal"],
  title: "البن",
  gloss: "Al-Bunn",
  region: "Yemen",
  about: "a coffee roast from Yemen",
  effects: ["steam"],
  heat: 2,
  // 0 green beans · 1 roasted beans · 2 the jabana pot and cups
  sequence: [0, 0, 1, 1, 2, 2, 2, 2, 2],
  musicianSequence: [],
  cheers: [TO_YOUR_HEALTH.Yemeni],
};

export const SHIBAM: VignetteDefinition = {
  ...oneOff,
  id: "shibam",
  dialect: "Yemeni",
  dialects: ["Yemeni"],
  moments: ["achievement"],
  title: "شبام",
  gloss: "Shibam",
  region: "Hadramawt, Yemen",
  about: "a tower city from Hadramawt, Yemen",
  effects: ["sparkle"],
  heat: 2,
  // 0 one house · 1 a tall tower · 2 the cluster
  sequence: [0, 1, 2, 2, 2],
  musicianSequence: [],
};

/** The daily goal is a goal: the Gulf says «قول», Cairo says «جون», and both are the commentator's roar. */
export const FOOTBALL: VignetteDefinition = {
  ...oneOff,
  id: "football",
  dialect: "Gulf",
  dialects: ["Gulf", "Egyptian"],
  moments: ["goal"],
  beatMs: 500,
  title: "القول",
  gloss: "Al-Gōl",
  region: "the football pitch",
  about: "a goal, as the commentators call it in the Gulf",
  effects: ["sparkle"],
  heat: 4,
  // 0 the kick · 1 the ball in the net · 2 the celebration
  sequence: [0, 1, 2, 2],
  musicianSequence: [],
  cheers: [cheer("قوووول!", "Gōōōl!", "Goal!")],
  localized: {
    Egyptian: {
      title: "الجون",
      gloss: "Al-Gōn",
      about: "a goal, as the commentators call it in Egypt",
      cheers: [cheer("جوووون!", "Gōōōn!", "Goal!")],
    },
  },
};

export const QALAM: VignetteDefinition = {
  ...oneOff,
  id: "qalam",
  dialect: "Gulf",
  dialects: ["Gulf", "Egyptian", "Yemeni"],
  moments: ["letter"],
  title: "القلم",
  gloss: "Al-Qalam",
  region: "Arabic calligraphy",
  about: "a reed pen from the tradition of Arabic calligraphy",
  effects: ["ink"],
  heat: 2,
  // 0 the pen in its well · 1 lifted, a bead of ink on the nib · 2 laid on the paper
  sequence: [0, 1, 2, 1, 2],
  musicianSequence: [],
};

/** Every vignette, in the order the rotation walks them within a moment. */
export const VIGNETTES: readonly VignetteDefinition[] = [
  MISHKAK,
  KABABGI,
  MADHBI,
  DALLAH,
  FOOTBALL,
  LULU,
  LUQAIMAT,
  BAKHOOR,
  ZAFFA,
  FANOUS,
  HONEY,
  BUNN,
  SHIBAM,
  QALAM,
];

export function vignetteById(id: string): VignetteDefinition | null {
  return VIGNETTES.find((v) => v.id === id) ?? null;
}

/** The vignettes that suit `moment` for `dialect`, ladders excluded. */
export function vignettesFor(dialect: DialectModule, moment: CelebrationKind): VignetteDefinition[] {
  return VIGNETTES.filter((v) => !v.ladder && v.dialects.includes(dialect) && v.moments.includes(moment));
}

/** The dialect's streak ladder. Every dialect has one, so a streak always has a picture. */
export function ladderFor(dialect: DialectModule): VignetteDefinition | null {
  return VIGNETTES.find((v) => v.ladder && v.dialects.includes(dialect)) ?? null;
}

/**
 * The rung that plays at `days`: the highest whose `fromDays` has been
 * reached, or the lowest for a streak shorter than the first. The milestones
 * 50, 150, 200 and 500 fall between rungs, so they play the rung below with
 * one more heat (a bigger fire for a longer run), up to 5.
 */
export function rungFor(
  ladderRungs: readonly LadderRung[],
  days: number,
): { rung: LadderRung; heat: number } {
  let rung = ladderRungs[0];
  for (const candidate of ladderRungs) if (days >= candidate.fromDays) rung = candidate;
  const between = days > rung.fromDays && rung !== ladderRungs[ladderRungs.length - 1];
  return { rung, heat: Math.min(5, rung.heat + (between ? 1 : 0)) };
}

/**
 * The scene to play for one learner: a vignette made for several dialects
 * takes the learner's (its frame and paper follow them, and where the name
 * differs it takes that dialect's).
 */
export function forDialect(vignette: VignetteDefinition, dialect: DialectModule): VignetteDefinition {
  const local = vignette.localized?.[dialect];
  return { ...vignette, ...local, dialect: vignette.dialects.includes(dialect) ? dialect : vignette.dialect };
}

/**
 * The scene a learner sees: `forDialect`, and for a ladder the rung their
 * streak has reached. A streak that has not reached the first rung plays the
 * first, so a ladder never opens on an empty stage.
 */
export function resolveVignette(
  vignette: VignetteDefinition,
  dialect: DialectModule,
  days?: number,
): VignetteDefinition {
  const scene = forDialect(vignette, dialect);
  if (!scene.ladder) return scene;
  const { rung, heat } = rungFor(scene.ladder, days ?? scene.ladder[0].fromDays);
  return {
    ...scene,
    sequence: rung.sequence,
    heat,
    effects: rung.effects ?? scene.effects,
    fxAnchor: rung.fxAnchor ?? scene.fxAnchor,
    cheers: rung.cheer ? [rung.cheer] : undefined,
  };
}
