/**
 * A cheap, deterministic "is this worth a model call?" filter for harvested
 * social text.
 *
 * The social harvester's cost and its quality problem are the same problem.
 * Its sources are news-weighted, news is written in MSA, and the askBrain
 * screen was being spent almost entirely on rejecting فصحى that could have
 * been recognised for free. This module is the free half.
 *
 * It does NOT reimplement dialect identification — `dialectMarkers.ts` already
 * does that, with audited three-tier lists and a density scale, and a second
 * marker vocabulary would drift from it. What this adds is the axis that
 * module has no reason to carry: **register**. Not "which dialect is this",
 * but "is anyone speaking here at all". Wire copy is third-person and nominal;
 * a person writing to their followers says أنا, عندي, ليك, يا جماعة.
 *
 * That axis is what actually separates a tweet from a headline. Measured on 97
 * tweets from a newspaper account, the dialect scorer's MSA list rejected 3 of
 * them — headlines are short, carry no MSA grammar markers, and simply have
 * nobody in them.
 *
 * The result is a *prefilter*, not a classifier. Any dialect evidence at all
 * buys a screening call, because a headline quoting someone in dialect is the
 * best thing a news account produces. What it refuses is text with no Arabic,
 * text too short to teach anything, and text in which nobody is speaking. The
 * second job is ranking (`colloquialScore`): source curation is what actually
 * keeps the pipeline off the wire — a newspaper account harvests a wall of
 * headlines whatever the prefilter does — and ranking is what makes a bounded
 * screening budget spend itself on the best of what came back.
 *
 * IO-free on purpose, so `src/test/socialPrescreen.test.ts` can exercise it.
 */

import {
  type MarkerDialect,
  type MarkerScore,
  scoreDialectMarkers,
} from "./dialectMarkers.ts";
import { normalizeArabic } from "./msaLeakDetector.ts";

const ARABIC_ANYWHERE = /[؀-ۿ]/;
/** Arabic letters, without the diacritic and punctuation blocks. */
const ARABIC_LETTER = "\\u0620-\\u064A";

/**
 * Attached pronouns. Arabic writes them as suffixes, so a whole-word match on
 * عند misses عندكم — which is the form people actually type. `dialectMarkers`
 * matches on whole words by design (its lists are closed-class forms chosen to
 * be unambiguous); the register lists here are open enough to need the clitics.
 */
const CLITIC_SUFFIX = "(?:كما|كم|كن|ك|هما|ها|هم|هن|ه|نا|ني|ي)?";
/** Leading conjunctions, written attached: وكمان, فخلاص. */
const CLITIC_PREFIX = "[وف]?";

/**
 * A marker as a whole word, tolerating those clitics.
 *
 * The boundaries are explicit lookarounds over the Arabic letter range rather
 * than `\b`, because `\b` is defined against `\w` — which is ASCII — so
 * `\bمش\b` matches nowhere and every marker silently scores zero. A probe run
 * scored 0% on text that is visibly Egyptian before that was noticed.
 */
function wordRe(word: string): RegExp {
  const body = normalizeArabic(word).split(" ").join("\\s+");
  return new RegExp(
    `(?<![${ARABIC_LETTER}])${CLITIC_PREFIX}${body}${CLITIC_SUFFIX}(?![${ARABIC_LETTER}])`,
    "u",
  );
}

/**
 * First and second person: someone talking, rather than something being
 * reported. Written in unnormalized form and normalized on compile, so the
 * lists read the way a person would type them.
 */
const PERSONAL = [
  "انا", "احنا", "نحن", "انت", "انتي", "انتو", "انتم",
  "عندي", "عندك", "عندكم", "عندكو", "عندنا", "ليا", "ليك", "ليكم", "ليكو",
  "لينا", "لكم", "معايا", "معاك", "معاكم", "معاكو", "معانا",
  "بحب", "احب", "اريد", "ابغى",
  "شكرا", "ربنا", "يا", "يارب", "اللهم", "تحياتي",
  "برايي", "رايي", "اعتقد", "اقول", "قلت", "شفت", "اشوف",
];

/**
 * Newsroom register: not "MSA words" but the words a *newsroom* reaches for.
 * Reporting verbs and protocol titles are what a wire story is made of, and
 * they are exactly what a person writing to a friend never types.
 *
 * Deliberately disjoint from `dialectMarkers`'s MSA list, which is about MSA
 * *grammar* (سوف, الذي, ليس). Both signals count.
 */
const NEWSROOM = [
  "اعلن", "اعلنت", "اكد", "اكدت", "صرح", "صرحت", "افاد", "افادت",
  "اوضح", "اوضحت", "شدد", "شددت", "ذكرت", "اشار", "اشارت", "نفي",
  "وفقا", "بحسب", "استنادا", "لدي", "اثر", "عقب",
  "في اطار", "من جانبه", "من جهته", "يذكر ان", "الجدير بالذكر",
  "استقبل", "التقي", "ترأس", "شهدت", "نظمت", "اطلقت",
  "سعاده", "معالي", "صاحب السمو", "خادم الحرمين", "فخامه",
];

const PERSONAL_RE = PERSONAL.map(wordRe);
const NEWSROOM_RE = NEWSROOM.map(wordRe);

export function hasArabicScript(text: string): boolean {
  return ARABIC_ANYWHERE.test(text);
}

