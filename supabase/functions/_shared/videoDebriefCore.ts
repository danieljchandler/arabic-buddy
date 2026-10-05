/**
 * The post-video debrief — the pure half.
 *
 * A learner who has just watched a video can ask to be talked through it: a
 * gist question, a few comprehension questions, a quiz on the words they were
 * unsure of, one or two lines to shadow, then whatever they still want to ask.
 * Two layers feed that conversation, and this module is the seam between them.
 *
 *   - The **study guide** is per video and the same for everyone: a summary,
 *     the questions with their answer key, lines worth shadowing, talking
 *     points. It is written once from the transcript and its translations
 *     (`videoStudyGuide.ts`) and cached, so a debrief turn never has to make a
 *     model re-read the transcript to work out what the video was about.
 *   - The **learner's marks** are live: the words they saved from this video,
 *     the words they looked up and did not save. They are read from the
 *     database on every request, never accepted from the client.
 *
 * Everything here is deterministic — prompts, validation, word and line
 * selection, the quiz itself — so the client (which imports the types and the
 * step list) and both edge functions agree on one shape, and all of it is
 * unit-tested in `src/test/videoDebriefCore.test.ts`.
 */
import { normalizeArabic } from "./arabicMatch.ts";
import { isOnScreenLine } from "./onScreenText.ts";

/** Bump when the guide's shape or prompt changes enough to be worth regenerating. */
export const STUDY_GUIDE_VERSION = 1;

// ── Transcript ─────────────────────────────────────────────────────────────

/** One spoken line, as much of `TranscriptLine` as the debrief reads. */
export interface DebriefLine {
  id: string;
  arabic: string;
  translation?: string;
  startMs?: number;
  endMs?: number;
  tokens?: Array<{ surface?: string; gloss?: string }>;
}

/**
 * The spoken lines of a stored transcript.
 *
 * Overlays appended by older pipeline runs are dropped for the same reason
 * every other reader drops them: a caption is not something anyone said, and
 * a question about "what he said" must not be answered from one.
 */
export function spokenLines(raw: unknown): DebriefLine[] {
  if (!Array.isArray(raw)) return [];
  const out: DebriefLine[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || isOnScreenLine(entry)) continue;
    const row = entry as Record<string, unknown>;
    const id = typeof row.id === "string" || typeof row.id === "number" ? String(row.id) : "";
    const arabic = typeof row.arabic === "string" ? row.arabic.trim() : "";
    if (!id || !arabic) continue;
    const line: DebriefLine = { id, arabic };
    if (typeof row.translation === "string" && row.translation.trim()) line.translation = row.translation.trim();
    if (typeof row.startMs === "number" && Number.isFinite(row.startMs)) line.startMs = row.startMs;
    if (typeof row.endMs === "number" && Number.isFinite(row.endMs)) line.endMs = row.endMs;
    if (Array.isArray(row.tokens)) {
      line.tokens = (row.tokens as unknown[])
        .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
        .map((t) => ({
          surface: typeof t.surface === "string" ? t.surface : undefined,
          gloss: typeof t.gloss === "string" ? t.gloss : undefined,
        }));
    }
    out.push(line);
  }
  return out;
}

/**
 * A fingerprint of what the guide was written from.
 *
 * Reviewers keep correcting transcripts after ingest — merging lines, fixing
 * words, rewriting translations — and a guide that cites line 7 of a
 * transcript that no longer has a line 7 sends the learner looking for
 * something that is not there. Ids, Arabic and English all count; timings do
 * not, since a resync moves no words. FNV-1a, because it only has to notice a
 * change, and it has to run synchronously in the browser too.
 */
export function transcriptHash(lines: DebriefLine[]): string {
  let hash = 0x811c9dc5;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  };
  for (const line of lines) {
    feed(line.id);
    feed("\u0001");
    feed(line.arabic);
    feed("\u0001");
    feed(line.translation ?? "");
    feed("\u0002");
  }
  return `${lines.length}:${hash.toString(16).padStart(8, "0")}`;
}

/** Whether a stored guide still describes this transcript. */
export function guideIsCurrent(
  stored: { version?: number | null; transcript_hash?: string | null } | null | undefined,
  lines: DebriefLine[],
): boolean {
  if (!stored) return false;
  return stored.version === STUDY_GUIDE_VERSION && stored.transcript_hash === transcriptHash(lines);
}

// ── The study guide ────────────────────────────────────────────────────────

export interface GuideQuestion {
  question_en: string;
  /** The same question in the video's dialect, for learners past A2. */
  question_ar: string;
  /** What a good answer contains — the tutor's key, never shown to the learner. */
  answer_en: string;
  /** Lines that carry the answer, by id. */
  line_ids: string[];
}

export interface GuideShadowPick {
  line_id: string;
  why: string;
}

export interface GuideTalkingPoint {
  prompt_en: string;
  prompt_ar: string;
}

export interface GuideKeyPhrase {
  /** Exactly as it appears in the transcript. */
  arabic: string;
  english: string;
  note: string;
  line_id?: string;
}

export interface VideoStudyGuide {
  version: number;
  summary_en: string;
  gist: GuideQuestion;
  comprehension: GuideQuestion[];
  shadow_picks: GuideShadowPick[];
  talking_points: GuideTalkingPoint[];
  key_phrases: GuideKeyPhrase[];
}

export const GUIDE_LIMITS = {
  comprehension: 5,
  shadowPicks: 4,
  talkingPoints: 3,
  keyPhrases: 6,
  summary: 800,
  question: 300,
  answer: 500,
  note: 240,
  /** Characters of numbered transcript the generator is shown. */
  transcript: 24_000,
} as const;

