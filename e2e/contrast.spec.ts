import { test, expect } from "./support/fixtures";

/**
 * Text contrast, in both themes.
 *
 * This exists because reading the source could not find what it catches. The
 * app's colours are tokens, the tokens have a `.dark` block, and every call
 * site looks correct in isolation — but nobody had measured what those tokens
 * actually compose to on a real surface. Rendered and measured, night majlis
 * had `text-primary` at 3.07:1 and the Gulf dialect accent at 1.85:1, and
 * light had its secondary text colour failing on essentially every route at
 * once. All of it invisible to grep.
 *
 * The check walks every element with its own text, resolves the real backdrop
 * by compositing the ancestor chain (so an alpha tint over a card is measured
 * as what the eye sees, not as the token), and applies the WCAG AA threshold
 * for the element's own size and weight.
 *
 * Deliberately a small route set: these are the screens a learner is on most,
 * and the tokens they exercise are shared with everything else, so a
 * regression anywhere in the palette shows up here. It is a floor, not an
 * audit of all seventy routes.
 */

const ROUTES = ["/today", "/choose", "/me", "/my-words", "/curriculum", "/settings"];

interface Failure {
  ratio: number;
  need: number;
  text: string;
  cls: string;
  fg: string;
  bg: string;
}

/** Runs in the page: returns every visible text node below its AA threshold. */
const AUDIT = `(() => {
  const lum = (r, g, b) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const parse = (s) => {
    const m = s.match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/);
    return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
  };
  const over = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3]));
  // The real backdrop: composite every painted ancestor down onto the root.
  // A chip at 12% alpha over a card is what the eye sees, not the token.
  const bgOf = (el) => {
    const stack = [];
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c[3] > 0) stack.push(c);
    }
    const root = parse(getComputedStyle(document.documentElement).backgroundColor);
    let acc = root && root[3] > 0 ? root.slice(0, 3) : [255, 255, 255];
    for (let i = stack.length - 1; i >= 0; i--) acc = over(stack[i], acc);
    return acc;
  };
  const out = [];
  for (const el of document.querySelectorAll("*")) {
    const text = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(" ")
      .trim();
    if (!text) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.opacity === "0") continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const f = over(fg, bg);
    const L1 = lum(f[0], f[1], f[2]);
    const L2 = lum(bg[0], bg[1], bg[2]);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    // AA: 3:1 for large text (24px, or 18.66px bold), 4.5:1 otherwise.
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    if (ratio < need) {
      out.push({
        ratio: +ratio.toFixed(2), need, text: text.slice(0, 40),
        cls: (typeof el.className === "string" ? el.className : "").slice(0, 80),
        fg: cs.color, bg: "rgb(" + bg.map(Math.round).join(",") + ")",
      });
    }
  }
  return out;
})()`;

/**
 * A hair under AA. The three sites sitting here are text on the darkest part
 * of the sand backdrop, where the border art tints the page; closing the last
 * 0.05 would mean pulling the brand's own Desert Red further from the value
 * the brand guide states, which is the worse trade. Anything that drops
 * further than this is a regression, not a rounding error.
 */
const TOLERANCE = 4.3;

for (const theme of ["light", "dark"] as const) {
  for (const route of ROUTES) {
    test(`${theme}: text on ${route} clears AA`, async ({ page, signInAs }) => {
      if (theme === "dark") {
        await page.addInitScript(() => localStorage.setItem("hakiya_theme", "dark"));
      }
      await signInAs("allin");
      await page.goto(route);
      await page.waitForTimeout(1500);

      const failures = (await page.evaluate(AUDIT)) as Failure[];
      const real = failures.filter((f) => f.ratio < TOLERANCE);
      expect(
        real,
        real.map((f) => `${f.ratio}:1 (needs ${f.need}) — ${JSON.stringify(f.text)} ` +
          `${f.fg} on ${f.bg} [${f.cls}]`).join("\n"),
      ).toEqual([]);
    });
  }
}