/**
 * The teachable part of a post: links, @mentions, hashtags and the zero-width
 * marks X sprinkles through RTL text all removed.
 *
 * Both halves need this. Length is measured on it (a tweet that is a headline
 * plus a t.co link is not five words of Arabic), and so is marker matching —
 * `#مصر_دلوقتي` is a tag, not someone saying دلوقتي.
 */
export function stripNoise(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[@#][^\s@#]+/g, " ")
    // Zero-width and bidi control marks, written as escapes: as literals they
    // are invisible in a diff.
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Arabic-script words in the stripped text. */
export function arabicWordCount(text: string): number {
  return stripNoise(text)
    .split(/\s+/)
    .filter((word) => ARABIC_ANYWHERE.test(word)).length;
}

/**
 * Note on `dialectal`: it is `dialectMarkers`'s reading, clitics and all.
 * That scorer matches whole words, so `عادك` does not register where `عاد`
 * would — its lists are closed-class forms chosen to be unambiguous, and
 * loosening them is that module's call to make, not this one's. The
 * consequence here is benign: a missed dialect marker only means the text
 * falls through to the register test instead of passing on the spot.
 */
export interface RegisterProfile {
  /** Distinct first/second-person markers — is a human addressing anyone? */
  personal: number;
  /** Distinct newsroom-register markers. */
  newsroom: number;
  /** Whatever `dialectMarkers` made of the same text. */
  markers: MarkerScore;
  arabicWords: number;
  /** Any dialect evidence at all: a directional marker or a pan-dialect one. */
  dialectal: boolean;
}

export function registerProfile(text: string): RegisterProfile {
  const stripped = normalizeArabic(stripNoise(text));
  const markers = scoreDialectMarkers(stripped);
  const directional = Math.max(
    markers.dialectScores.Gulf,
    markers.dialectScores.Egyptian,
    markers.dialectScores.Yemeni,
  );
  return {
    personal: PERSONAL_RE.filter((re) => re.test(stripped)).length,
    newsroom: NEWSROOM_RE.filter((re) => re.test(stripped)).length,
    markers,
    arabicWords: arabicWordCount(text),
    dialectal: directional > 0 || markers.generalScore > 0,
  };
}

export type PrescreenReason = "ok" | "no_arabic" | "too_short" | "news_register" | "headline";

export interface PrescreenResult {
  /** Should this post cost an askBrain screening call? */
  worthScreening: boolean;
  /** Audit trail: why not, when not. */
  reason: PrescreenReason;
  profile: RegisterProfile;
}

export interface PrescreenOptions {
  /** Below this many Arabic words there is nothing to teach. */
  minArabicWords?: number;
  /**
   * Arabic words above which a sentence carrying neither dialect evidence nor
   * anyone speaking is treated as a headline.
   *
   * Set from a measurement rather than by taste: on 97 tweets from a newspaper
   * account, MSA and newsroom markers together rejected a handful. Headlines
   * are long, third-person and nominal — `الأهلي يفوز على الزمالك بهدفين في
   * الدوري` carries no marker from any list — so length plus the absence of
   * anyone speaking is what identifies them. Raise it to be more permissive.
   */
  headlineWordFloor?: number;
}

/**
 * Decide whether a harvested post earns a screening call.
 *
 * Refusals are the ones a reviewer would make at a glance: no Arabic, too
 * short to be worth reading, or wire copy. Everything else goes to the model,
 * including text with no markers at all — absence of a marker is not evidence
 * of MSA, and the marker lists under-detect dialect by construction.
 */
export function prescreen(text: string, options: PrescreenOptions = {}): PrescreenResult {
  // Three words, not five: `شلونكم يا جماعة؟` is three words and is exactly
  // what this app exists to teach. The floor bins a bare hashtag or a
  // one-word reply, nothing more.
  const minArabicWords = options.minArabicWords ?? 3;
  const headlineWordFloor = options.headlineWordFloor ?? 7;
  const profile = registerProfile(text);

  if (!hasArabicScript(text)) return { worthScreening: false, reason: "no_arabic", profile };
  if (profile.arabicWords < minArabicWords) {
    return { worthScreening: false, reason: "too_short", profile };
  }
  // Any dialect evidence buys the call outright — a headline quoting someone
  // in dialect is the best thing a news account produces, and must not be
  // thrown away for the wire copy wrapped around it.
  if (profile.dialectal) return { worthScreening: true, reason: "ok", profile };
  // Nobody is speaking. A newsroom marker, MSA grammar, or headline length is
  // then enough to call it without asking a model.
  if (profile.personal === 0) {
    if (profile.newsroom > 0 || profile.markers.msaScore > 0) {
      return { worthScreening: false, reason: "news_register", profile };
    }
    if (profile.arabicWords >= headlineWordFloor) {
      return { worthScreening: false, reason: "headline", profile };
    }
  }
  return { worthScreening: true, reason: "ok", profile };
}

/**
 * Rank a batch most-colloquial-first: what a bounded screening budget should
 * be spent on when a source returns more than the run can afford.
 */
export function colloquialScore(text: string, dialect?: MarkerDialect | string): number {
  const profile = registerProfile(text);
  const scores = profile.markers.dialectScores;
  const directional = Math.max(scores.Gulf, scores.Egyptian, scores.Yemeni);
  // The source's own dialect counts double, someone actually speaking counts
  // once, and newsroom register subtracts.
  const own = dialect && dialect in scores ? scores[dialect as MarkerDialect] : 0;
  return (
    directional + own + profile.markers.generalScore +
    Math.min(profile.personal, 2) * 0.5 -
    profile.markers.msaScore - Math.min(profile.newsroom, 2) * 0.5
  );
}