/** What the generator needs to know about the video, beyond its lines. */
export interface GuideVideoInfo {
  title: string;
  dialectLabel: string;
  cefrLevel?: string | null;
  culturalContext?: string | null;
  isMeme?: boolean | null;
  vocabulary?: unknown;
  grammarPoints?: unknown;
}

const lineRef = { type: "array", items: { type: "integer" }, description: "Transcript line numbers." };
const questionSchema = {
  type: "object",
  properties: {
    question_en: { type: "string" },
    question_ar: { type: "string" },
    answer_en: { type: "string" },
    lines: lineRef,
  },
  required: ["question_en", "question_ar", "answer_en", "lines"],
};

/** The structured-output tool the generator answers through. */
export const STUDY_GUIDE_TOOL = {
  name: "emit_study_guide",
  description: "Tutor's notes on one video: summary, questions with answers, lines to shadow, talking points.",
  parameters: {
    type: "object",
    properties: {
      summary_en: { type: "string" },
      gist: questionSchema,
      comprehension: { type: "array", items: questionSchema },
      shadow_picks: {
        type: "array",
        items: {
          type: "object",
          properties: { line: { type: "integer" }, why: { type: "string" } },
          required: ["line", "why"],
        },
      },
      talking_points: {
        type: "array",
        items: {
          type: "object",
          properties: { prompt_en: { type: "string" }, prompt_ar: { type: "string" } },
          required: ["prompt_en", "prompt_ar"],
        },
      },
      key_phrases: {
        type: "array",
        items: {
          type: "object",
          properties: {
            arabic: { type: "string" },
            english: { type: "string" },
            note: { type: "string" },
            line: { type: "integer" },
          },
          required: ["arabic", "english", "note"],
        },
      },
    },
    required: ["summary_en", "gist", "comprehension", "shadow_picks", "talking_points", "key_phrases"],
  },
} as const;

function vocabularyList(raw: unknown): Array<{ arabic: string; english?: string }> {
  return parseKeyVocabulary(raw).slice(0, 25);
}

function grammarList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((g) => {
      if (typeof g === "string") return g.trim();
      if (g && typeof g === "object") {
        const row = g as Record<string, unknown>;
        const title = typeof row.title === "string" ? row.title : typeof row.point === "string" ? row.point : "";
        return title.trim();
      }
      return "";
    })
    .filter(Boolean)
    .slice(0, 10);
}

/**
 * The numbered transcript the generator reads, inside a character budget.
 *
 * Numbered rather than keyed by id: models cite "line 4" far more reliably
 * than an opaque id, and `sanitizeGuide` maps the numbers back. A transcript
 * over budget is cut at a line boundary and says so, rather than being
 * sampled — a guide built from the first ten minutes is honest; one built from
 * a scatter of lines would ask about a plot it never saw.
 */
export function numberedTranscript(lines: DebriefLine[], budget: number = GUIDE_LIMITS.transcript): string {
  const out: string[] = [];
  let used = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = `${i + 1}. ${line.arabic}${line.translation ? ` — ${line.translation}` : ""}`;
    if (used + text.length > budget && out.length > 0) {
      out.push(`… the remaining ${lines.length - i} lines are not shown.`);
      break;
    }
    out.push(text);
    used += text.length + 1;
  }
  return out.join("\n");
}

export function guideSystemPrompt(dialectLabel: string): string {
  return `You are writing a tutor's private notes on one short video in spoken ${dialectLabel}. Later, a tutor will use them to talk a learner through the video they have just watched with subtitles — without re-reading the transcript. Work only from the transcript and notes you are given. Never invent events, speakers, words or lines that are not there. If the video is a meme or a skit, say plainly what the joke is.

Return, through the tool:
- summary_en: 2–4 plain English sentences: who is speaking, what happens, and the point or the joke.
- gist: ONE open question about the overall point of the video, answerable in a sentence by someone who understood it. question_en; question_ar (the same question in natural, simple ${dialectLabel} — spoken dialect, never Modern Standard Arabic); answer_en (what a good answer contains); lines (the line numbers that carry the answer).
- comprehension: 3 questions (2 if the video has fewer than 6 lines), in the order the video answers them, each about a specific moment — what someone wants, why something happens, what a phrase means here. Mix literal and inferential. No yes/no questions. Same fields as gist.
- shadow_picks: 2–4 lines worth repeating aloud: short (3–10 words), natural, high-frequency phrases a learner would really use. Avoid names, numbers, song lyrics and lines that are mostly laughter. line + why (one short sentence on what makes it useful).
- talking_points: 1–3 open prompts for a short chat after the questions — the learner's own opinion or experience, related to the video. prompt_en + prompt_ar (simple ${dialectLabel}).
- key_phrases: up to 6 idioms or expressions from the video worth explaining, copied EXACTLY as they appear in the transcript, with english, a one-sentence note on how it is used, and the line.

Line numbers always refer to the numbered transcript.`;
}

export function guideUserPrompt(video: GuideVideoInfo, lines: DebriefLine[]): string {
  const vocab = vocabularyList(video.vocabulary);
  const grammar = grammarList(video.grammarPoints);
  const header = [
    `Title: ${video.title}`,
    `Dialect: ${video.dialectLabel}`,
    video.cefrLevel ? `Level: ${video.cefrLevel}` : "",
    video.isMeme ? "This is a meme / short skit." : "",
    video.culturalContext ? `Cultural context: ${video.culturalContext.slice(0, 1200)}` : "",
    vocab.length ? `Key vocabulary: ${vocab.map((v) => (v.english ? `${v.arabic} (${v.english})` : v.arabic)).join("، ")}` : "",
    grammar.length ? `Grammar points: ${grammar.join("; ")}` : "",
  ].filter(Boolean);
  return `${header.join("\n")}\n\nTranscript (${lines.length} lines):\n${numberedTranscript(lines)}`;
}

