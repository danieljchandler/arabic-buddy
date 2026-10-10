/**
 * A word in a story (quiz Phase 6): two sentences of a passage, one of which
 * uses the word, kept in the shared store as `kind: "story_line"`.
 *
 * The quiz's top step reads the passage aloud with the word muted and asks the
 * learner to say it. This module is the shape the store keeps under a word's
 * `story_line` key, and the rules every side reads a passage by: the store
 * that files it, the pool and the frame that ask from it, and the script that
 * fills the curriculum's from the reading library.
 *
 * A passage comes from one of two places, in this order:
 *
 * 1. **A published story that already uses the word** (`findStoryPassage`):
 *    text a person published, cut to two sentences around the word, and no
 *    model call at all. Only what a story may lend is taken, and the rule is
 *    `storySourceProblem`:
 *    - *the dialect text only.* A story line carries the sentence twice:
 *      `arabic` (and `arabic_vocalized`, and the story's `body_fusha`) is the
 *      Modern Standard Arabic it was imported from, and `dialect` is the
 *      spoken rendering. Only `dialect` is read. `body_dialect` is not either:
 *      it fills every line the conversion skipped with that line's fusha;
 *    - *published stories only.* `status = 'published'`, the one status the
 *      reader's RLS serves to anyone; `draft` and `content_approved` are an
 *      editor's work in progress;
 *    - *a licence that asks nothing of a passage shown on its own.* Public
 *      domain and CC0 only. A CC-BY story must be credited wherever its text
 *      is shown, and a quiz card two sentences long, filed in a public table
 *      with no licence column, carries no credit; CC-BY-SA also puts every
 *      adaptation under the same licence, and a dialect rendering cut to two
 *      sentences is one. Anything else, or a licence nobody set, is left out;
 *    - *the story's own dialect, exactly.* The story form also offers
 *      Levantine and MSA, which `normalizeDialect` would fold onto Gulf; here
 *      a label that is not Gulf, Egyptian or Yemeni is no dialect at all;
 *    - *the story's current rendering.* `translate-story-dialect` leaves a
 *      line its model skipped with the dialect it already had, so a story
 *      moved from Gulf to Egyptian can keep a Gulf line under an Egyptian
 *      label. `body_dialect` is rebuilt from the latest conversion alone, so a
 *      line whose text is not one of its lines is from an earlier one
 *      (`inCurrentRendering`). And a "rendering" that is its own fusha line
 *      word for word was never converted.
 *    Every sentence also passes the leak detector here, as a generated one
 *    must: it is free, and the rulebook may have grown since the story's
 *    conversion was checked.
 *
 * 2. **Written for the word** through the Brain, once per word, sense and
 *    dialect, under the dialogue kind's rules exactly (`word-asset`): from the
 *    key's folded word, folded sense and dialect alone (`storyLinePrompt`;
 *    the trusted path may add a curriculum word's authored example), drafted
 *    and critiqued with the native validator on, and filed only when every
 *    sentence passes the leak detector and the validator passed what was
 *    shipped.
 *
 * What counts as a passage is one rule, `asStoredStoryLine`: exactly two
 * sentences, each with Arabic and English, one of them using the word
 * (`lineUsesWord`, so a phrase counts and a word of three letters or fewer is
 * matched exactly, as every token is) and the word said nowhere else in the
 * two, not even with an attached و, ب or ال (`wordUseCount`): a second use
 * would say the answer the gap mutes.
 *
 * Pure apart from `findStoryPassage`, which takes the client as a parameter:
 * the browser imports this verbatim, and so do `word-asset` and
 * `scripts/curriculum-stories-core.ts`. Tested from Vitest
 * (`src/test/wordStoryLine.test.ts`, the source rule against the emulator).
 */

import { normaliseAssetWord, type AssetDialect, type AssetKey } from "./wordAssets.ts";
import {
  DIALECT_NAME,
  DIALECT_PLACES,
  keyWord,
  lineUsesWord,
  MAX_EXAMPLE_LENGTH,
  promptSafe,
  wordUseCount,
} from "./wordDialogue.ts";

