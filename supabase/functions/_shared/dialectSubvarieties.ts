// The sub-varieties inside each dialect, and the axes along which they differ.
//
// `discover_videos.dialect` stops at the country ("Saudi", "Kuwaiti",
// "Egyptian"), which is roughly the resolution of a passport rather than of a
// dialect. A native reviewer watching a clip hears far more than that — they
// hear Hijazi and not Najdi, Ṣaʿīdi and not Cairene, Tihāmi and not Ṣanʿāni —
// and until now there was nowhere on the review screen to put that.
//
// Why it matters beyond tidiness: the generators condition on the dialect
// label. A "Saudi" corpus that silently mixes Jeddah and Riyadh teaches a
// learner two systems at once and calls it one, and the pronunciation and
// TTS paths pick a voice off the same label. The finer label is only ever
// worth having if somebody who can actually hear the difference sets it, which
// is why this is a reviewer's field and not something the pipeline guesses.
//
// Two design rules, both of which shape everything below:
//
//   1. **Two levels, never one flat list.** Every variety here is reached by
//      first picking the country, so no dropdown is ever more than about seven
//      long. A single list of forty would be unusable and nobody would set it.
//   2. **Ids are a contract.** They are written into `dialect_subvariety` and
//      into every `dialect_features[].subvariety`, so renaming one orphans the
//      rows already tagged with it. Add freely; rename never.
//
// Pure and dependency-free, like grammarTaxonomy.ts, so the Vitest suite can
// exercise it and the React admin can import the lists rather than keeping a
// second copy that drifts.

/**
 * The dialect labels `discover_videos.dialect` is allowed to hold.
 *
 * Exactly the list the admin video form has always offered, moved here so the
 * review workspace, the video form and the `transcript-review` write path all
 * read one array. Order is the form's, unchanged, so nothing shuffles under
 * anyone who already knows where "Egyptian" sits.
 *
 * Wider than the three modules the app teaches: a clip gets tagged Levantine or
 * MSA precisely so it can be recognised as the wrong thing and pulled, and a
 * reviewer needs to be able to say so.
 */
export const REVIEWABLE_DIALECTS = [
  "Saudi",
  "Kuwaiti",
  "UAE",
  "Bahraini",
  "Qatari",
  "Omani",
  "Gulf",
  "MSA",
  "Egyptian",
  "Yemeni",
  "Levantine",
  "Maghrebi",
] as const;

export type ReviewableDialect = (typeof REVIEWABLE_DIALECTS)[number];

const REVIEWABLE_DIALECT_SET: ReadonlySet<string> = new Set(REVIEWABLE_DIALECTS);

/**
 * Labels already sitting on rows that the picker does not offer.
 *
 * `Emirati` is the whole list: the admin video form has always written "UAE"
 * and the curriculum builder "Emirati", and both reached `discover_videos`. The
 * picker shows one of them, but the write path has to keep accepting the other
 * or a reviewer opening an Emirati-tagged video could not save anything at all
 * — the notes form posts the dialect on every save, so a rejected label would
 * take the cultural notes and the transcript classification down with it.
 *
 * Deliberately *accepted* rather than *rewritten*. Quietly re-labelling the row
 * to "UAE" would put a change the reviewer never made into the audit trail
 * under their name, which is the one thing that log may not do. Normalising
 * these is a data migration, not a side effect of somebody saving a note.
 */
export const LEGACY_DIALECT_ALIASES: Readonly<Record<string, ReviewableDialect>> = {
  Emirati: "UAE",
};

/**
 * Is `value` a dialect label a reviewer may set?
 *
 * True for the labels the picker offers and for the legacy aliases above.
 */
export function isReviewableDialect(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (REVIEWABLE_DIALECT_SET.has(value) || value in LEGACY_DIALECT_ALIASES)
  );
}

/** One sub-variety of one dialect. */
export interface DialectSubvariety {
  /** Stable id. Written to the database — see rule 2 above. */
  id: string;
  /** What the reviewer reads in the dropdown. */
  label: string;
  /** The Arabic name, since most of the reviewers are Arabic-first. */
  labelAr: string;
  /** Where it is spoken, and the one feature that gives it away. */
  hint: string;
}