function str(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

function lineIdsFrom(value: unknown, lines: DebriefLine[]): string[] {
  const numbers = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const ids: string[] = [];
  for (const n of numbers) {
    const index = typeof n === "number" ? n : typeof n === "string" ? Number.parseInt(n, 10) : NaN;
    const line = Number.isInteger(index) ? lines[index - 1] : undefined;
    if (line && !ids.includes(line.id)) ids.push(line.id);
  }
  return ids;
}

function questionFrom(raw: unknown, lines: DebriefLine[]): GuideQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const question_en = str(row.question_en, GUIDE_LIMITS.question);
  const answer_en = str(row.answer_en, GUIDE_LIMITS.answer);
  if (!question_en || !answer_en) return null;
  return {
    question_en,
    question_ar: str(row.question_ar, GUIDE_LIMITS.question),
    answer_en,
    line_ids: lineIdsFrom(row.lines ?? row.line_ids, lines),
  };
}

/** True when `phrase` occurs in the transcript, ignoring tashkeel and spelling variants. */
function occursIn(phrase: string, lines: DebriefLine[]): DebriefLine | undefined {
  const needle = normalizeArabic(phrase);
  if (!needle) return undefined;
  return lines.find((line) => normalizeArabic(line.arabic).includes(needle));
}

/**
 * Validate what the generator returned, against the transcript it was given.
 *
 * The answer is a model's, so nothing in it is trusted by shape alone: line
 * numbers are mapped back to ids and dropped when they point nowhere, counts
 * are clamped, and a key phrase must actually occur in the transcript — a
 * "quote" the video never contained would be taught to the learner as
 * something a native speaker said. Returns null when there is not enough left
 * to run a debrief on (no summary, or no question at all).
 */
export function sanitizeGuide(raw: unknown, lines: DebriefLine[]): VideoStudyGuide | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const summary_en = str(row.summary_en, GUIDE_LIMITS.summary);
  if (!summary_en) return null;

  const comprehension = (Array.isArray(row.comprehension) ? row.comprehension : [])
    .map((q) => questionFrom(q, lines))
    .filter((q): q is GuideQuestion => q !== null)
    .slice(0, GUIDE_LIMITS.comprehension);
  const gist = questionFrom(row.gist, lines) ?? comprehension[0] ?? null;
  if (!gist) return null;

  const shadow_picks: GuideShadowPick[] = [];
  for (const pick of Array.isArray(row.shadow_picks) ? row.shadow_picks : []) {
    if (!pick || typeof pick !== "object") continue;
    const p = pick as Record<string, unknown>;
    const [line_id] = lineIdsFrom(p.line ?? p.line_id, lines);
    if (!line_id || shadow_picks.some((s) => s.line_id === line_id)) continue;
    shadow_picks.push({ line_id, why: str(p.why, GUIDE_LIMITS.note) });
    if (shadow_picks.length >= GUIDE_LIMITS.shadowPicks) break;
  }

  const talking_points = (Array.isArray(row.talking_points) ? row.talking_points : [])
    .map((t) => {
      if (!t || typeof t !== "object") return null;
      const tp = t as Record<string, unknown>;
      const prompt_en = str(tp.prompt_en, GUIDE_LIMITS.question);
      return prompt_en ? { prompt_en, prompt_ar: str(tp.prompt_ar, GUIDE_LIMITS.question) } : null;
    })
    .filter((t): t is GuideTalkingPoint => t !== null)
    .slice(0, GUIDE_LIMITS.talkingPoints);

  const key_phrases: GuideKeyPhrase[] = [];
  for (const phrase of Array.isArray(row.key_phrases) ? row.key_phrases : []) {
    if (!phrase || typeof phrase !== "object") continue;
    const kp = phrase as Record<string, unknown>;
    const arabic = str(kp.arabic, 120);
    const english = str(kp.english, 160);
    const found = arabic ? occursIn(arabic, lines) : undefined;
    if (!arabic || !english || !found) continue;
    const [cited] = lineIdsFrom(kp.line, lines);
    key_phrases.push({ arabic, english, note: str(kp.note, GUIDE_LIMITS.note), line_id: cited ?? found.id });
    if (key_phrases.length >= GUIDE_LIMITS.keyPhrases) break;
  }

  return {
    version: STUDY_GUIDE_VERSION,
    summary_en,
    gist,
    comprehension,
    shadow_picks,
    talking_points,
    key_phrases,
  };
}

/**
 * The Arabic the generator authored — what the MSA check may look at.
 *
 * Only the questions and prompts it wrote. Key phrases are excluded on
 * purpose: they are quotes from a native speaker, and "repairing" them would
 * mean the app correcting the video.
 */
export function guideAuthoredArabic(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const row = raw as Record<string, unknown>;
  const questions = [row.gist, ...(Array.isArray(row.comprehension) ? row.comprehension : [])];
  const out: string[] = [];
  for (const q of questions) {
    if (q && typeof q === "object" && typeof (q as Record<string, unknown>).question_ar === "string") {
      out.push((q as Record<string, unknown>).question_ar as string);
    }
  }
  for (const t of Array.isArray(row.talking_points) ? row.talking_points : []) {
    if (t && typeof t === "object" && typeof (t as Record<string, unknown>).prompt_ar === "string") {
      out.push((t as Record<string, unknown>).prompt_ar as string);
    }
  }
  return out.filter(Boolean).join("\n");
}