// ── The passage ─────────────────────────────────────────────────────────────

/** One sentence of a passage. */
export interface StoredStorySentence {
  arabic: string;
  english: string;
}

/** The published story a passage was taken from. */
export interface StoryLineStory {
  id: string;
  title: string;
  titleArabic: string;
}

/** A passage as every side reads it. */
export interface StoredStoryLine {
  sentences: [StoredStorySentence, StoredStorySentence];
  /** The sentence that uses the word, read off the sentences: never stored. */
  gap: 0 | 1;
  /** The story it was taken from; null for one written for the word. */
  story: StoryLineStory | null;
}

/**
 * A sentence longer than this is not one a learner can follow by ear in a
 * quiz card. A written one is asked for at fourteen words; a story's line can
 * run longer, and one that does is not cut from.
 */
export const MAX_STORY_SENTENCE_LENGTH = 200;

/** Longer than any translation of a sentence that short. */
const MAX_STORY_ENGLISH_LENGTH = 400;

/** At least one Arabic letter (tatweel excluded), as in `wordAssets.ts`. */
const ARABIC_LETTER_RE = /[ء-ؿف-يٮ-ۓۺ-ۿ]/;

const str = (value: unknown): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

function asSentence(value: unknown): StoredStorySentence | null {
  if (!value || typeof value !== "object") return null;
  const sentence = value as Record<string, unknown>;
  const arabic = str(sentence.arabic);
  if (!ARABIC_LETTER_RE.test(arabic) || arabic.length > MAX_STORY_SENTENCE_LENGTH) return null;
  const english = str(sentence.english);
  if (!english || english.length > MAX_STORY_ENGLISH_LENGTH) return null;
  return { arabic, english };
}

function asStory(value: unknown): StoryLineStory | null {
  if (!value || typeof value !== "object") return null;
  const story = value as Record<string, unknown>;
  const id = str(story.id);
  if (!id) return null;
  return { id, title: str(story.title).slice(0, 160), titleArabic: str(story.titleArabic).slice(0, 160) };
}

/** The sentences of a payload as the store keeps it (`{ sentences }`), or the bare pair. */
function rawSentences(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray((value as { sentences?: unknown }).sentences)) {
    return (value as { sentences: unknown[] }).sentences;
  }
  return null;
}

/**
 * A stored passage for `word`, or null when it is not one the quiz can ask:
 * not exactly two sentences, a sentence with no Arabic or no English (or too
 * long to follow), neither sentence or both using the word, or the word said
 * a second time anywhere in the two, bare or with و, ب or ال attached.
 */
export function asStoredStoryLine(value: unknown, word: string): StoredStoryLine | null {
  const raw = rawSentences(value);
  if (!raw || raw.length !== 2) return null;
  const first = asSentence(raw[0]);
  const second = asSentence(raw[1]);
  if (!first || !second) return null;
  const firstUses = lineUsesWord(first.arabic, word);
  if (firstUses === lineUsesWord(second.arabic, word)) return null;
  if (wordUseCount(`${first.arabic} ${second.arabic}`, word) !== 1) return null;
  const story = Array.isArray(value) ? null : asStory((value as { story?: unknown }).story);
  return { sentences: [first, second], gap: firstUses ? 0 : 1, story };
}

/** What the store keeps as `payload`: the sentences, and the story they came from. */
export function storyLinePayload(line: Pick<StoredStoryLine, "sentences" | "story">): Record<string, unknown> {
  return { sentences: line.sentences, ...(line.story ? { story: line.story } : {}) };
}

/** Why a draft is not a passage the quiz can use, for the Brain's critic; null when it is. */
export function storyLineProblem(value: unknown, word: string): string | null {
  if (asStoredStoryLine(value, word)) return null;
  return (
    `The output must be exactly two sentences, each with Arabic and an English translation, each at most ` +
    `fourteen words. Exactly one of them must contain the word ${word} exactly as written, as a whole word ` +
    `with nothing attached to it; the other must not contain it, and neither may use it a second time in ` +
    `any form (not with و, ب or ال attached either).`
  );
}