/**
 * Sub-varieties by the value stored in `discover_videos.dialect`.
 *
 * Keyed on the *raw stored label*, not on the three module names, because the
 * pipeline writes "Saudi"/"Kuwaiti"/"UAE" for the Gulf module and the reviewer
 * is choosing underneath whatever is on the row. `UAE` and `Emirati` both
 * appear in the wild (the video form writes the first, the curriculum builder
 * the second), so both are keyed to the same list.
 *
 * Each list stops at the divisions a native speaker would name unprompted. The
 * dialectological literature can subdivide much further — al-ʿAwābī is not
 * Nizwā — but a dropdown a reviewer has to think hard about is a dropdown that
 * gets left on its default.
 */
export const DIALECT_SUBVARIETIES: Readonly<Record<string, readonly DialectSubvariety[]>> = {
  // ── Gulf, when nothing narrower is known ──────────────────────────────────
  //
  // The one axis that survives without knowing the country. The ḥaḍar/badu
  // split cuts across every Gulf state and predicts more than the border does:
  // whether ق is [g] everywhere, whether ك palatalizes, whether the feminine
  // plural is kept apart.
  Gulf: [
    {
      id: "khaliji-hadar",
      label: "Ḥaḍar (settled / urban)",
      labelAr: "حضر",
      hint: "Coastal town speech across the Gulf — Kuwait City, Manama, Doha, Dubai.",
    },
    {
      id: "khaliji-badu",
      label: "Badu (bedouin / tribal)",
      labelAr: "بدو",
      hint: "Tribal speech across the interior; keeps ق as [g] throughout and distinguishes the feminine plural.",
    },
    {
      id: "khaliji-media",
      label: "Pan-Gulf media register",
      labelAr: "خليجي إعلامي",
      hint: "The levelled register of Gulf TV and adverts — deliberately no one country.",
    },
  ],

  // ── Saudi Arabia ──────────────────────────────────────────────────────────
  Saudi: [
    {
      id: "najdi",
      label: "Najdi (Riyadh, central)",
      labelAr: "نجدي",
      hint: "Central plateau. وش for 'what', أبغى/أبي, ـه/ـها suffixes; ق is [g].",
    },
    {
      id: "qassimi",
      label: "Qassimi (al-Qaṣīm)",
      labelAr: "قصيمي",
      hint: "A Najdi branch, but salient enough that Saudis name it separately — Buraydah, ʿUnayzah.",
    },
    {
      id: "hijazi",
      label: "Ḥijāzi (Jeddah, Mecca, Medina)",
      labelAr: "حجازي",
      hint: "Red Sea coast. إيش for 'what', بـ-less imperfect, ـين plurals; urban Hijazi keeps ق as [g] but ث/ذ often merge.",
    },
    {
      id: "hasawi",
      label: "Eastern Province (al-Aḥsāʾ, Dammam, Qatif)",
      labelAr: "شرقاوي / حساوي",
      hint: "Closest of the Saudi varieties to Kuwaiti and Bahraini; kashkasha ك → [ts]/[ch].",
    },
    {
      id: "janubi",
      label: "Southern (ʿAsīr, Jīzān, Najrān)",
      labelAr: "جنوبي",
      hint: "Heavily Yemeni-facing; Jīzān and Tihāma villages use the am- article.",
    },
    {
      id: "shamali",
      label: "Northern (Ḥāʾil, al-Jawf, Tabūk)",
      labelAr: "شمالي",
      hint: "Shammari and northern tribal speech, reaching toward Jordanian and Iraqi bedouin.",
    },
  ],

  // ── Kuwait ────────────────────────────────────────────────────────────────
  Kuwaiti: [
    {
      id: "kuwaiti-hadar",
      label: "Ḥaḍar (Kuwait City, old town families)",
      labelAr: "حضر",
      hint: "The register of Kuwaiti drama and most media; ج is [j], heavy Persian and Indian loan layer.",
    },
    {
      id: "kuwaiti-badu",
      label: "Badu (ʿAwāzim, Muṭayr, ʿAjmān)",
      labelAr: "بدو",
      hint: "Tribal Kuwaiti, close to Najdi; keeps the feminine plural ـن and gahwa-type ق.",
    },
    {
      id: "kuwaiti-ajami",
      label: "ʿAjami (Persian-heritage Kuwaiti)",
      labelAr: "عيمي",
      hint: "Kuwaiti of Iranian-descent families; distinct prosody and a wider Persian lexicon.",
    },
  ],

  // ── United Arab Emirates ──────────────────────────────────────────────────
  // Both spellings occur on rows in the wild; they must resolve identically.
  UAE: emirati(),
  Emirati: emirati(),

  // ── Bahrain ───────────────────────────────────────────────────────────────
  //
  // The one Gulf state where the sectarian split *is* the dialect split, and
  // the two are not mutually substitutable: Baḥrānī is a sedentary variety of a
  // different historical stratum, not an accent of the Sunni one.
  Bahraini: [
    {
      id: "bahrani",
      label: "Baḥrānī (Bahārna villages)",
      labelAr: "بحراني",
      hint: "Sedentary Shia village speech; ق often [q], distinctive verb morphology and lexicon.",
    },
    {
      id: "bahraini-sunni",
      label: "Sunni / ʿArab Bahraini (Manama, Muharraq)",
      labelAr: "بحريني سني",
      hint: "The urban register closest to Qatari and Eastern-Province Saudi.",
    },
    {
      id: "bahraini-ajami",
      label: "ʿAjami (Persian-heritage Bahraini)",
      labelAr: "عيمي",
      hint: "Bahraini of Iranian-descent families, with a wider Persian lexicon.",
    },
  ],

  // ── Qatar ─────────────────────────────────────────────────────────────────
  Qatari: [
    {
      id: "qatari-urban",
      label: "Doha urban",
      labelAr: "قطري حضري",
      hint: "The coastal town register; very close to Sunni Bahraini and Eastern-Province Saudi.",
    },
    {
      id: "qatari-bedouin",
      label: "Bedouin / tribal (Naʿīm, al-Murrah)",
      labelAr: "قطري بدوي",
      hint: "Najdi-facing tribal Qatari; keeps the feminine plural.",
    },
  ],

  // ── Oman ──────────────────────────────────────────────────────────────────
  //
  // The Gulf's most internally varied country, and the one where the usual
  // "Gulf Arabic" grammars stop applying — hence six entries where Qatar gets
  // two.
  Omani: [
    {
      id: "muscat",
      label: "Muscat / Capital Area",
      labelAr: "مسقطي",
      hint: "Mixed sedentary-bedouin coastal speech; the closest thing Oman has to a national register.",
    },
    {
      id: "batinah",
      label: "Bāṭinah coast (Sohar, Barka)",
      labelAr: "باطني",
      hint: "Sedentary coastal north; ق frequently [q] rather than [g].",
    },
    {
      id: "omani-interior",
      label: "Interior / Jabal Akhḍar (Nizwā, al-Dākhiliyah)",
      labelAr: "داخلية",
      hint: "Old sedentary Omani; the most conservative morphology in the country.",
    },
    {
      id: "dhofari",
      label: "Dhofari (Salalah, the south)",
      labelAr: "ظفاري",
      hint: "Southern Oman, in contact with Modern South Arabian (Jibbāli/Mehri) and with Yemeni Ḥaḍrami.",
    },
    {
      id: "omani-bedouin",
      label: "Bedouin (Sharqiyah, Ṣūr, the desert)",
      labelAr: "بدوي عماني",
      hint: "ق as [g] throughout; the eastern group around Ṣūr is distinct again.",
    },
    {
      id: "shihhi",
      label: "Shiḥḥi (Musandam, RAK mountains)",
      labelAr: "شحي",
      hint: "Mountain variety of the Musandam peninsula — often unintelligible to other Gulf speakers.",
    },
    {
      id: "omani-zanzibari",
      label: "Zanzibari-returnee Omani",
      labelAr: "زنجباري",
      hint: "Omani families returned from East Africa; audible Swahili lexicon and prosody.",
    },
  ],

  // ── Egypt ─────────────────────────────────────────────────────────────────
  Egyptian: [
    {
      id: "cairene",
      label: "Cairene (Cairo, Giza)",
      labelAr: "مصري قاهري",
      hint: "The register of Egyptian film and TV, and the default sense of 'Egyptian Arabic'.",
    },
    {
      id: "alexandrian",
      label: "Alexandrian (Iskandarāni)",
      labelAr: "إسكندراني",
      hint: "Coastal west; distinctive intonation, Mediterranean loanwords, بتاع↔تاع variation.",
    },
    {
      id: "delta-fallahi",
      label: "Delta / rural (Fallāḥi)",
      labelAr: "فلاحي",
      hint: "Rural Lower Egypt — Sharqiyya, Gharbiyya, Minufiyya. ج may be [ʒ]/[ɟ] rather than [g].",
    },
    {
      id: "canal-cities",
      label: "Canal cities (Port Said, Ismailia, Suez)",
      labelAr: "بورسعيدي / قنالي",
      hint: "Own vowel colouring and a widely-recognised sing-song intonation.",
    },
    {
      id: "saidi",
      label: "Ṣaʿīdi (Upper Egypt, Asyut → Aswan)",
      labelAr: "صعيدي",
      hint: "ق as [g] and ج as [dʒ] — the reverse of Cairene; distinct stress and pronoun set.",
    },
    {
      id: "sinai-bedawi",
      label: "Sinai & Eastern Desert bedouin",
      labelAr: "بدو سيناء",
      hint: "Northwest-Arabian bedouin type, closer to Negev and southern Jordanian than to Cairo.",
    },
    {
      id: "western-desert-bedawi",
      label: "Western Desert bedouin (Awlād ʿAli, Matrouh)",
      labelAr: "بدو الصحراء الغربية",
      hint: "Classified with eastern Libyan Arabic rather than with Egyptian proper.",
    },
  ],

  // ── Yemen ─────────────────────────────────────────────────────────────────
  Yemeni: [
    {
      id: "sanaani",
      label: "Ṣanʿāni (northern highlands)",
      labelAr: "صنعاني",
      hint: "ق as [g], ج kept as [dʒ]; the bare-perfect and the ـش negation are the giveaways.",
    },
    {
      id: "taizzi-adeni",
      label: "Taʿizzi–ʿAdeni (south & southwest)",
      labelAr: "تعزي عدني",
      hint: "ق as [q] and ج as [g] — the mirror of Ṣanʿāni. Aden adds a colonial-era English layer.",
    },
    {
      id: "tihami",
      label: "Tihāmi (Red Sea coast, Hodeidah, Zabīd)",
      labelAr: "تهامي",
      hint: "The am-/im- definite article and the future particle šā- — unlike anything else in Arabic.",
    },
    {
      id: "hadhrami",
      label: "Ḥaḍrami (Ḥaḍramawt, Mukalla, Seiyun)",
      labelAr: "حضرمي",
      hint: "Eastern valley speech; coastal Ḥaḍrami turns ج into [j]. Strong Indian Ocean diaspora lexicon.",
    },
    {
      id: "yafii",
      label: "Yāfiʿi (Yāfiʿ highlands)",
      labelAr: "يافعي",
      hint: "Southern tribal highlands, transitional between Taʿizzi–ʿAdeni and Ḥaḍrami.",
    },
    {
      id: "northern-tribal",
      label: "Northern tribal (Ṣaʿda, al-Jawf, Maʾrib)",
      labelAr: "قبلي شمالي",
      hint: "Bedouin-facing north; reaches toward the southern Saudi varieties across the border.",
    },
  ],
};