/**
 * A stored guide, read back out of jsonb.
 *
 * Stored guides were sanitised on the way in, but a reviewer may have merged
 * or deleted lines since, so every line reference is re-checked against the
 * transcript as it is now and a dangling one is dropped.
 */
export function parseStoredGuide(raw: unknown, lines: DebriefLine[]): VideoStudyGuide | null {
  if (!raw || typeof raw !== "object") return null;
  const known = new Set(lines.map((l) => l.id));
  const row = raw as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const keepIds = (ids: unknown) =>
    Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string" && known.has(id)) : [];
  const question = (q: unknown): GuideQuestion | null => {
    if (!q || typeof q !== "object") return null;
    const r = q as Record<string, unknown>;
    if (!text(r.question_en)) return null;
    return {
      question_en: text(r.question_en),
      question_ar: text(r.question_ar),
      answer_en: text(r.answer_en),
      line_ids: keepIds(r.line_ids),
    };
  };
  const objects = (value: unknown) =>
    (Array.isArray(value) ? value : []).filter((v): v is Record<string, unknown> => !!v && typeof v === "object");

  const gist = question(row.gist);
  if (!text(row.summary_en) || !gist) return null;
  return {
    version: typeof row.version === "number" ? row.version : STUDY_GUIDE_VERSION,
    summary_en: text(row.summary_en),
    gist,
    comprehension: objects(row.comprehension).map(question).filter((q): q is GuideQuestion => q !== null),
    shadow_picks: objects(row.shadow_picks)
      .filter((p) => typeof p.line_id === "string" && known.has(p.line_id))
      .map((p) => ({ line_id: p.line_id as string, why: text(p.why) })),
    talking_points: objects(row.talking_points)
      .filter((t) => text(t.prompt_en))
      .map((t) => ({ prompt_en: text(t.prompt_en), prompt_ar: text(t.prompt_ar) })),
    key_phrases: objects(row.key_phrases)
      .filter((k) => text(k.arabic) && text(k.english))
      .map((k) => ({
        arabic: text(k.arabic),
        english: text(k.english),
        note: text(k.note),
        line_id: typeof k.line_id === "string" && known.has(k.line_id) ? k.line_id : undefined,
      })),
  };
}

// ── The learner's marks ────────────────────────────────────────────────────

export type FocusSource = "saved" | "looked_up" | "key_vocab";

/** A `user_vocabulary` row, as much of it as the debrief reads. */
export interface SavedWordRow {
  id: string;
  word_arabic: string;
  word_english: string | null;
  sentence_text?: string | null;
  sentence_english?: string | null;
  source?: string | null;
  source_video_id?: string | null;
}

/** A `video_word_lookups` row. */
export interface LookupRow {
  word_arabic: string;
  word_english?: string | null;
  line_id?: string | null;
}

/** One word the debrief will quiz on, with where it came from. */
export interface FocusWord {
  arabic: string;
  english: string;
  source: FocusSource;
  /** The `user_vocabulary` row, for a saved word — what an answer reschedules. */
  vocabularyId?: string;
  lineId?: string;
  sentence?: string;
  sentenceEnglish?: string;
}

/** `discover_videos.vocabulary`, whichever of its historical key spellings a row uses. */
export function parseKeyVocabulary(raw: unknown): Array<{ arabic: string; english?: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ arabic: string; english?: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const arabic = String(row.arabic ?? row.word ?? "").trim();
    const englishRaw = row.english ?? row.translation;
    const english = typeof englishRaw === "string" ? englishRaw.trim() : "";
    if (arabic) out.push(english ? { arabic, english } : { arabic });
  }
  return out;
}

function lineByText(text: string | null | undefined, lines: DebriefLine[]): DebriefLine | undefined {
  const needle = normalizeArabic(text ?? "");
  if (!needle) return undefined;
  return lines.find((line) => normalizeArabic(line.arabic) === needle);
}

/** The first line the word is spoken in, matched word-for-word after normalising. */
export function lineContaining(word: string, lines: DebriefLine[]): DebriefLine | undefined {
  const needle = normalizeArabic(word);
  if (!needle) return undefined;
  const parts = needle.split(" ");
  return lines.find((line) => {
    const words = normalizeArabic(line.arabic).split(" ");
    for (let i = 0; i + parts.length <= words.length; i++) {
      if (parts.every((p, j) => words[i + j] === p)) return true;
    }
    return false;
  });
}

/**
 * The saved words that came from this video.
 *
 * Words saved since `source_video_id` exists say so directly. Everything saved
 * before it only says "discover", so those are matched by the sentence the
 * word was saved with — the video page stores the whole line, which makes an
 * exact match on the normalised text a reliable test rather than a guess.
 */
export function savedWordsForVideo(
  rows: SavedWordRow[],
  videoId: string,
  lines: DebriefLine[],
): SavedWordRow[] {
  return rows.filter((row) => {
    if (row.source_video_id) return row.source_video_id === videoId;
    if (row.source && row.source !== "discover") return false;
    return lineByText(row.sentence_text, lines) !== undefined;
  });
}

