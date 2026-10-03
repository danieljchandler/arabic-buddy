/**
 * Opt-in brand preview: the real app, re-skinned in one of the candidate
 * brand directions, for whoever asks for it by URL and nobody else.
 *
 * The owner is weighing whether to retire the watercolour look, and a mockup
 * cannot answer that question the way the real app can. So a deploy preview
 * opened with `?brand=weave`, `?brand=ink` or `?brand=souq` re-skins every
 * page through the token layer (src/styles/brand-preview.css, keyed off
 * `data-brand` on <html>) and remembers the choice, so clicking around keeps
 * it. `?brand=off` (or `?brand=current`) forgets it again.
 *
 * Nothing here runs unless asked: with no parameter and nothing stored, boot
 * leaves <html> without the attribute, injects no font link, and the floating
 * switcher renders nothing — the default experience is byte-for-byte today's.
 *
 * Dependency-free on purpose, like brandMigration.ts: main.tsx calls it before
 * React mounts, so the first paint is already in the chosen direction.
 */

export type BrandDirectionId = "weave" | "ink" | "souq";

/**
 * What the switcher can be showing. `current` is "previewing, but on today's
 * look": the in-app Current button keeps the switcher on screen so the owner
 * can flip back and forth. Only the × (or `?brand=off`) ends the preview.
 */
export type BrandPreviewState = BrandDirectionId | "current";

export interface BrandDirection {
  id: BrandDirectionId;
  label: string;
  /** One line on what the direction is, for the switcher's tooltip. */
  summary: string;
  /** Google Fonts stylesheet with every family the direction's tokens name. */
  fontsHref: string;
}

/** New spelling on purpose: the brandSpelling guard forbids the old one in new keys. */
export const BRAND_PREVIEW_STORAGE_KEY = "hikaya_brand_preview";
export const BRAND_PREVIEW_PARAM = "brand";
export const BRAND_FONT_LINK_ID = "hikaya-brand-preview-fonts";

/**
 * Which of Ink's two marks the preview draws. The owner chose the bubble
 * with a faint tone-on-tone sadu pressed into it as the primary mark, so
 * `sadu` is the default; the flat redraw stays available as the secondary,
 * and `?mark=clean` (or `?mark=sadu` to go back) flips it on a live page. It
 * is remembered beside the preview itself — and forgotten with it.
 */
export type InkMarkVariant = "clean" | "sadu";
export const DEFAULT_INK_MARK: InkMarkVariant = "sadu";
export const BRAND_MARK_STORAGE_KEY = "hikaya_brand_mark";
export const BRAND_MARK_PARAM = "mark";

const GOOGLE_FONTS = "https://fonts.googleapis.com/css2?";

/**
 * Ink's Arabic text face (Noto Naskh Arabic) is not in its link: it comes
 * through the "Hikaya Naskh Arabic" @font-face alias in brand-preview.css,
 * which is what lets Arabic render in Naskh while Latin stays Readex Pro.
 */
export const BRAND_DIRECTIONS: readonly BrandDirection[] = [
  {
    id: "weave",
    label: "Weave",
    summary: "Flat heritage-modern: sand, Desert Red and evergreen, sadu band in vector.",
    fontsHref:
      GOOGLE_FONTS +
      "family=Aref+Ruqaa:wght@400;700&family=Newsreader:opsz,wght@6..72,600..700" +
      "&family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap",
  },
  {
    id: "ink",
    label: "Ink",
    summary: "Editorial: cream paper, near-black ink, oxblood and mustard.",
    fontsHref:
      GOOGLE_FONTS +
      "family=Rakkas&family=DM+Serif+Display&family=Readex+Pro:wght@300..700&display=swap",
  },
  {
    id: "souq",
    label: "Souq",
    summary: "Playful: cream and navy, deep coral and cobalt, lattice band.",
    fontsHref:
      GOOGLE_FONTS +
      "family=Lalezar&family=Young+Serif&family=Alexandria:wght@400..700&display=swap",
  },
];

export function isBrandDirectionId(value: unknown): value is BrandDirectionId {
  return BRAND_DIRECTIONS.some((d) => d.id === value);
}

export function getBrandDirection(id: BrandDirectionId): BrandDirection {
  // isBrandDirectionId narrows every caller, so the find cannot miss.
  return BRAND_DIRECTIONS.find((d) => d.id === id)!;
}

/**
 * Read `?brand=` off a query string.
 *
 * Returns a direction to switch on, `"off"` to forget the preview, or `null`
 * when the parameter is absent or names nothing we know — an unknown value is
 * ignored rather than treated as "off", so a typo never silently ends a
 * preview someone is in the middle of.
 */
export function parseBrandParam(search: string): BrandDirectionId | "off" | null {
  const raw = new URLSearchParams(search).get(BRAND_PREVIEW_PARAM);
  if (raw === null) return null;
  const value = raw.trim().toLowerCase();
  if (value === "off" || value === "current") return "off";
  return isBrandDirectionId(value) ? value : null;
}

function isPreviewState(value: unknown): value is BrandPreviewState {
  return value === "current" || isBrandDirectionId(value);
}

