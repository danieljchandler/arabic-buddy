/**
 * The accent colour each dialect carries.
 *
 * One source, because these were diverging: the ritual switcher used warm
 * brand hues, the daily task rows used raw Tailwind `teal`, `amber` and `red`
 * — and teal in particular is a cold colour on a warm-sand palette, showing up
 * several times over on the app's most-visited screen.
 *
 * The values live in index.css rather than here so night majlis can lighten
 * them. The light Gulf accent is a deep ink that measured 1.85:1 against the
 * dark card — the worst contrast in the app — and a table of literals in TS
 * has no way to know which theme is on.
 *
 * Bare HSL channels rather than `hsl(...)` strings, so callers can compose
 * their own alpha the way the tokens themselves are written:
 * `hsl(${accent} / 0.12)`.
 */
export const DIALECT_ACCENT: Record<string, string> = {
  Gulf: "var(--dialect-gulf)",
  Egyptian: "var(--dialect-egyptian)",
  Yemeni: "var(--dialect-yemeni)",
};

export function dialectAccent(dialect: string | null | undefined): string {
  return DIALECT_ACCENT[dialect ?? ""] ?? DIALECT_ACCENT.Gulf;
}