function glossFromTokens(word: string, line: DebriefLine | undefined): string | undefined {
  if (!line?.tokens) return undefined;
  const needle = normalizeArabic(word);
  const token = line.tokens.find((t) => t.surface && normalizeArabic(t.surface) === needle);
  const gloss = token?.gloss?.trim();
  // The pipeline marks a compound's later words "(→ first word)"; that is a
  // pointer, not a meaning.
  return gloss && !gloss.startsWith("(→") ? gloss : undefined;
}

/**
 * Which words to quiz, in priority order.
 *
 * Saved words first — the learner chose them — then words they looked up and
 * left, then the video's own key vocabulary to make up the number. A word is
 * only quizzable with a meaning to quiz it against, so one with no gloss
 * anywhere (row, transcript token, key-vocabulary list) is left out rather
 * than asked about with nothing to mark the answer by.
 */
export function selectFocusWords(input: {
  saved: SavedWordRow[];
  lookups: LookupRow[];
  keyVocabulary: unknown;
  lines: DebriefLine[];
  max?: number;
}): FocusWord[] {
  const max = input.max ?? 5;
  const keyVocab = parseKeyVocabulary(input.keyVocabulary);
  const keyGloss = new Map(keyVocab.filter((v) => v.english).map((v) => [normalizeArabic(v.arabic), v.english!]));
  const seen = new Set<string>();
  const out: FocusWord[] = [];

  const add = (word: FocusWord) => {
    const key = normalizeArabic(word.arabic);
    if (!key || seen.has(key) || !word.english.trim() || out.length >= max) return;
    seen.add(key);
    out.push(word);
  };

  for (const row of input.saved) {
    const line = lineByText(row.sentence_text, input.lines) ?? lineContaining(row.word_arabic, input.lines);
    add({
      arabic: row.word_arabic.trim(),
      english: (row.word_english ?? "").trim() || glossFromTokens(row.word_arabic, line) || "",
      source: "saved",
      vocabularyId: row.id,
      lineId: line?.id,
      sentence: line?.arabic ?? row.sentence_text ?? undefined,
      sentenceEnglish: line?.translation ?? row.sentence_english ?? undefined,
    });
  }

  for (const row of input.lookups) {
    const line = (row.line_id ? input.lines.find((l) => l.id === row.line_id) : undefined) ??
      lineContaining(row.word_arabic, input.lines);
    add({
      arabic: row.word_arabic.trim(),
      english: (row.word_english ?? "").trim() ||
        glossFromTokens(row.word_arabic, line) ||
        keyGloss.get(normalizeArabic(row.word_arabic)) ||
        "",
      source: "looked_up",
      lineId: line?.id,
      sentence: line?.arabic,
      sentenceEnglish: line?.translation,
    });
  }

  for (const item of keyVocab) {
    const line = lineContaining(item.arabic, input.lines);
    add({
      arabic: item.arabic,
      english: item.english ?? "",
      source: "key_vocab",
      lineId: line?.id,
      sentence: line?.arabic,
      sentenceEnglish: line?.translation,
    });
  }

  return out;
}

// ── The word quiz ──────────────────────────────────────────────────────────

export interface QuizItem extends FocusWord {
  id: string;
  /** Meanings to choose from; empty when there are too few to make a fair choice (the card turns into recall). */
  options: string[];
  /** Index of the right meaning in `options`, or -1 for a recall card. */
  answerIndex: number;
}

/** A small seeded PRNG (mulberry32), so a plan is stable across reloads. */
function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const sameMeaning = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Multiple-choice cards for the focus words.
 *
 * The wrong options are meanings of *other* words from the same video — the
 * learner has met all of them in the last few minutes, so a card cannot be
 * passed by spotting the one gloss that looks out of place. With fewer than
 * two other meanings available the card falls back to recall (reveal, then
 * say whether you knew it), which is still a retrieval rather than a gift.
 */
export function buildWordQuiz(focus: FocusWord[], keyVocabulary: unknown, seed: string): QuizItem[] {
  const pool: string[] = [];
  const addToPool = (gloss: string | undefined) => {
    const g = gloss?.trim();
    if (g && !pool.some((p) => sameMeaning(p, g))) pool.push(g);
  };
  focus.forEach((f) => addToPool(f.english));
  parseKeyVocabulary(keyVocabulary).forEach((v) => addToPool(v.english));

  return focus.map((word, index) => {
    const random = seededRandom(`${seed}:${word.arabic}`);
    const distractors = shuffled(
      pool.filter((p) => !sameMeaning(p, word.english)),
      random,
    ).slice(0, 3);
    const base = { ...word, id: `q${index + 1}` };
    if (distractors.length < 2) return { ...base, options: [], answerIndex: -1 };
    const options = shuffled([word.english, ...distractors], random);
    return { ...base, options, answerIndex: options.findIndex((o) => o === word.english) };
  });
}

// ── Lines to shadow ────────────────────────────────────────────────────────

export interface ShadowLine {
  lineId: string;
  lineNumber: number;
  arabic: string;
  translation?: string;
  startMs: number;
  endMs: number;
  why?: string;
}

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

function shadowable(line: DebriefLine): line is DebriefLine & { startMs: number; endMs: number } {
  if (typeof line.startMs !== "number" || typeof line.endMs !== "number") return false;
  const ms = line.endMs - line.startMs;
  const words = wordCount(line.arabic);
  return ms >= 700 && ms <= 9000 && words >= 2 && words <= 14;
}

/**
 * One or two lines to shadow.
 *
 * Only lines with real timings and a sayable length qualify — the shadowing
 * card plays the native clip, so a line with no place on the timeline has
 * nothing to repeat after. Among those, a line that carries one of the
 * learner's own words wins (saying the word aloud in its sentence is the
 * point), then the guide's picks, then a short line from the middle of the
 * video as a last resort.
 */
