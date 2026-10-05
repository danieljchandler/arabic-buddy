/**
 * The daily recap's pure half: what a learner's recent day (or week) in the
 * app amounts to, and the tutor session that reviews it.
 *
 * The debrief talks one video through right after it was watched; this is the
 * next morning's counterpart. It reads everything the app recorded about the
 * learner in a window — the clips they watched, the words they saved or looked
 * up, the slips the practice surfaces caught, the lesson, story or chat they
 * had — and turns it into a short guided conversation: here is what you did,
 * tell the clip back to me, a quiz on your words, fix the slip, say a line
 * aloud, recap. Retrieval with the episode still attached: "the word from the
 * clip about the tired friend" is a better hook than a flashcard with no past.
 *
 * Nothing here touches the network or the clock without being handed it. The
 * window arrives as rows (`recapWindow.ts` reads them), the plan it builds is
 * deterministic for a given window and seed (so the quiz the page shows is the
 * quiz the tutor is told about on every later turn), and the prompt is a pure
 * function of the plan. `src/test/recapCore.test.ts` holds it.
 */
import {
  buildWordQuiz,
  describeQuizResults,
  describeShadowResult,
  normalizeCefr,
  pickShadowLines,
  selectFocusWords,
  STEP_DONE_MARKER,
  tutorLanguageRule,
  type DebriefLine,
  type FocusWord,
  type LookupRow,
  type QuizItem,
  type QuizOutcome,
  type SavedWordRow,
  type ShadowLine,
  type ShadowOutcome,
  type VideoStudyGuide,
} from "./videoDebriefCore.ts";
import { normalizeArabic } from "./arabicMatch.ts";

export { STEP_DONE_MARKER, stripStepMarker } from "./videoDebriefCore.ts";

/** Bumped when a stored plan's shape changes, so an old row is rebuilt rather than misread. */
export const RECAP_VERSION = 1;

// ── The window ─────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Half a day either side of the real range of UTC offsets, in minutes. */
const MAX_TZ_OFFSET = 14 * 60;

/** `YYYY-MM-DD` for a real calendar date, or null. */
export function parseLocalDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = LOCAL_DATE.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/**
 * The learner's UTC offset in minutes, east-positive (the opposite sign to
 * JavaScript's `getTimezoneOffset`). Anything unreadable is treated as UTC.
 */
export function parseTzOffset(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.max(-MAX_TZ_OFFSET, Math.min(MAX_TZ_OFFSET, Math.round(n)));
}