/**
 * The Emirati list, built by a function so `UAE` and `Emirati` share one array
 * rather than two copies that can drift apart.
 */
function emirati(): readonly DialectSubvariety[] {
  return [
    {
      id: "abu-dhabi",
      label: "Abu Dhabi & the Western Region",
      labelAr: "أبوظبي والظفرة",
      hint: "Bani Yas heartland; the most Najdi-facing of the Emirati varieties.",
    },
    {
      id: "dubai-sharjah",
      label: "Dubai / Sharjah urban coast",
      labelAr: "دبي والشارقة",
      hint: "The cosmopolitan coastal register — the heaviest English code-switching in the Gulf.",
    },
    {
      id: "northern-emirates",
      label: "Northern Emirates (RAK, UAQ, Ajman, Fujairah)",
      labelAr: "الإمارات الشمالية",
      hint: "More conservative pronunciation than the Dubai coast; Fujairah faces the Gulf of Oman.",
    },
    {
      id: "al-ain-inland",
      label: "Al Ain & inland bedouin",
      labelAr: "العين والبادية",
      hint: "Inland tribal speech; keeps the feminine plural and the bedouin ق.",
    },
    {
      id: "shihhi",
      label: "Shiḥḥi (Musandam, RAK mountains)",
      labelAr: "شحي",
      hint: "The mountain variety, shared with Omani Musandam — the same id in both lists on purpose.",
    },
  ];
}

