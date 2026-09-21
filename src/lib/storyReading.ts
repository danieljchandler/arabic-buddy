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
 * The stored recording, when it was made from the text now on screen.
 *
 * An editor generates a story's audio from whatever the narration path prefers
 * — dialect first — so a line with a dialect rendering has a dialect
 * recording, and one without has a fusha one. (`translate-story-dialect`
 * clears the recording of every line it rewrites, so this stays true across a
 * re-translation rather than only at import.) The one mismatch left is a
 * learner reading the fusha of a line that was recorded in dialect; that line
 * is synthesised instead, which costs a call but says what the page says.
 */
export function storedClipFor(
  line: ReadableStoryLine,
  preferred: StoryRegister,
): string | null {
  const url = (line.audio_url ?? "").trim();
  if (!url) return null;
  const storedRegister: StoryRegister = hasDialect(line) ? "dialect" : "fusha";
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