/** The local calendar date at `now` for a learner at `tzOffsetMinutes`. */
export function localDateAt(now: Date, tzOffsetMinutes: number): string {
  return new Date(now.getTime() + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

export interface RecapBounds {
  /** The learner's "today": the window ends at its local midnight. */
  localDate: string;
  tzOffsetMinutes: number;
  /** How many local days the window covers, ending at that midnight. */
  days: number;
  /** ISO instants, half-open: `since <= t < until`. */
  since: string;
  until: string;
}

/**
 * The window `days` local days long that ends at the learner's local midnight
 * this morning — "yesterday" for one day, "the last week" for seven.
 *
 * The client says what its local date and offset are, because profiles store
 * no timezone and a recap of "yesterday" computed in UTC is a recap of the
 * wrong day for everyone in the Americas. A date that disagrees wildly with
 * the server clock (a device set years out, or a hand-made request) is
 * ignored in favour of the clock plus the offset.
 */
export function recapBounds(input: {
  localDate?: unknown;
  tzOffsetMinutes?: unknown;
  days: number;
  now?: Date;
}): RecapBounds {
  const now = input.now ?? new Date();
  const tzOffsetMinutes = parseTzOffset(input.tzOffsetMinutes);
  const days = Math.max(1, Math.min(30, Math.round(input.days) || 1));
  let localDate = parseLocalDate(input.localDate) ?? localDateAt(now, tzOffsetMinutes);
  const midnightOf = (date: string) => {
    const [y, m, d] = date.split("-").map(Number);
    return Date.UTC(y, m - 1, d) - tzOffsetMinutes * 60_000;
  };
  let until = midnightOf(localDate);
  // More than a day ahead of the server, or more than a year behind it: not a
  // date anyone is living in.
  if (until > now.getTime() + DAY_MS || until < now.getTime() - 400 * DAY_MS) {
    localDate = localDateAt(now, tzOffsetMinutes);
    until = midnightOf(localDate);
  }
  return {
    localDate,
    tzOffsetMinutes,
    days,
    since: new Date(until - days * DAY_MS).toISOString(),
    until: new Date(until).toISOString(),
  };
}

/** "yesterday" or "this week", for prose. */
export function windowLabel(days: number): string {
  return days <= 1 ? "yesterday" : days <= 7 ? "this week" : `the last ${days} days`;
}

/** The same, capitalised, for a heading. */
export function windowTitle(days: number): string {
  return days <= 1 ? "Yesterday" : days <= 7 ? "This week" : `The last ${days} days`;
}

// ── What the window holds ──────────────────────────────────────────────────

/** One watched video, with what the recap needs of it. */
export interface RecapVideo {
  id: string;
  title: string;
  dialect: string;
  cefrLevel: string | null;
  watchedAt: string;
  completed: boolean;
  culturalContext?: string | null;
  /** Spoken lines, as `spokenLines` reads them; empty when the row carried none. */
  lines: DebriefLine[];
  /** `discover_videos.vocabulary`, for quiz distractors. */
  keyVocabulary: unknown;
  /** The cached study guide, when one exists and matches the transcript. */
  guide: VideoStudyGuide | null;
}

/** A `user_vocabulary` row, as much as the recap reads. */
export interface RecapSavedRow extends SavedWordRow {
  dialect?: string | null;
  created_at?: string | null;
  last_result?: string | null;
  last_reviewed_at?: string | null;
}

/** A `video_word_lookups` row with the video it came from. */
export interface RecapLookupRow extends LookupRow {
  video_id: string;
}

/** A `learner_errors` row, as much as the recap reads. */
export interface RecapErrorRow {
  target_arabic: string;
  produced_arabic?: string | null;
  error_kind?: string | null;
  source?: string | null;
}

export interface RecapLesson {
  title: string;
  titleArabic?: string | null;
  status: string;
}

export interface RecapChallenge {
  score: number;
  max: number;
}

/** Everything recorded about the learner inside the window. */
export interface RecapWindow {
  bounds: RecapBounds;
  dialect: string;
  videos: RecapVideo[];
  /** Words saved in the window, from anywhere in the app. */
  saved: RecapSavedRow[];
  /** Words that were reviewed in the window and rated Again or Hard. */
  reviewSlips: RecapSavedRow[];
  lookups: RecapLookupRow[];
  /** Unresolved learner errors recorded in the window. */
  errors: RecapErrorRow[];
  lessons: RecapLesson[];
  /** Titles of stories read (the daily story, interactive stories). */
  stories: string[];
  /** Titles of Ask AI conversations saved in the window. */
  chats: string[];
  challenge: RecapChallenge | null;
  /** The tutor's open questions about this learner, from its running notes. */
  openQuestions: string[];
}

export function emptyWindow(bounds: RecapBounds, dialect: string): RecapWindow {
  return {
    bounds,
    dialect,
    videos: [],
    saved: [],
    reviewSlips: [],
    lookups: [],
    errors: [],
    lessons: [],
    stories: [],
    chats: [],
    challenge: null,
    openQuestions: [],
  };
}

export interface RecapCounts {
  videos: number;
  /** Words saved. */
  words: number;
  lookups: number;
  /** Distinct slip targets plus words that slipped in review. */
  slips: number;
  lessons: number;
  stories: number;
  chats: number;
}

export function countWindow(window: RecapWindow): RecapCounts {
  return {
    videos: window.videos.length,
    words: window.saved.length,
    lookups: window.lookups.length,
    slips: groupSlips(window.errors, Infinity).length + window.reviewSlips.length,
    lessons: window.lessons.length,
    stories: window.stories.length,
    chats: window.chats.length,
  };
}

/** Whether there is anything at all to recap. A challenge alone counts: it is something they did. */
export function windowHasContent(window: RecapWindow): boolean {
  const counts = countWindow(window);
  return (
    Object.values(counts).some((n) => n > 0) || window.challenge !== null
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * "Yesterday: 1 video, 4 new words, 2 slips" — what the strip at the bottom of
 * the screen says. At most three parts, the ones a learner would recognise
 * as their own doing first.
 */
export function recapHeadline(counts: RecapCounts, days: number, challenge: RecapChallenge | null = null): string {
  const parts: string[] = [];
  if (counts.videos) parts.push(plural(counts.videos, "video"));
  if (counts.words) parts.push(`${plural(counts.words, "new word")}`);
  else if (counts.lookups) parts.push(`${plural(counts.lookups, "word")} looked up`);
  if (counts.slips) parts.push(plural(counts.slips, "slip"));
  if (counts.lessons) parts.push(plural(counts.lessons, "lesson"));
  if (counts.stories) parts.push(plural(counts.stories, "story", "stories"));
  if (counts.chats) parts.push(plural(counts.chats, "chat"));
  if (parts.length === 0 && challenge) parts.push("the daily challenge");
  if (parts.length === 0) return `${windowTitle(days)}: nothing yet`;
  return `${windowTitle(days)}: ${parts.slice(0, 3).join(", ")}`;
}

// ── Slips ──────────────────────────────────────────────────────────────────

/** One thing the learner keeps getting wrong, with their own version of it. */
export interface RecapSlip {
  target: string;
  /** What they actually said or wrote, when it was recorded. */
  produced: string | null;
  kinds: string[];
  /** Which surfaces caught it (pronunciation, writing, conversation…). */
  sources: string[];
  count: number;
}

/**
 * Errors grouped by what they were trying to say, most frequent first.
 *
 * A learner who got the same word wrong in the drill and again in conversation
 * has one slip, not two, and the recap should say it once — with the form they
 * produced, since the juxtaposition is what makes the correction stick.
 */
export function groupSlips(rows: RecapErrorRow[], max = 3): RecapSlip[] {
  const groups = new Map<string, RecapSlip>();
  for (const row of rows) {
    const target = (row.target_arabic ?? "").trim();
    const key = normalizeArabic(target);
    if (!key) continue;
    const slip = groups.get(key) ?? { target, produced: null, kinds: [], sources: [], count: 0 };
    slip.count++;
    const produced = (row.produced_arabic ?? "").trim();
    if (produced && !slip.produced && normalizeArabic(produced) !== key) slip.produced = produced;
    const kind = (row.error_kind ?? "").trim();
    if (kind && !slip.kinds.includes(kind)) slip.kinds.push(kind);
    const source = (row.source ?? "").trim();
    if (source && !slip.sources.includes(source)) slip.sources.push(source);
    groups.set(key, slip);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, max);
}

// ── The plan ───────────────────────────────────────────────────────────────

export type RecapStep = "yesterday" | "retell" | "words" | "slips" | "shadow" | "recap";

export const RECAP_STEPS: readonly RecapStep[] = ["yesterday", "retell", "words", "slips", "shadow", "recap"];

export const RECAP_STEP_LABELS: Record<RecapStep, string> = {
  yesterday: "Your day",
  retell: "Tell it back",
  words: "Your words",
  slips: "Fix a slip",
  shadow: "Say it",
  recap: "Recap",
};

export function isRecapStep(value: unknown): value is RecapStep {
  return typeof value === "string" && (RECAP_STEPS as readonly string[]).includes(value);
}

export interface RecapExcerptLine {
  id: string;
  /** 1-based position in the transcript. */
  n: number;
  arabic: string;
  translation?: string;
}

/** A watched video as the plan carries it: no transcript, only what the session cites. */
export interface RecapPlanVideo {
  id: string;
  title: string;
  dialect: string;
  cefrLevel: string | null;
  watchedAt: string;
  completed: boolean;
  /** The study guide's summary, when the video has a guide. */
  summary: string | null;
  culturalContext: string | null;
  lineCount: number;
  /** The lines the quiz and shadowing point at, with a neighbour either side; the opening lines otherwise. */
  excerpts: RecapExcerptLine[];
}

export interface RecapQuizItem extends QuizItem {
  videoId?: string;
  videoTitle?: string;
  /** True for a saved word that slipped in flashcard review rather than one saved in the window. */
  slipped?: boolean;
}

export interface RecapShadowLine extends ShadowLine {
  videoId: string;
  videoTitle: string;
}

export interface RecapPlan {
  version: number;
  /** The learner's local date the recap was built for (their "today"). */
  date: string;
  windowDays: number;
  since: string;
  until: string;
  dialect: string;
  /** The CEFR band the tutor pitches its language at. */
  level: string;
  steps: RecapStep[];
  videos: RecapPlanVideo[];
  quiz: RecapQuizItem[];
  shadow: RecapShadowLine[];
  slips: RecapSlip[];
  lessons: RecapLesson[];
  stories: string[];
  chats: string[];
  challenge: RecapChallenge | null;
  openQuestions: string[];
  counts: RecapCounts;
  /** How many quiz words the learner marked themselves, by how. */
  marked: { saved: number; lookedUp: number };
}

/** The steps this session runs: a step with nothing to do is skipped. */
export function recapSteps(plan: Pick<RecapPlan, "videos" | "quiz" | "slips" | "shadow">): RecapStep[] {
  return RECAP_STEPS.filter((step) => {
    switch (step) {
      case "retell":
        return plan.videos.length > 0;
      case "words":
        return plan.quiz.length > 0;
      case "slips":
        return plan.slips.length > 0;
      case "shadow":
        return plan.shadow.length > 0;
      default:
        return true;
    }
  });
}

/** Characters of transcript excerpt a plan carries across all its videos. */
export const EXCERPT_BUDGET = 3_000;
const EXCERPT_MIN_PER_VIDEO = 600;
const OPENING_LINES = 3;

function excerptsFor(video: RecapVideo, cited: Set<string>, budget: number): RecapExcerptLine[] {
  const { lines } = video;
  const keep = new Set<number>();
  lines.forEach((line, i) => {
    if (!cited.has(line.id)) return;
    for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 1); j++) keep.add(j);
  });
  if (keep.size === 0) for (let i = 0; i < Math.min(OPENING_LINES, lines.length); i++) keep.add(i);
  const out: RecapExcerptLine[] = [];
  let used = 0;
  for (const i of [...keep].sort((a, b) => a - b)) {
    const line = lines[i];
    const cost = line.arabic.length + (line.translation?.length ?? 0) + 8;
    if (used + cost > budget) break;
    used += cost;
    out.push({ id: line.id, n: i + 1, arabic: line.arabic, ...(line.translation ? { translation: line.translation } : {}) });
  }
  return out;
}

/** Saved rows that came from this video, by id or, for older rows, by their sentence. */
function savedFor(video: RecapVideo, saved: RecapSavedRow[]): RecapSavedRow[] {
  const sentences = new Set(video.lines.map((l) => normalizeArabic(l.arabic)));
  return saved.filter((row) => {
    if (row.source_video_id) return row.source_video_id === video.id;
    if (row.source && row.source !== "discover") return false;
    const sentence = normalizeArabic(row.sentence_text ?? "");
    return sentence.length > 0 && sentences.has(sentence);
  });
}

/**
 * The session for a window.
 *
 * The quiz is the learner's own marks, in the order the debrief uses: words
 * saved from a video (quizzed through the line they were said in), words
 * looked up and left, words saved anywhere else, and finally the words that
 * slipped in flashcard review. Nothing is topped up from a video's key
 * vocabulary — a recap is about what the learner did, not what they might
 * have. Shadowing takes a line that carries one of their words where it can,
 * then a guide's pick, at most two lines across the window. Slips are the
 * grouped learner errors, up to three.
 */
export function buildRecapPlan(
  window: RecapWindow,
  opts: { level: string | null | undefined; seed: string; quizSize?: number; shadowCount?: number },
): RecapPlan {
  const quizSize = opts.quizSize ?? 6;
  const shadowCount = opts.shadowCount ?? 2;
  const videos = [...window.videos].sort((a, b) => b.watchedAt.localeCompare(a.watchedAt));

  // Words, per video first so each gets the line it was spoken in.
  const focus: RecapQuizItem[] = [];
  const seen = new Set<string>();
  const claimedSaved = new Set<string>();
  const focusByVideo = new Map<string, FocusWord[]>();
  const add = (word: FocusWord, extra: Partial<RecapQuizItem> = {}) => {
    const key = normalizeArabic(word.arabic);
    if (!key || seen.has(key) || !word.english.trim()) return;
    seen.add(key);
    focus.push({ ...word, ...extra, id: "", options: [], answerIndex: -1 });
  };
  for (const video of videos) {
    const saved = savedFor(video, window.saved);
    saved.forEach((row) => claimedSaved.add(row.id));
    const lookups = window.lookups.filter((l) => l.video_id === video.id);
    const words = selectFocusWords({ saved, lookups, keyVocabulary: [], lines: video.lines, max: quizSize });
    focusByVideo.set(video.id, words);
    words.forEach((w) => add(w, { videoId: video.id, videoTitle: video.title }));
  }
  for (const row of window.saved) {
    if (claimedSaved.has(row.id)) continue;
    add({
      arabic: row.word_arabic.trim(),
      english: (row.word_english ?? "").trim(),
      source: "saved",
      vocabularyId: row.id,
      sentence: row.sentence_text ?? undefined,
      sentenceEnglish: row.sentence_english ?? undefined,
    });
  }
  for (const row of window.reviewSlips) {
    add(
      {
        arabic: row.word_arabic.trim(),
        english: (row.word_english ?? "").trim(),
        source: "saved",
        vocabularyId: row.id,
        sentence: row.sentence_text ?? undefined,
        sentenceEnglish: row.sentence_english ?? undefined,
      },
      { slipped: true },
    );
  }
  const chosen = focus.slice(0, quizSize);
  const pool = videos.flatMap((v) => (Array.isArray(v.keyVocabulary) ? (v.keyVocabulary as unknown[]) : []));
  const quizCards = buildWordQuiz(chosen, pool, opts.seed);
  const quiz: RecapQuizItem[] = quizCards.map((card, i) => ({
    ...chosen[i],
    ...card,
    id: `q${i + 1}`,
  }));

  // Lines to say aloud: the learner's own lines first, across the videos.
  const shadow: RecapShadowLine[] = [];
  const ownLines = videos.filter((v) => (focusByVideo.get(v.id) ?? []).some((w) => w.source !== "key_vocab"));
  for (const video of [...ownLines, ...videos.filter((v) => !ownLines.includes(v))]) {
    if (shadow.length >= shadowCount) break;
    const picks = video.guide?.shadow_picks ?? [];
    const lines = pickShadowLines(video.lines, picks, focusByVideo.get(video.id) ?? [], 1);
    for (const line of lines) {
      if (shadow.length >= shadowCount) break;
      shadow.push({ ...line, videoId: video.id, videoTitle: video.title });
    }
  }

  const cited = new Map<string, Set<string>>();
  const cite = (videoId: string | undefined, lineId: string | undefined) => {
    if (!videoId || !lineId) return;
    if (!cited.has(videoId)) cited.set(videoId, new Set());
    cited.get(videoId)!.add(lineId);
  };
  quiz.forEach((q) => cite(q.videoId, q.lineId));
  shadow.forEach((s) => cite(s.videoId, s.lineId));
  const perVideo = Math.max(EXCERPT_MIN_PER_VIDEO, Math.floor(EXCERPT_BUDGET / Math.max(1, videos.length)));

  const planVideos: RecapPlanVideo[] = videos.map((video) => ({
    id: video.id,
    title: video.title,
    dialect: video.dialect,
    cefrLevel: video.cefrLevel,
    watchedAt: video.watchedAt,
    completed: video.completed,
    summary: video.guide?.summary_en ?? null,
    culturalContext: video.culturalContext ? video.culturalContext.slice(0, 600) : null,
    lineCount: video.lines.length,
    excerpts: excerptsFor(video, cited.get(video.id) ?? new Set(), perVideo),
  }));

  const slips = groupSlips(window.errors);
  const partial = { videos: planVideos, quiz, slips, shadow };
  return {
    version: RECAP_VERSION,
    date: window.bounds.localDate,
    windowDays: window.bounds.days,
    since: window.bounds.since,
    until: window.bounds.until,
    dialect: window.dialect,
    level: normalizeCefr(opts.level),
    steps: recapSteps(partial),
    videos: planVideos,
    quiz,
    shadow,
    slips,
    lessons: window.lessons.slice(0, 5),
    stories: window.stories.slice(0, 4),
    chats: window.chats.slice(0, 4),
    challenge: window.challenge,
    openQuestions: window.openQuestions.slice(0, 3),
    counts: countWindow(window),
    marked: {
      saved: quiz.filter((q) => q.source === "saved" && !q.slipped).length,
      lookedUp: quiz.filter((q) => q.source === "looked_up").length,
    },
  };
}

/** A stored plan, if it is one this code can still read. */
export function parseStoredPlan(raw: unknown): RecapPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const plan = raw as Partial<RecapPlan>;
  if (plan.version !== RECAP_VERSION) return null;
  if (typeof plan.date !== "string" || typeof plan.dialect !== "string") return null;
  if (!Array.isArray(plan.steps) || !plan.steps.every(isRecapStep)) return null;
  if (!Array.isArray(plan.quiz) || !Array.isArray(plan.shadow) || !Array.isArray(plan.videos)) return null;
  if (!Array.isArray(plan.slips)) return null;
  return plan as RecapPlan;
}

// ── What the learner did on a card ─────────────────────────────────────────

export interface RecapOutcome {
  quiz: QuizOutcome[];
  shadow: ShadowOutcome[];
  stepsDone: RecapStep[];
}

const MAX_OUTCOME_ITEMS = 20;
const text = (value: unknown, max = 200) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** What a client may record about a finished session: the card results and the steps it reached. Nothing else. */
export function sanitizeOutcome(raw: unknown): RecapOutcome {
  const out: RecapOutcome = { quiz: [], shadow: [], stepsDone: [] };
  if (!raw || typeof raw !== "object") return out;
  const value = raw as Record<string, unknown>;
  if (Array.isArray(value.quiz)) {
    for (const item of value.quiz.slice(0, MAX_OUTCOME_ITEMS)) {
      if (!item || typeof item !== "object") continue;
      const q = item as Record<string, unknown>;
      const arabic = text(q.arabic);
      if (!arabic) continue;
      const outcome: QuizOutcome = { arabic, english: text(q.english), correct: q.correct === true };
      const chosen = text(q.chosen);
      if (chosen) outcome.chosen = chosen;
      out.quiz.push(outcome);
    }
  }
  if (Array.isArray(value.shadow)) {
    for (const item of value.shadow.slice(0, MAX_OUTCOME_ITEMS)) {
      if (!item || typeof item !== "object") continue;
      const s = item as Record<string, unknown>;
      const arabic = text(s.arabic);
      if (!arabic) continue;
      const score = typeof s.score === "number" && Number.isFinite(s.score) ? Math.max(0, Math.min(100, s.score)) : null;
      const outcome: ShadowOutcome = {
        lineNumber: typeof s.lineNumber === "number" ? s.lineNumber : 0,
        arabic,
        score,
      };
      const heard = text(s.heard);
      if (heard) outcome.heard = heard;
      out.shadow.push(outcome);
    }
  }
  if (Array.isArray(value.stepsDone)) {
    out.stepsDone = value.stepsDone.filter(isRecapStep).slice(0, RECAP_STEPS.length);
  }
  return out;
}

export { describeQuizResults, describeShadowResult };

// ── The conversation ───────────────────────────────────────────────────────

export interface RecapPromptContext {
  step: RecapStep;
  plan: RecapPlan;
  dialectLabel: string;
  /** The learner profile block, when one could be built. */
  learnerBlock?: string;
}

const sourceLabel: Record<FocusWord["source"], string> = {
  saved: "saved",
  looked_up: "looked up but not saved",
  key_vocab: "a key word",
};

function wordLine(q: RecapQuizItem): string {
  const where = q.slipped
    ? "slipped in flashcard review"
    : `${sourceLabel[q.source]}${q.videoTitle ? ` in "${q.videoTitle}"` : ""}`;
  const line = q.sentence ? ` — said in: ${q.sentence}` : "";
  return `- ${q.arabic} — ${q.english} (${where})${line}`;
}

function slipLine(slip: RecapSlip): string {
  const produced = slip.produced ? ` — they produced: ${slip.produced}` : "";
  const kinds = slip.kinds.length ? ` [${slip.kinds.join(", ")}]` : "";
  const where = slip.sources.length ? ` in ${slip.sources.join(", ")}` : "";
  const times = slip.count > 1 ? `, ${slip.count} times` : "";
  return `- Target: ${slip.target}${produced}${kinds}${where}${times}`;
}

/**
 * What the learner did, as the tutor's notes.
 *
 * Stable across a session's turns, so it sits in the prompt ahead of the step.
 * Videos carry their guide summary and the cited lines only; the full
 * transcript never travels — a recap turn is about remembering, not reading.
 */
export function recapNotesBlock(plan: RecapPlan): string {
  const label = windowLabel(plan.windowDays).toUpperCase();
  const parts: string[] = [`WHAT THE LEARNER DID ${label} (${plan.since.slice(0, 10)} to ${plan.until.slice(0, 10)}):`];

  if (plan.videos.length) {
    parts.push("Videos watched:");
    plan.videos.forEach((v, i) => {
      const level = v.cefrLevel ? ` (${v.cefrLevel})` : "";
      const finished = v.completed ? "" : " — not finished";
      parts.push(`${i + 1}. "${v.title}"${level}${finished}`);
      if (v.summary) parts.push(`   Summary: ${v.summary}`);
      if (v.culturalContext) parts.push(`   Context: ${v.culturalContext}`);
      if (v.excerpts.length) {
        const shown = v.excerpts.map((l) => `   ${l.n}. ${l.arabic}${l.translation ? ` — ${l.translation}` : ""}`);
        parts.push(`   Lines (of ${v.lineCount}; only these are shown — never guess what the others say):`, ...shown);
      }
    });
  } else {
    parts.push("Videos watched: none.");
  }

  const marked = plan.quiz;
  parts.push(marked.length ? `Words (${marked.length}):\n${marked.map(wordLine).join("\n")}` : "Words saved or looked up: none.");
  parts.push(plan.slips.length ? `Slips recorded:\n${plan.slips.map(slipLine).join("\n")}` : "Slips recorded: none.");
  if (plan.lessons.length) {
    parts.push(
      `Lessons: ${plan.lessons.map((l) => `"${l.title}"${l.titleArabic ? ` (${l.titleArabic})` : ""} — ${l.status}`).join("; ")}`,
    );
  }
  if (plan.stories.length) parts.push(`Stories read: ${plan.stories.map((s) => `"${s}"`).join("; ")}`);
  if (plan.chats.length) parts.push(`Things they asked the tutor about: ${plan.chats.map((c) => `"${c}"`).join("; ")}`);
  if (plan.challenge) parts.push(`Daily challenge: ${plan.challenge.score} of ${plan.challenge.max}.`);
  if (plan.openQuestions.length) {
    parts.push(`Open questions from earlier conversations:\n${plan.openQuestions.map((q) => `- ${q}`).join("\n")}`);
  }
  return parts.join("\n");
}

function stepBrief(ctx: RecapPromptContext): string {
  const { plan } = ctx;
  const when = windowLabel(plan.windowDays);
  const wordList = plan.quiz.map((q) => q.arabic).join(", ");
  const shadowList = plan.shadow
    .map((s) => `line ${s.lineNumber} of "${s.videoTitle}": ${s.arabic}${s.why ? ` — ${s.why}` : ""}`)
    .join("\n");
  switch (ctx.step) {
    case "yesterday":
      return `Open with two or three short sentences telling the learner what they did ${when}, from your notes — name the video, say how many words they saved, mention a slip if there is one — warmly, like a coach reading their file back to them, never as a list. Then ask ONE question: which part of ${when} they remember best, or what the clip was about in a sentence. When they answer, respond in one or two lines and finish with the marker.`;
    case "retell":
      return `Take the videos one at a time, in order. For each, ask the learner to tell you in their own words what happened in it (in ${ctx.dialectLabel} if they can). Compare what they say with the summary in your notes: say what they got right, add ONE important thing they missed, and quote one of the lines you were given. If they are stuck, give a hint from the summary before telling them. A video with no summary in your notes: ask what they remember and respond to that; do not invent its content. After the last video, finish with the marker.`;
    case "words":
      return `The app is about to show the learner a quick card for each of these words, where they choose the meaning: ${wordList}.
- If the conversation does not yet contain the "(Quiz finished …)" message: write ONE short line introducing the quiz as the words from ${when}. Do not quiz them yourself and do not give any meanings. Do not use the marker.
- Once it does: react to the results. For each word they missed, explain it through the line it came from (quote the line from your notes when there is one), with a tiny memory hook if a natural one exists. Praise what they knew in one line. Then finish with the marker.`;
    case "slips":
      return `Work through the slips in your notes one at a time. For each: show what they produced next to the right form (both in Arabic, with a transliteration in brackets), explain the difference in one line, and ask them to use the right form in a new sentence of their own. Judge the sentence: if the form is right, say so and go to the next slip; if not, correct it gently and ask once more, then move on either way. Never tease — a slip that was recorded is a slip half fixed. After the last slip, finish with the marker.`;
    case "shadow":
      return `The app will show a card for shadowing these lines from ${when}'s videos (listen to the native clip, then say it at the same speed):
${shadowList}
- Before any "(Shadowed …)" or "(Skipped …)" message: write one or two short sentences on why this line is worth saying aloud, and the tip: listen first, then copy the rhythm, not just the words. Do not use the marker.
- After each result: one or two sentences of feedback from the score and from what the recogniser heard compared with the line. Be encouraging and name at most one specific word or sound to work on. Finish with the marker only once every line has a result, or if the learner says they want to move on.`;
    case "recap":
      return `Write the recap in markdown: 3–5 short bullets — what they remembered well, the words to keep reviewing (the missed quiz words, each with the line it came from), the slip to watch for, and ONE thing from ${when} to use today. Then a one-line goodbye, and finish with the marker.`;
  }
}

/**
 * The tutor's system prompt for one turn.
 *
 * Stable-first, as the debrief's is: the notes about the window and the
 * learner are the same on every turn of a session, so they sit ahead of the
 * per-step brief.
 */
export function recapSystemPrompt(ctx: RecapPromptContext): string {
  const { plan } = ctx;
  const position = plan.steps.indexOf(ctx.step) + 1;
  const total = plan.steps.length;
  return `You are Hikaya's tutor, going over a learner's ${windowLabel(plan.windowDays)} in the app with them the next morning. Everything they did is in your notes below; the point of the session is to bring it back — the clip, the words, the slip — while it is still fresh, so it stays. The session is a guided conversation in steps. You are on step ${position} of ${total}: "${RECAP_STEP_LABELS[ctx.step]}".

LANGUAGE: ${tutorLanguageRule(plan.level, ctx.dialectLabel)}
STYLE: Warm and brief — one to four short sentences a message (the recap may be longer). One question at a time; never lecture. When you quote a video, copy its Arabic exactly as in your notes, then a transliteration in brackets. Your own Arabic is always spoken ${ctx.dialectLabel}, never Modern Standard Arabic. Never claim they did something that is not in your notes.
${ctx.learnerBlock ? `\n${ctx.learnerBlock}\n` : ""}
${recapNotesBlock(plan)}

THIS STEP:
${stepBrief(ctx)}

FINISHING A STEP: when this step's goal is met, end your message with ${STEP_DONE_MARKER} on its own line — the app turns it into a Continue button, so never mention it. Do not use it at any other time, and never start the next step yourself. Messages in brackets such as "(Quiz finished …)" are reports from the app about what the learner just did, not things they typed.`;
}

/** A turn that opens a step has no learner message to answer; this stands in for one. */
export function recapStepKickoff(step: RecapStep): string {
  return `(The learner is ready for "${RECAP_STEP_LABELS[step]}".)`;
}

/** Everything in a plan a native-speaker reviewer must not judge: it is not the tutor's own Arabic. */
export function planArabicSources(plan: RecapPlan): string[] {
  return [
    ...plan.videos.flatMap((v) => v.excerpts.map((l) => l.arabic)),
    ...plan.quiz.map((q) => q.arabic),
    ...plan.quiz.flatMap((q) => (q.sentence ? [q.sentence] : [])),
    ...plan.shadow.map((s) => s.arabic),
    ...plan.slips.flatMap((s) => (s.produced ? [s.target, s.produced] : [s.target])),
  ];
}