/**
 * What kind of thing a dialect feature *is*.
 *
 * Not the same question as `grammarTaxonomy.ts`'s six categories, and
 * deliberately not merged with them. Those exist so a learner's mastery ladder
 * has stable rungs — "has this person got negation yet". These exist so a
 * reviewer can say *what makes this clip sound like Jīzān and not Riyadh*, and
 * the answer is very often not a grammar category at all: it is a ق, a
 * borrowing, or an intonation contour. A shared key space would force every
 * phonological note into "sentence-structure" and lose the whole point.
 *
 * Ordered roughly by how early a learner meets them.
 */
export const DIALECT_FEATURE_CATEGORIES = [
  {
    id: "phonology",
    label: "Sound (ق ج ك ث ذ, imāla)",
    hint: "How the letters are actually pronounced here — gāf/qāf, jīm, kashkasha, ث/ذ merging.",
  },
  {
    id: "pronouns",
    label: "Pronouns & suffixes",
    hint: "إنتي/إنتش، هم/هن، ـكم/ـكن، ـه/ـها — including whether the feminine plural is kept.",
  },
  {
    id: "demonstratives",
    label: "Demonstratives & place words",
    hint: "هذا / ذا / دا / هذي، هنا / هني / هنيه، كذا / كده.",
  },
  {
    id: "article-genitive",
    label: "Article & genitive exponent",
    hint: "ال / أم / إم، and حق / مال / بتاع / تبع / شي for 'of'.",
  },
  {
    id: "negation",
    label: "Negation",
    hint: "ما، مو / مب / مش / مهوب، the ـش circumfix, and what negates a noun vs a verb.",
  },
  {
    id: "verb-morphology",
    label: "Verb shapes",
    hint: "Imperfect prefix vowels, the internal passive, participles used as verbs, imperative forms.",
  },
  {
    id: "tense-aspect",
    label: "Tense, aspect & future markers",
    hint: "بـ / حـ / هـ / راح / بغى / شـ for the future; قاعد / عم / جالس / بـ for the progressive.",
  },
  {
    id: "question-words",
    label: "Question words",
    hint: "وش / إيش / شنو / شو / إيه، وين / فين، كيف / إزاي / شلون، ليش / ليه، متى / إمتى.",
  },
  {
    id: "relatives-complementizers",
    label: "Relatives & complementizers",
    hint: "اللي / الذي، إن / إنه / إنو، and how a relative clause is joined at all.",
  },
  {
    id: "prepositions",
    label: "Prepositions",
    hint: "عند / معي / لي / حق، في / بـ, and the pronoun forms they take.",
  },
  {
    id: "word-order-agreement",
    label: "Word order & agreement",
    hint: "VSO vs SVO, plural agreement, and the dual where it survives.",
  },
  {
    id: "lexicon",
    label: "Words used only here",
    hint: "A word or sense that would not be understood, or would mean something else, one country over.",
  },
  {
    id: "discourse-particles",
    label: "Discourse particles & fillers",
    hint: "زين / طيب / عاد / بس / خلاص / يعني / أجل — the small words that place a speaker fastest.",
  },
  {
    id: "borrowings",
    label: "Loanwords",
    hint: "Persian, Hindi/Urdu, Turkish, Swahili, Italian, English — which layer, and how naturalised.",
  },
  {
    id: "numbers-time",
    label: "Numbers, counting & time",
    hint: "How the numerals behave with nouns, and how the clock and the calendar are said.",
  },
  {
    id: "prosody",
    label: "Stress & intonation",
    hint: "The contour itself — often the first thing a native hears and the last thing a learner does.",
  },
  {
    id: "register-politeness",
    label: "Register, address & politeness",
    hint: "Terms of address, honorifics, and what is too formal or too familiar in this variety.",
  },
] as const;