export function pickShadowLines(
  lines: DebriefLine[],
  picks: GuideShadowPick[],
  focus: FocusWord[],
  max = 2,
): ShadowLine[] {
  const numberOf = new Map(lines.map((l, i) => [l.id, i + 1]));
  const byId = new Map(lines.map((l) => [l.id, l]));
  const why = new Map(picks.map((p) => [p.line_id, p.why]));
  const chosen: ShadowLine[] = [];
  const take = (line: DebriefLine | undefined) => {
    if (!line || chosen.length >= max || chosen.some((c) => c.lineId === line.id) || !shadowable(line)) return;
    chosen.push({
      lineId: line.id,
      lineNumber: numberOf.get(line.id) ?? 0,
      arabic: line.arabic,
      translation: line.translation,
      startMs: line.startMs,
      endMs: line.endMs,
      why: why.get(line.id) || undefined,
    });
  };

  const learnerLines = focus
    .filter((f) => f.source !== "key_vocab" && f.lineId)
    .map((f) => byId.get(f.lineId!));
  // A learner's line that the guide also picked is the best of both.
  learnerLines.filter((l) => l && why.has(l.id)).forEach(take);
  learnerLines.forEach(take);
  picks.forEach((p) => take(byId.get(p.line_id)));
  const middle = Math.floor(lines.length / 2);
  [...lines]
    .map((line, i) => ({ line, distance: Math.abs(i - middle) }))
    .filter(({ line }) => wordCount(line.arabic) >= 3 && wordCount(line.arabic) <= 10)
    .sort((a, b) => a.distance - b.distance)
    .forEach(({ line }) => take(line));

  return chosen.sort((a, b) => a.lineNumber - b.lineNumber);
}

// ── The conversation ───────────────────────────────────────────────────────

export type DebriefStep = "gist" | "comprehension" | "words" | "shadow" | "questions" | "recap";

export const DEBRIEF_STEPS: readonly DebriefStep[] = [
  "gist",
  "comprehension",
  "words",
  "shadow",
  "questions",
  "recap",
];

export const STEP_LABELS: Record<DebriefStep, string> = {
  gist: "The gist",
  comprehension: "What happened",
  words: "Your words",
  shadow: "Say it",
  questions: "Your questions",
  recap: "Recap",
};

export function isDebriefStep(value: unknown): value is DebriefStep {
  return typeof value === "string" && (DEBRIEF_STEPS as readonly string[]).includes(value);
}

/** The steps this session runs: a quiz with nothing to quiz, or shadowing with no timed line, is skipped. */
export function planSteps(opts: { quizCount: number; shadowCount: number }): DebriefStep[] {
  return DEBRIEF_STEPS.filter(
    (step) => (step !== "words" || opts.quizCount > 0) && (step !== "shadow" || opts.shadowCount > 0),
  );
}

/** What the tutor appends when a step's goal is met. The client turns it into a Continue button. */
export const STEP_DONE_MARKER = "[[STEP_DONE]]";

/** Remove the marker from a (possibly partial) reply, and say whether it was there. */
export function stripStepMarker(text: string): { text: string; done: boolean } {
  const done = text.includes(STEP_DONE_MARKER);
  let cleaned = text.split(STEP_DONE_MARKER).join("");
  // A marker still arriving mid-stream ("…[[STEP_D") is hidden too, so it never
  // flashes on screen before the rest of it lands.
  for (let k = STEP_DONE_MARKER.length - 1; k >= 2; k--) {
    if (cleaned.endsWith(STEP_DONE_MARKER.slice(0, k))) {
      cleaned = cleaned.slice(0, -k);
      break;
    }
  }
  return { text: cleaned.trimEnd(), done };
}

const CEFR_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"];

/** The learner's band, defaulting to A2 when it is unknown or unreadable. */
export function normalizeCefr(level: string | null | undefined): string {
  const upper = (level ?? "").trim().toUpperCase().slice(0, 2);
  return CEFR_ORDER.includes(upper) ? upper : "A2";
}

/**
 * How much Arabic the tutor speaks, by level.
 *
 * The same session has to work for someone who caught the gist from the
 * subtitles and for someone who followed every word, so the ratio moves with
 * CEFR: English scaffolding at A1–A2, dialect with English glosses at B1–B2,
 * dialect throughout from C1. Never MSA at any level.
 */
export function tutorLanguageRule(level: string | null | undefined, dialectLabel: string): string {
  const band = normalizeCefr(level);
  if (band === "A1" || band === "A2") {
    return `The learner is ${band}. Write mainly in English. Ask each question in English, then repeat it in simple ${dialectLabel} on its own line. They may answer in English — that is fine; accept it.`;
  }
  if (band === "B1" || band === "B2") {
    return `The learner is ${band}. Write mainly in simple, natural ${dialectLabel}, adding a short English gloss in brackets after any word that is not in the video. Encourage answers in Arabic, but switch to English to explain whenever they answer in English or seem stuck.`;
  }
  return `The learner is ${band}. Speak natural ${dialectLabel} throughout, as you would with a fluent friend; use English only if they ask for it.`;
}

/** How a finished quiz is reported back into the conversation. */
export interface QuizOutcome {
  arabic: string;
  english: string;
  correct: boolean;
  /** The meaning they picked, for a wrong answer on a multiple-choice card. */
  chosen?: string;
}