export function readStoredBrandPreview(): BrandPreviewState | null {
  try {
    const raw = window.localStorage.getItem(BRAND_PREVIEW_STORAGE_KEY);
    return isPreviewState(raw) ? raw : null;
  } catch {
    // Private mode, blocked site data — the preview just won't persist.
    return null;
  }
}

export function writeStoredBrandPreview(state: BrandPreviewState | null): void {
  try {
    if (state === null) window.localStorage.removeItem(BRAND_PREVIEW_STORAGE_KEY);
    else window.localStorage.setItem(BRAND_PREVIEW_STORAGE_KEY, state);
  } catch {
    // best-effort persistence
  }
}

/**
 * Read `?mark=` off a query string. Like `?brand=`, an unknown value is
 * ignored (null) rather than read as a reset.
 */
export function parseMarkParam(search: string): InkMarkVariant | null {
  const raw = new URLSearchParams(search).get(BRAND_MARK_PARAM);
  const value = raw?.trim().toLowerCase();
  return value === "clean" || value === "sadu" ? value : null;
}

export function readStoredMarkVariant(): InkMarkVariant {
  try {
    return window.localStorage.getItem(BRAND_MARK_STORAGE_KEY) === "clean" ? "clean" : DEFAULT_INK_MARK;
  } catch {
    return DEFAULT_INK_MARK;
  }
}

/** The default (sadu) is stored as nothing at all; only "clean" is written. */
export function writeStoredMarkVariant(variant: InkMarkVariant): void {
  try {
    if (variant === DEFAULT_INK_MARK) window.localStorage.removeItem(BRAND_MARK_STORAGE_KEY);
    else window.localStorage.setItem(BRAND_MARK_STORAGE_KEY, variant);
  } catch {
    // best-effort persistence
  }
}

/**
 * Stamp a state onto the document: the `data-brand` attribute the token
 * overrides key off, and the direction's font stylesheet. Idempotent — the
 * link is found by id and retargeted rather than duplicated, and both are
 * removed when the state has no direction to show.
 */
export function applyBrandPreview(state: BrandPreviewState | null, doc: Document = document): void {
  const root = doc.documentElement;
  const existing = doc.getElementById(BRAND_FONT_LINK_ID) as HTMLLinkElement | null;

  if (state === null || state === "current") {
    root.removeAttribute("data-brand");
    existing?.remove();
    return;
  }

  root.setAttribute("data-brand", state);
  const href = getBrandDirection(state).fontsHref;
  if (existing) {
    if (existing.getAttribute("href") !== href) existing.setAttribute("href", href);
    return;
  }
  const link = doc.createElement("link");
  link.id = BRAND_FONT_LINK_ID;
  link.rel = "stylesheet";
  link.href = href;
  doc.head.appendChild(link);
}

// ── The store the switcher subscribes to ─────────────────────────────────
// Module state rather than a localStorage read per render: storage can throw
// (private mode), and a URL-activated preview must still show its switcher
// for the session even when it cannot be remembered.

let current: BrandPreviewState | null | undefined;
let currentMark: InkMarkVariant | undefined;
const subscribers = new Set<() => void>();

export function getBrandPreview(): BrandPreviewState | null {
  if (current === undefined) current = readStoredBrandPreview();
  return current;
}

/** Ending the preview (null) forgets the mark choice too. */
export function setBrandPreview(state: BrandPreviewState | null): void {
  current = state;
  writeStoredBrandPreview(state);
  if (state === null) {
    currentMark = DEFAULT_INK_MARK;
    writeStoredMarkVariant(DEFAULT_INK_MARK);
  }
  applyBrandPreview(state);
  subscribers.forEach((fn) => fn());
}

export function getMarkVariant(): InkMarkVariant {
  if (currentMark === undefined) currentMark = readStoredMarkVariant();
  return currentMark;
}

export function setMarkVariant(variant: InkMarkVariant): void {
  currentMark = variant;
  writeStoredMarkVariant(variant);
  subscribers.forEach((fn) => fn());
}

export function subscribeBrandPreview(onChange: () => void): () => void {
  subscribers.add(onChange);
  return () => {
    subscribers.delete(onChange);
  };
}

/**
 * Boot: honour `?brand=` if present, otherwise whatever was remembered, and
 * apply it before first render. Returns the state it settled on. `?mark=`
 * rides along the same way; `?brand=off` resets it to the default mark.
 */
export function initBrandPreview(search: string = window.location.search): BrandPreviewState | null {
  const param = parseBrandParam(search);
  if (param === "off") writeStoredBrandPreview(null);
  else if (param !== null) writeStoredBrandPreview(param);

  // The param wins even when storage refuses to hold it.
  current = param === "off" ? null : param ?? readStoredBrandPreview();

  const mark = parseMarkParam(search);
  if (param === "off") writeStoredMarkVariant(DEFAULT_INK_MARK);
  else if (mark !== null) writeStoredMarkVariant(mark);
  currentMark = param === "off" ? DEFAULT_INK_MARK : mark ?? readStoredMarkVariant();

  applyBrandPreview(current);
  return current;
}