export type DialectFeatureCategoryId = (typeof DIALECT_FEATURE_CATEGORIES)[number]["id"];

const FEATURE_CATEGORY_IDS: ReadonlySet<string> = new Set(
  DIALECT_FEATURE_CATEGORIES.map((category) => category.id),
);

/**
 * One thing about this clip that is specific to the variety it is in.
 *
 * `contrast` is the field that makes an entry worth reading rather than worth
 * skimming. "Uses شنو for 'what'" is a fact; "uses شنو where Riyadh says وش and
 * Cairo says إيه" is the thing a learner can actually hold on to, and the
 * reviewer is the only person in the pipeline who reliably knows it.
 */
export interface DialectFeature {
  /** One of DIALECT_FEATURE_CATEGORIES. */
  category: DialectFeatureCategoryId | string;
  /**
   * The variety this is specific to. Usually the video's own sub-variety, but
   * a clip can carry a feature the speaker imported from somewhere else —
   * which is precisely a thing worth recording rather than flattening.
   */
  subvariety?: string;
  /** A short name for the feature. */
  title?: string;
  /** The Arabic form itself. */
  arabic?: string;
  /** Where it happens in this clip — the `id` of a transcript line. */
  lineId?: string;
  /** What it is and how it works. */
  explanation?: string;
  /** How another variety says the same thing. */
  contrast?: string;
}

