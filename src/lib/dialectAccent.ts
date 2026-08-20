/**
 * The accent colour each dialect carries.
 *
 * One table, because these were diverging: the ritual switcher used warm
 * brand hues while the daily task rows used raw Tailwind `teal`, `amber` and
 * `red` — and teal in particular is a cold colour on a warm-sand palette,
 * showing up several times over on the app's most-visited screen.
 *
 * Bare HSL channels rather than `hsl(...)` strings so callers can compose
 * their own alpha, the way the tokens in index.css are written.
 */
export const DIALECT_ACCENT: Record<string, string> = {
  Gulf: "12 68% 32%",
  Egyptian: "38 85% 45%",
  Yemeni: "0 70% 42%",
};

export function dialectAccent(dialect: string | null | undefined): string {
  return DIALECT_ACCENT[dialect ?? ""] ?? DIALECT_ACCENT.Gulf;
}