export function describeQuizResults(outcomes: QuizOutcome[]): string {
  const right = outcomes.filter((o) => o.correct);
  const missed = outcomes.filter((o) => !o.correct);
  const lines = [`(Quiz finished — ${right.length} of ${outcomes.length} right.)`];
  if (right.length) lines.push(`Knew: ${right.map((o) => `${o.arabic} (${o.english})`).join(", ")}`);
  if (missed.length) {
    lines.push(
      `Missed: ${missed
        .map((o) => `${o.arabic} (${o.english})${o.chosen ? ` — picked "${o.chosen}"` : ""}`)
        .join(", ")}`,
    );
  }
  return lines.join("\n");
}

/** How one shadowing take is reported back into the conversation. */
export interface ShadowOutcome {
  lineNumber: number;
  arabic: string;
  /** 0–100, or null when the learner skipped the line. */
  score: number | null;
  heard?: string;
}

export function describeShadowResult(outcome: ShadowOutcome): string {
  if (outcome.score === null) return `(Skipped shadowing line ${outcome.lineNumber}: ${outcome.arabic})`;
  const heard = outcome.heard?.trim() ? ` The recogniser heard: ${outcome.heard.trim()}` : "";
  return `(Shadowed line ${outcome.lineNumber}: ${outcome.arabic} — score ${Math.round(outcome.score)}/100.${heard})`;
}

/** Everything the tutor's prompt is assembled from. */
export interface DebriefPromptContext {
  step: DebriefStep;
  steps: DebriefStep[];
  dialectLabel: string;
  level: string | null | undefined;
  title: string;
  culturalContext?: string | null;
  guide: VideoStudyGuide;
  lines: DebriefLine[];
  quiz: QuizItem[];
  shadow: ShadowLine[];
  /** The learner profile block, when one could be built. */
  learnerBlock?: string;
}

/** Characters of transcript a debrief turn may carry. */
export const DEBRIEF_TRANSCRIPT_BUDGET = {
  /** Open questions can be about any moment, so that step sees the whole thing. */
  full: 8_000,
  /** Every other step only needs the lines its questions, words and clips point at. */
  cited: 3_000,
} as const;

/** Every line the session's material points at. */
function citedLineIds(ctx: DebriefPromptContext): Set<string> {
  const ids = new Set<string>();
  const { guide } = ctx;
  [guide.gist, ...guide.comprehension].forEach((q) => q.line_ids.forEach((id) => ids.add(id)));
  guide.key_phrases.forEach((k) => k.line_id && ids.add(k.line_id));
  ctx.quiz.forEach((q) => q.lineId && ids.add(q.lineId));
  ctx.shadow.forEach((s) => ids.add(s.lineId));
  return ids;
}

/**
 * The transcript, as much of it as this step needs.
 *
 * This is where the study guide pays for itself. The tutor already knows what
 * the video is about from the notes, so a turn that is asking question two or
 * reacting to a quiz needs only the lines those are about (and a neighbour
 * either side, for "what did she say just before?"), not the whole transcript
 * re-sent on every message. Only the open-questions step, where the learner
 * may ask about any moment, carries it all.
 */
export function debriefTranscriptBlock(ctx: DebriefPromptContext): string {
  const { lines } = ctx;
  if (ctx.step === "questions") {
    return `TRANSCRIPT (numbered):\n${numberedTranscript(lines, DEBRIEF_TRANSCRIPT_BUDGET.full)}`;
  }
  const cited = citedLineIds(ctx);
  const keep = new Set<number>();
  lines.forEach((line, i) => {
    if (!cited.has(line.id)) return;
    for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 1); j++) keep.add(j);
  });
  if (keep.size === 0) {
    return `TRANSCRIPT (numbered):\n${numberedTranscript(lines, DEBRIEF_TRANSCRIPT_BUDGET.cited)}`;
  }
  const out: string[] = [];
  let used = 0;
  let previous = -1;
  for (const i of [...keep].sort((a, b) => a - b)) {
    const line = lines[i];
    const text = `${i + 1}. ${line.arabic}${line.translation ? ` — ${line.translation}` : ""}`;
    if (used + text.length > DEBRIEF_TRANSCRIPT_BUDGET.cited) break;
    if (previous >= 0 && i > previous + 1) out.push("…");
    out.push(text);
    used += text.length + 1;
    previous = i;
  }
  return `TRANSCRIPT EXCERPTS (the lines your notes refer to; the video has ${lines.length} lines in all — "…" marks lines not shown, never guess what they say):\n${out.join("\n")}`;
}

function lineNumbers(ids: string[], lines: DebriefLine[]): string {
  const numbers = ids
    .map((id) => lines.findIndex((l) => l.id === id) + 1)
    .filter((n) => n > 0);
  return numbers.length ? ` (line${numbers.length > 1 ? "s" : ""} ${numbers.join(", ")})` : "";
}

const sourceLabel: Record<FocusSource, string> = {
  saved: "saved while watching",
  looked_up: "looked up but did not save",
  key_vocab: "key word from the video",
};