// ── Lookups ─────────────────────────────────────────────────────────────────

/**
 * The sub-varieties offered under one dialect label.
 *
 * Empty for a label with no taxonomy here (MSA, Levantine, Maghrebi — none of
 * which this app teaches), which is the signal to the UI to hide the second
 * dropdown entirely rather than show an empty one.
 */
export function subvarietiesFor(dialect: unknown): readonly DialectSubvariety[] {
  if (typeof dialect !== "string") return [];
  return DIALECT_SUBVARIETIES[dialect] ?? [];
}

/** Does `id` belong under `dialect`? */
export function isSubvarietyOf(dialect: unknown, id: unknown): boolean {
  if (typeof id !== "string" || !id) return false;
  return subvarietiesFor(dialect).some((entry) => entry.id === id);
}

/**
 * The sub-variety `id` names, wherever it lives.
 *
 * Needed because a stored id outlives the dialect label it was set under: a
 * reviewer can correct "Saudi" to "Egyptian" on a mis-tagged video, and the
 * screen still has to be able to render the old label while telling them it no
 * longer applies.
 */
export function findSubvariety(id: unknown): DialectSubvariety | undefined {
  if (typeof id !== "string" || !id) return undefined;
  for (const list of Object.values(DIALECT_SUBVARIETIES)) {
    const found = list.find((entry) => entry.id === id);
    if (found) return found;
  }
  return undefined;
}

/** Its human label, or the raw id if it is not one we know. */
export function subvarietyLabel(id: unknown): string {
  return findSubvariety(id)?.label ?? (typeof id === "string" ? id : "");
}

