// =============================================================================
// Alignment for Fanar-Shaheen-MT-1 batch responses.
//
// The MT endpoint (`POST /v1/translations`) takes one blob of text and returns
// one blob back. The translation tiebreak sends N newline-separated Arabic
// lines and needs exactly N English lines out, positionally aligned, so each
// result can be scattered back to the transcript line it came from.
//
// Fanar does not guarantee that. It occasionally emits a trailing newline, or
// collapses a line it considered empty. The original implementation compared
// `split('\n').length` against the input count and discarded the *entire*
// batch on any drift — turning a one-line formatting wobble into a total loss
// of the tiebreak, reported only as `called:false`.
// =============================================================================

/**
 * Positionally align a Shaheen batch response against the lines that were sent.
 *
 * Returns `expected` trimmed strings, or `null` when the response cannot be
 * aligned with confidence — callers should fall back to per-line requests
 * rather than guessing which output belongs to which input.
 */
export function alignShaheenLines(raw: string, expected: number): string[] | null {
  if (expected <= 0) return null;

  const direct = raw.split("\n").map((s) => s.trim());
  if (direct.length === expected) return direct;

  // A trailing newline, or a blank line Fanar inserted between outputs, is
  // recoverable: dropping empties restores the 1:1 mapping. This is only safe
  // because we never send blank lines — the caller filters to transcript lines
  // with Arabic text.
  const compact = direct.filter((s) => s.length > 0);
  if (compact.length === expected) return compact;

  console.warn(
    `Shaheen-MT: cannot align response (sent ${expected}, got ${direct.length} raw / ` +
      `${compact.length} non-empty) — falling back to per-line requests`,
  );
  return null;
}
