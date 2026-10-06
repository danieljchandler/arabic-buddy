/**
 * The title's size in a dance frame. Every frame has the same 276-unit title
 * area; a short name (العرضة) sits at full size, and a longer one (رقص العصاية)
 * shrinks so the rough-edged letters stay inside the paper.
 */
export const TITLE_MAX_SIZE = 58;
/** Names up to this many characters (diacritics excluded) take the full size. */
const FULL_SIZE_CHARS = 7;

export function titleFontSize(title: string): number {
  // Diacritics (harakat) sit over a letter and take no width of their own.
  const chars = title.replace(/[ً-ٰٟ]/g, "").length;
  if (chars <= FULL_SIZE_CHARS) return TITLE_MAX_SIZE;
  return Math.round((TITLE_MAX_SIZE * FULL_SIZE_CHARS) / chars);
}