/** The label of a feature category, or the raw id if it is not one we know. */
export function featureCategoryLabel(id: unknown): string {
  const found = DIALECT_FEATURE_CATEGORIES.find((category) => category.id === id);
  return found?.label ?? (typeof id === "string" ? id : "");
}

/**
 * Every dialect label that has a sub-variety list, for tests and for anything
 * that wants to know whether asking the question is worth it.
 */
export function dialectsWithSubvarieties(): string[] {
  return Object.keys(DIALECT_SUBVARIETIES);
}

// ── Validation, for the write path ──────────────────────────────────────────

/**
 * The sub-variety to actually store, given what was asked for and what the
 * video's dialect now is.
 *
 * `null` clears it, and clearing is the right answer for a mismatch rather than
 * an error: the case that produces one is a reviewer correcting the country on
 * a mis-tagged video, where the old sub-variety is simply no longer a claim
 * anybody made. Refusing the save would leave them stuck with the wrong country
 * *and* the wrong variety under it.
 */
export function resolveSubvariety(dialect: unknown, requested: unknown): string | null {
  if (requested === null || requested === undefined || requested === "") return null;
  return isSubvarietyOf(dialect, requested) ? String(requested) : null;
}

/**
 * Clean one reviewer-supplied feature, or reject it.
 *
 * Returns `null` for anything that would be noise in the corpus: an unknown
 * category, or an entry with a category and nothing else said about it. The
 * category alone is a dropdown left on its default, not an observation.
 */
export function sanitizeDialectFeature(
  input: unknown,
  dialect: unknown,
): DialectFeature | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;

  const category = String(raw.category ?? "");
  if (!FEATURE_CATEGORY_IDS.has(category)) return null;

  const text = (value: unknown, limit = 2000): string =>
    typeof value === "string" ? value.trim().slice(0, limit) : "";

  const feature: DialectFeature = { category };

  // A feature may name any known sub-variety, not only one under this video's
  // dialect — a Cairene speaker quoting a Ṣaʿīdi phrase is a real thing to log.
  // Anything unrecognised falls back to the video's own, which is the claim the
  // reviewer was making by tagging the video in the first place.
  const named = typeof raw.subvariety === "string" ? raw.subvariety : "";
  const subvariety = findSubvariety(named)
    ? named
    : resolveSubvariety(dialect, raw.subvariety) ?? "";
  if (subvariety) feature.subvariety = subvariety;

  const title = text(raw.title, 200);
  const arabic = text(raw.arabic, 500);
  const explanation = text(raw.explanation);
  const contrast = text(raw.contrast);
  const lineId = text(raw.lineId, 100);

  if (title) feature.title = title;
  if (arabic) feature.arabic = arabic;
  if (lineId) feature.lineId = lineId;
  if (explanation) feature.explanation = explanation;
  if (contrast) feature.contrast = contrast;

  if (!title && !arabic && !explanation && !contrast) return null;
  return feature;
}

/** Bounds on a mistake, not a threat model — same reasoning as MAX_LINES. */
export const MAX_DIALECT_FEATURES = 100;

/** The whole list, cleaned. Anything unusable is dropped rather than stored. */
export function sanitizeDialectFeatures(input: unknown, dialect: unknown): DialectFeature[] {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, MAX_DIALECT_FEATURES)
    .map((entry) => sanitizeDialectFeature(entry, dialect))
    .filter((entry): entry is DialectFeature => entry !== null);
}

/**
 * A one-line description of the variety, for a model prompt.
 *
 * The retranslation prompt is the immediate consumer: "a Ṣaʿīdi clip" and "a
 * Cairene clip" should not be translated by the same instruction, and the
 * hint text here is already written in the register a prompt wants.
 */
export function subvarietyPromptHint(dialect: unknown, id: unknown): string {
  const found = findSubvariety(id);
  if (!found || !isSubvarietyOf(dialect, id)) return "";
  return `${found.label} (${found.labelAr}) — ${found.hint}`;
}
