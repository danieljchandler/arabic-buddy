/**
 * What a reading-library story shows and says, per line.
 *
 * A story in the library carries the same sentence twice: `arabic` is the
 * public-domain fusha it was imported from, `dialect` is the spoken rendering
 * the app actually teaches. Which of the two is on screen is a learner
 * preference, and the sound has to follow the text — a page showing dialect
 * while a fusha recording plays teaches the learner that the two are the same
 * thing, which is the one claim this app exists to contradict.
 *
 * So the rules live here rather than in the page: the register a line can
 * honestly show, the text for it, whether the stored recording still matches,
 * and which voice should read it.
 */

/** The half of a story line these rules need. */
export interface ReadableStoryLine {
  arabic: string;
  arabic_vocalized?: string | null;
  dialect?: string | null;
  dialect_vocalized?: string | null;
  audio_url?: string | null;
}

/** Which of a story's two renderings is being read. */
export type StoryRegister = "dialect" | "fusha";

/**
 * Labels for Modern Standard Arabic, which is a register and not a dialect.
 *
 * Kept in step with `FUSHA_LABELS` in
 * `supabase/functions/_shared/storyDialect.ts` — the edge function refuses
 * these targets and this decides whether to offer the button that would hit
 * it, so the two disagreeing means an editor is offered an action that can
 * only fail. A test in this file reads that file and checks they match.
 */
const FUSHA_LABELS = new Set(["msa", "fusha", "fus7a", "standard", "classical"]);

/**
 * Whether there is a dialect to convert a story *to*.
 *
 * The admin form offers "MSA (Fusha)" alongside the three dialects, and a
 * story filed under it is already in the register it is read in.
 */
export function isDialectTarget(dialect: string | null | undefined): boolean {
  const label = (dialect ?? "").trim().toLowerCase();
  return label.length > 0 && !FUSHA_LABELS.has(label);
}

/** True when the line has a spoken-Arabic rendering to show. */
export function hasDialect(line: ReadableStoryLine): boolean {
  return Boolean((line.dialect ?? "").trim() || (line.dialect_vocalized ?? "").trim());
}

/**
 * The register this line can actually honour.
 *
 * A conversion that skipped one line leaves that line fusha-only, and asking
 * for dialect cannot invent it. Everything else here keys off this rather than
 * off what the learner asked for, so a fallback stays a fallback all the way
 * down to the voice.
 */
export function lineRegister(line: ReadableStoryLine, preferred: StoryRegister): StoryRegister {
  return preferred === "dialect" && hasDialect(line) ? "dialect" : "fusha";
}

/** The text to show and to speak, diacritics preferred within the register. */
export function storyLineText(line: ReadableStoryLine, preferred: StoryRegister): string {
  if (lineRegister(line, preferred) === "dialect") {
    return (line.dialect_vocalized || line.dialect || "").trim();
  }
  return (line.arabic_vocalized || line.arabic || "").trim();
}

/**
 * Which register a line's stored recording is in, or null when the row cannot
 * say.
 *
 * Nothing on the row records what a clip was made from, so this reconstructs
 * it from what the narration path would have chosen. That path is
 * `spokenStoryLine` now — either dialect form before either fusha one — but
 * the recordings on disk predate it, and the chain that made them asked for
 * `dialect_vocalized || arabic_vocalized || dialect`. The two agree except on
 * one shape, and it is a shape that really exists: a line converted to dialect
 * without tashkeel, narrated before this changed, holds a *fusha* recording
 * while carrying a dialect rendering. Calling that clip "dialect" because the
 * row has a dialect is how a fusha recording ends up playing under dialect
 * text — the exact mismatch these rules exist to prevent.
 *
 * So that one shape answers null, and the caller synthesises instead. It
 * cannot be produced any more (every writer now fills `dialect_vocalized`,
 * falling back to the plain rendering), and re-running the conversion on such
 * a story clears the stale clip outright, so it is a legacy state with a way
 * out rather than a permanent cost.
 */
export function storedClipRegister(line: ReadableStoryLine): StoryRegister | null {
  // No dialect at all: nothing else could have been narrated.
  if (!hasDialect(line)) return "fusha";
  // Tashkeel on the dialect: both the old chain and the new one take it first.
  if ((line.dialect_vocalized ?? "").trim()) return "dialect";
  // Dialect without tashkeel, and a vocalized fusha the old chain preferred to
  // it. Which one is on disk depends on when the clip was made, which the row
  // does not say.
  if ((line.arabic_vocalized ?? "").trim()) return null;
  // Nothing vocalized anywhere, so both chains land on the dialect.
  return "dialect";
}

/**
 * The stored recording, when it was made from the text now on screen.
 *
 * An editor generates a story's audio once, from whichever rendering the
 * narration path prefers; `translate-story-dialect` clears the recording of
 * every line it rewrites, so a surviving clip belongs to the text still on the
 * row. What is left is matching its register to the one being read: a learner
 * looking at the fusha of a line recorded in dialect gets a synthesis instead,
 * which costs a call but says what the page says.
 */
export function storedClipFor(
  line: ReadableStoryLine,
  preferred: StoryRegister,
): string | null {
  const url = (line.audio_url ?? "").trim();
  if (!url) return null;
  const storedRegister = storedClipRegister(line);
  if (storedRegister === null) return null;
  return lineRegister(line, preferred) === storedRegister ? url : null;
}

/**
 * The voice that should read the page.
 *
 * `tts-speak` takes a dialect and picks the voice itself, and it understands
 * "MSA" — so the fusha view is read by an MSA voice rather than by a Gulf one
 * doing its best with case endings. Page-wide rather than per line: a story
 * where one line fell back to fusha still reads better in one voice than in
 * two.
 */
export function ttsDialectFor(
  storyDialect: string | null | undefined,
  preferred: StoryRegister,
): string {
  return preferred === "dialect" ? (storyDialect || "Gulf") : "MSA";
}