/** The Arabic of every sentence, for the Brain's leak scan. */
export function storyLineArabic(value: unknown): string {
  return (rawSentences(value) ?? [])
    .map((sentence) => (sentence && typeof sentence === "object" ? str((sentence as { arabic?: unknown }).arabic) : ""))
    .filter(Boolean)
    .join("\n");
}

/**
 * Each sentence's Arabic as the leak detector must see it before a passage is
 * filed: with quotation marks taken out. The detector skips anything quoted
 * (so a contrastive example in a prompt is not a leak), and a story's quoted
 * speech is still the passage the learner hears and reads.
 */
export function storyLineSentencesForScan(line: Pick<StoredStoryLine, "sentences">): string[] {
  return line.sentences.map((sentence) => sentence.arabic.replace(/["“”«»]/g, " "));
}

// ── Writing one ─────────────────────────────────────────────────────────────

/**
 * The prompt for a word's passage, built only from what the key was built
 * from (the folded word, the folded sense, the dialect) plus, on the trusted
 * path alone, an authored example (`authoredExample` in `wordDialogue.ts`).
 * Nothing else a caller says reaches it, so whoever misses first cannot
 * decide what every later learner hears.
 */
export function storyLinePrompt(input: {
  /** The key's folded word (`keyWord`). */
  word: string;
  /** The key's folded sense. */
  sense: string;
  dialect: AssetDialect;
  /** A curriculum word's authored example; never a learner's text. */
  example?: string | null;
}): string {
  const word = promptSafe(input.word, 80);
  const sense = promptSafe(input.sense, 120);
  const example = promptSafe(input.example ?? "", MAX_EXAMPLE_LENGTH);
  return [
    `Write two sentences from a short everyday story told in spoken ${DIALECT_NAME[input.dialect]}, the way people really tell a story aloud.`,
    `One of the two sentences uses the word ${word} (meaning "${sense}") in that meaning; the other sets the scene and does not use it.`,
    `Write ${word} exactly as given, as a whole word on its own, with no article, pronoun or other letters attached to it, and use it only once: no other form of it anywhere in the two sentences.`,
    "The sentences follow on from each other. Each is one sentence of at most fourteen words, something a learner could follow by ear.",
    `Set it in ${DIALECT_PLACES[input.dialect]}.`,
    example ? `For context, the course uses the word like this: '${example}'. Do not copy that sentence.` : "",
    "For each sentence give the Arabic as people write the dialect, and a natural English translation.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The structured output the Brain is asked for. */
export const STORY_LINE_TOOL = {
  name: "emit_story_line",
  description: "Two sentences of a story, exactly one of which uses the word.",
  parameters: {
    type: "object",
    properties: {
      sentences: {
        type: "array",
        minItems: 2,
        maxItems: 2,
        items: {
          type: "object",
          properties: {
            arabic: { type: "string" },
            english: { type: "string" },
          },
          required: ["arabic", "english"],
        },
      },
    },
    required: ["sentences"],
  },
} as const;

// ── Taking one from the reading library ─────────────────────────────────────

/** The one story status the reader serves to anyone. */
export const PUBLISHED_STORY_STATUS = "published";

/**
 * Licences under which a passage may be filed in a public table and shown
 * apart from its story, folded (lower case, no spaces, dashes or underscores).
 * The admin form stores `public_domain`, `CC0`, `CC-BY` and `CC-BY-SA`.
 */
const SHAREABLE_LICENSES: ReadonlySet<string> = new Set(["publicdomain", "cc0"]);

/** Whether a story's licence lets two of its sentences be shown on their own, uncredited. */
export function storyLicenseShareable(license: string | null | undefined): boolean {
  return SHAREABLE_LICENSES.has((license ?? "").toLowerCase().replace(/[\s_-]+/g, ""));
}

const STORY_DIALECTS: Readonly<Record<string, AssetDialect>> = {
  gulf: "Gulf",
  egyptian: "Egyptian",
  yemeni: "Yemeni",
};

/**
 * The dialect a story is filed under, or null for one that is not a dialect
 * the store keys on. Exact on purpose: the form also stores `Levantine` and
 * `MSA`, and the app-wide `normalizeDialect` reads every label it does not
 * know as Gulf.
 */
export function storyDialect(label: string | null | undefined): AssetDialect | null {
  return STORY_DIALECTS[(label ?? "").trim().toLowerCase()] ?? null;
}

/** A story, as the search reads one (`authentic_stories`). */
export interface StoryRow {
  id: string;
  title: string;
  title_arabic: string | null;
  dialect: string;
  license: string;
  status: string;
}

/** A story's line, as the search reads one (`authentic_story_lines`). */
export interface StoryLineRow {
  story_id: string;
  line_index: number;
  /** The fusha the story was imported from: read only to tell a rendering from a copy of it. */
  arabic: string;
  /** The spoken rendering: the only text a passage is cut from. */
  dialect: string | null;
  english: string | null;
}

/** Why a story lends no passage to a key's dialect. */
export type StorySourceProblem = "not_published" | "license" | "dialect";

/** The source rule: null when a story may lend a passage in `dialect`. */
export function storySourceProblem(
  story: Pick<StoryRow, "status" | "license" | "dialect">,
  dialect: AssetDialect,
): StorySourceProblem | null {
  if (story.status !== PUBLISHED_STORY_STATUS) return "not_published";
  if (!storyLicenseShareable(story.license)) return "license";
  if (storyDialect(story.dialect) !== dialect) return "dialect";
  return null;
}

/** A sentence ends at . ! ? ؟ or …, with any closing quote or bracket kept on it. */
const SENTENCE_END = /(?<=[.!?؟…]["'”»)]*)\s+/u;

/** A line's sentences, in order. A newline always ends one. */
export function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((part) => part.split(SENTENCE_END))
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** A passage taken from a story, before it is filed. */
export interface StoryPassage {
  sentences: [StoredStorySentence, StoredStorySentence];
  story: StoryLineStory;
  /** The lines it was cut from, with the rendering read, for the record and `inCurrentRendering`. */
  lines: Array<{ index: number; dialect: string }>;
  license: string;
}

interface Unit {
  lineIndex: number;
  /** The line's whole rendering. */
  rendering: string;
  arabic: string;
  english: string;
  /** The first or last sentence of its line, for telling neighbours across lines. */
  first: boolean;
  last: boolean;
}

/**
 * A line cut into sentences, each with its English. A line of several
 * sentences is cut only where its English has as many, so each sentence keeps
 * its own translation; otherwise the line is one sentence of the passage, as
 * long as it is short enough to be one. Nothing is taken from a line with no
 * rendering, no English, or a rendering that is its fusha word for word.
 */
function lineUnits(line: StoryLineRow): Unit[] {
  const rendering = str(line.dialect);
  const english = str(line.english);
  if (!rendering || !english || !ARABIC_LETTER_RE.test(rendering)) return [];
  if (normaliseAssetWord(rendering) === normaliseAssetWord(line.arabic)) return [];
  const arabicParts = splitSentences(line.dialect ?? "");
  const englishParts = splitSentences(line.english ?? "");
  const parts = arabicParts.length > 1 && arabicParts.length === englishParts.length
    ? arabicParts.map((arabic, i) => ({ arabic, english: englishParts[i] }))
    : [{ arabic: rendering, english }];
  return parts.map((part, i) => ({
    lineIndex: line.line_index,
    rendering,
    arabic: part.arabic,
    english: part.english,
    first: i === 0,
    last: i === parts.length - 1,
  }));
}

/** Two sentences that follow on in the story: the same line, or the end of one line and the start of the next. */
function follows(a: Unit, b: Unit): boolean {
  if (a.lineIndex === b.lineIndex) return true;
  return a.last && b.first && b.lineIndex === a.lineIndex + 1;
}

/**
 * Every passage the stories hold for `word` in `dialect`, shortest first.
 *
 * Each story the source rule lets lend one (`storySourceProblem`) is read in
 * line order. A sentence that uses the word is the gap's, and its passage is
 * that sentence with the one before it (the story leading into the gap), or
 * with the one after it when the word opens the story or the one before does
 * not make a passage — the word's sentence is never cut, and neither is its
 * neighbour. A pair is a passage only if `asStoredStoryLine` says so (two
 * sentences, the word said once) and neither sentence leaks (`leaksIn`).
 * Shortest first, since the learner hears all of it; ties keep the stories'
 * order. The check against each story's current rendering needs its body,
 * which this does not read: `inCurrentRendering`.
 */
export function storyPassages(
  word: string,
  dialect: AssetDialect,
  stories: readonly StoryRow[],
  lines: readonly StoryLineRow[],
  leaksIn: (text: string) => string[] = () => [],
): StoryPassage[] {
  const byStory = new Map<string, StoryLineRow[]>();
  for (const line of lines) {
    const list = byStory.get(line.story_id) ?? [];
    list.push(line);
    byStory.set(line.story_id, list);
  }

  const found: Array<{ passage: StoryPassage; length: number; order: number }> = [];
  for (const story of stories) {
    if (storySourceProblem(story, dialect) !== null) continue;
    const units = (byStory.get(story.id) ?? [])
      .slice()
      .sort((a, b) => a.line_index - b.line_index)
      .flatMap(lineUnits);
    const passageOf = (a: Unit | undefined, b: Unit | undefined): StoryPassage | null => {
      if (!a || !b || !follows(a, b)) return null;
      const sentences = [
        { arabic: a.arabic, english: a.english },
        { arabic: b.arabic, english: b.english },
      ];
      if (!asStoredStoryLine({ sentences }, word)) return null;
      const scanned = sentences.flatMap((sentence) => leaksIn(sentence.arabic.replace(/["“”«»]/g, " ")));
      if (scanned.length > 0) return null;
      const used = a.lineIndex === b.lineIndex ? [a] : [a, b];
      return {
        sentences: [sentences[0], sentences[1]],
        story: { id: story.id, title: str(story.title), titleArabic: str(story.title_arabic) },
        lines: used.map((unit) => ({ index: unit.lineIndex, dialect: unit.rendering })),
        license: story.license,
      };
    };
    units.forEach((unit, i) => {
      if (!lineUsesWord(unit.arabic, word)) return;
      const passage = passageOf(units[i - 1], unit) ?? passageOf(unit, units[i + 1]);
      if (!passage) return;
      const length = passage.sentences[0].arabic.length + passage.sentences[1].arabic.length;
      found.push({ passage, length, order: found.length });
    });
  }
  return found.sort((a, b) => a.length - b.length || a.order - b.order).map((entry) => entry.passage);
}

/**
 * Whether every line a passage was cut from is still in its story as the
 * latest conversion left it. `body_dialect` is rebuilt from that conversion
 * alone (a line it skipped is the line's fusha there), so a rendering that is
 * not one of its lines is from an earlier conversion, perhaps into another
 * dialect. No body at all: nothing to check against, so nothing is taken.
 */
export function inCurrentRendering(passage: Pick<StoryPassage, "lines">, bodyDialect: string | null | undefined): boolean {
  if (!bodyDialect) return false;
  const current = new Set(bodyDialect.split("\n").map(str).filter(Boolean));
  return passage.lines.every((line) => current.has(str(line.dialect)));
}

/** What a story passage is filed as: its payload and how it was found. Never who asked. */
export function storyPassageAsset(passage: StoryPassage, styleVersion: string) {
  return {
    payload: storyLinePayload(passage),
    meta: {
      from: "story",
      story_id: passage.story.id,
      story_title: passage.story.title,
      line_indexes: passage.lines.map((line) => line.index),
      license: passage.license,
      style: styleVersion,
    },
    // A person published the story, and its dialect text with it: reviewed,
    // not generated, so a written passage never takes its place.
    source: "reviewed" as const,
  };
}

interface Settled {
  data: unknown;
  error: { message: string; code?: string } | null;
}

interface StoryQuery extends PromiseLike<Settled> {
  eq(column: string, value: string): StoryQuery;
  in(column: string, values: readonly string[]): StoryQuery;
  not(column: string, operator: string, value: null): StoryQuery;
  order(column: string, options?: { ascending?: boolean }): StoryQuery;
  range(from: number, to: number): StoryQuery;
  limit(count: number): StoryQuery;
}

/**
 * The slice of a Supabase client the search needs. Structural, so the
 * service-role client in Deno and the test emulator's fit alike.
 */
export interface StoryClient {
  from(table: string): { select(columns: string): StoryQuery };
}

/** The most published stories one search reads. The shelf holds a few dozen. */
export const MAX_STORIES_PER_SEARCH = 200;

/** Story ids per read of their lines: they travel in the URL. */
export const STORY_IDS_PER_READ = 50;

/** A page of lines; PostgREST caps a page at 1000 by default. */
export const STORY_LINES_PER_PAGE = 1000;

/** The most lines one search reads, all stories together. */
export const MAX_STORY_LINES_PER_SEARCH = 10_000;

const rows = <T>(settled: Settled): T[] => {
  if (settled.error) throw new Error(settled.error.message);
  return Array.isArray(settled.data) ? (settled.data as T[]) : [];
};

/**
 * The shortest passage a published story holds for the key's word, or null.
 * The word is the key's folded word (`keyWord`), never one a caller typed.
 *
 * Three reads at most, all of public data: the published stories (filtered by
 * the source rule in code, so a label the database would compare differently
 * is still refused), the rendered lines of the ones that may lend, a page at
 * a time, and the bodies of the stories a passage was found in, for
 * `inCurrentRendering`. Bounded by `MAX_STORIES_PER_SEARCH` and
 * `MAX_STORY_LINES_PER_SEARCH`. Never throws: a failed read is no passage,
 * and the caller writes one instead.
 */
export async function findStoryPassage(
  client: StoryClient,
  key: Pick<AssetKey, "conceptKey" | "dialect">,
  opts: { leaksIn?: (text: string) => string[] } = {},
): Promise<StoryPassage | null> {
  const dialect = key.dialect;
  const word = keyWord(key);
  if (!dialect || !word) return null;
  try {
    const stories = rows<StoryRow>(
      await client
        .from("authentic_stories")
        .select("id, title, title_arabic, dialect, license, status")
        .eq("status", PUBLISHED_STORY_STATUS)
        .order("created_at", { ascending: true })
        .limit(MAX_STORIES_PER_SEARCH),
    ).filter((story) => storySourceProblem(story, dialect) === null);
    if (stories.length === 0) return null;

    const lines: StoryLineRow[] = [];
    for (let i = 0; i < stories.length && lines.length < MAX_STORY_LINES_PER_SEARCH; i += STORY_IDS_PER_READ) {
      const ids = stories.slice(i, i + STORY_IDS_PER_READ).map((story) => story.id);
      for (let offset = 0; lines.length < MAX_STORY_LINES_PER_SEARCH; offset += STORY_LINES_PER_PAGE) {
        const page = rows<StoryLineRow>(
          await client
            .from("authentic_story_lines")
            .select("story_id, line_index, arabic, dialect, english")
            .in("story_id", ids)
            .not("dialect", "is", null)
            .order("story_id", { ascending: true })
            .order("line_index", { ascending: true })
            .range(offset, offset + STORY_LINES_PER_PAGE - 1),
        );
        lines.push(...page);
        if (page.length < STORY_LINES_PER_PAGE) break;
      }
    }

    const passages = storyPassages(word, dialect, stories, lines, opts.leaksIn);
    if (passages.length === 0) return null;
    const ids = [...new Set(passages.map((passage) => passage.story.id))].slice(0, STORY_IDS_PER_READ);
    const bodies = new Map(
      rows<{ id: string; body_dialect: string | null }>(
        await client.from("authentic_stories").select("id, body_dialect").in("id", ids).limit(ids.length),
      ).map((row) => [row.id, row.body_dialect]),
    );
    return passages.find((passage) => inCurrentRendering(passage, bodies.get(passage.story.id))) ?? null;
  } catch (err) {
    console.warn(`[wordStoryLine] story search failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