function stepBrief(ctx: DebriefPromptContext): string {
  const wordList = ctx.quiz.map((q) => `${q.arabic} (${sourceLabel[q.source]})`).join(", ");
  const shadowList = ctx.shadow
    .map((s) => `line ${s.lineNumber}: ${s.arabic}${s.why ? ` — ${s.why}` : ""}`)
    .join("\n");
  switch (ctx.step) {
    case "gist":
      return `Open the session with one friendly line saying you'll talk through the video together, then ask the GIST question from your notes. When they answer, say what they got right, fill in anything important they missed using the expected answer, and finish with the marker. If they don't know, give one hint pointing at a moment in the video before telling them.`;
    case "comprehension":
      return `Ask the COMPREHENSION questions from your notes one at a time, in order. After each answer, say briefly whether it is right and complete or correct it from the expected answer, pointing to the line where the answer is. If they are stuck, give one hint before telling them. Then ask the next one. After the last question has been answered, give a one-line wrap-up and finish with the marker.`;
    case "words":
      return `The app is about to show the learner a quick card for each of these words, where they choose the meaning: ${wordList}.
- If the conversation does not yet contain the "(Quiz finished …)" message: write ONE short line introducing the quiz (mention that these are words they marked, if any were). Do not quiz them yourself and do not give any meanings. Do not use the marker.
- Once it does: react to the results. For each word they missed, explain it through the line it came from in the video (quote the line), with a tiny memory hook if a natural one exists. Praise what they knew in one line. Then finish with the marker.`;
    case "shadow":
      return `The app will show a card for shadowing these lines from the video (listen to the native clip, then say it at the same speed):
${shadowList}
- Before any "(Shadowed …)" or "(Skipped …)" message: write one or two short sentences on why these lines are worth saying aloud, and the tip: listen first, then copy the rhythm, not just the words. Do not use the marker.
- After each result: one or two sentences of feedback from the score and from what the recogniser heard compared with the line. Be encouraging and name at most one specific word or sound to work on. Finish with the marker only once every line has a result, or if the learner says they want to move on.`;
    case "questions":
      return `Ask whether anything in the video is still unclear — a word, a line, why something was funny. Answer their questions from the transcript, quoting the line you mean. If they have nothing, use ONE talking point from your notes for a short exchange of two or three turns. When they are done, finish with the marker.`;
    case "recap":
      return `Write the recap in markdown: 3–5 short bullets — what they understood well, the words to keep reviewing (the missed quiz words, each with the line it came from), and one phrase from the video to try using this week. Then a one-line goodbye, and finish with the marker.`;
  }
}

/**
 * The tutor's system prompt for one turn.
 *
 * Ordered stable-first: everything about the video and the learner is the
 * same on every turn of a session, so it sits ahead of the per-step brief.
 */
export function debriefSystemPrompt(ctx: DebriefPromptContext): string {
  const { guide, lines } = ctx;
  const position = ctx.steps.indexOf(ctx.step) + 1;
  const comprehension = guide.comprehension
    .map((q, i) => `${i + 1}. ${q.question_en}${q.question_ar ? ` / ${q.question_ar}` : ""}${lineNumbers(q.line_ids, lines)} — expected: ${q.answer_en}`)
    .join("\n");
  const marked = ctx.quiz.filter((q) => q.source !== "key_vocab");
  const markedBlock = marked.length
    ? marked.map((q) => `- ${q.arabic} — ${q.english} (${sourceLabel[q.source]})`).join("\n")
    : "The learner did not save or look up any words in this video; the quiz uses the video's key vocabulary.";

  return `You are Hikaya's tutor, debriefing a learner who has just watched a short ${ctx.dialectLabel} video. The session is a guided conversation in steps. You are on step ${position} of ${ctx.steps.length}: "${STEP_LABELS[ctx.step]}".

LANGUAGE: ${tutorLanguageRule(ctx.level, ctx.dialectLabel)}
STYLE: Warm and brief — one to four short sentences a message (the recap may be longer). One question at a time; never lecture. When you quote the video, copy its Arabic exactly as in the transcript, then a transliteration in brackets. Your own Arabic is always spoken ${ctx.dialectLabel}, never Modern Standard Arabic.
${ctx.learnerBlock ? `\n${ctx.learnerBlock}\n` : ""}
THE VIDEO: "${ctx.title}"
Summary: ${guide.summary_en}
${ctx.culturalContext ? `Cultural context: ${ctx.culturalContext.slice(0, 1200)}\n` : ""}
${debriefTranscriptBlock(ctx)}

YOUR NOTES (written in advance; the learner cannot see them — never read out an answer before they have tried):
Gist question: ${guide.gist.question_en}${guide.gist.question_ar ? ` / ${guide.gist.question_ar}` : ""} — expected: ${guide.gist.answer_en}
Comprehension questions:
${comprehension || "(none — ask about the gist only)"}
${guide.talking_points.length ? `Talking points:\n${guide.talking_points.map((t) => `- ${t.prompt_en}${t.prompt_ar ? ` / ${t.prompt_ar}` : ""}`).join("\n")}\n` : ""}${guide.key_phrases.length ? `Expressions worth explaining:\n${guide.key_phrases.map((k) => `- ${k.arabic} — ${k.english}${k.note ? `: ${k.note}` : ""}${k.line_id ? lineNumbers([k.line_id], lines) : ""}`).join("\n")}\n` : ""}
WORDS THIS LEARNER MARKED:
${markedBlock}

THIS STEP:
${stepBrief(ctx)}

FINISHING A STEP: when this step's goal is met, end your message with ${STEP_DONE_MARKER} on its own line — the app turns it into a Continue button, so never mention it. Do not use it at any other time, and never start the next step yourself. Messages in brackets such as "(Quiz finished …)" are reports from the app about what the learner just did, not things they typed.`;
}

/** A turn that opens a step has no learner message to answer; this stands in for one. */
export function stepKickoff(step: DebriefStep): string {
  return `(The learner is ready for "${STEP_LABELS[step]}".)`;
}
