import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BRAND_DEFAULT_ATTRIBUTE,
  BRAND_DIRECTIONS,
  BRAND_FONT_LINK_ID,
  BRAND_MARK_STORAGE_KEY,
  BRAND_PREVIEW_STORAGE_KEY,
  DEFAULT_INK_MARK,
  LEGACY_FONTS_HREF,
  applyBrandPreview,
  getActiveBrand,
  getBrandDirection,
  getBrandPreview,
  getMarkVariant,
  initBrandPreview,
  isBrandDirectionId,
  parseBrandParam,
  parseMarkParam,
  readDeclaredDefaultBrand,
  readStoredBrandPreview,
  readStoredMarkVariant,
  setBrandPreview,
  setMarkVariant,
  subscribeBrandPreview,
  writeStoredBrandPreview,
  writeStoredMarkVariant,
} from "./brandPreview";

/**
 * The opt-in brand preview (brandPreview.ts).
 *
 * The property everything else hangs off: nobody sees a preview without a
 * `?brand=` link. With no parameter and nothing stored, boot must leave
 * <html> without `data-brand` and inject no font link — that is what keeps
 * the default experience untouched. The rest is the plumbing a preview needs
 * to be usable on a deploy preview: it survives navigation (storage), it can
 * be switched off, it never throws on the boot path when storage does, and
 * switching directions does not pile up stylesheet links.
 */

const fontLinks = () => document.querySelectorAll(`#${BRAND_FONT_LINK_ID}`);

function reset() {
  localStorage.clear();
  document.documentElement.removeAttribute("data-brand");
  document.documentElement.removeAttribute(BRAND_DEFAULT_ATTRIBUTE);
  document.getElementById(BRAND_FONT_LINK_ID)?.remove();
}

beforeEach(reset);

afterEach(() => {
  vi.restoreAllMocks();
  // Module state outlives a test; put it back to "no preview".
  setBrandPreview(null);
  reset();
});

describe("the directions", () => {
  it("lists weave, ink and souq, each with a label and a Google Fonts stylesheet", () => {
    expect(BRAND_DIRECTIONS.map((d) => d.id)).toEqual(["weave", "ink", "souq"]);
    for (const d of BRAND_DIRECTIONS) {
      expect(d.label).toBeTruthy();
      expect(d.summary).toBeTruthy();
      expect(d.fontsHref).toMatch(/^https:\/\/fonts\.googleapis\.com\/css2\?family=/);
      expect(d.fontsHref).toMatch(/display=swap$/);
    }
  });

  it("recognises only its own ids", () => {
    expect(isBrandDirectionId("ink")).toBe(true);
    expect(isBrandDirectionId("current")).toBe(false);
    expect(isBrandDirectionId("INK")).toBe(false);
    expect(isBrandDirectionId(undefined)).toBe(false);
    expect(getBrandDirection("souq").label).toBe("Souq");
  });
});

describe("parseBrandParam", () => {
  it("reads a direction, case- and whitespace-insensitively", () => {
    expect(parseBrandParam("?brand=weave")).toBe("weave");
    expect(parseBrandParam("?foo=1&brand=Ink")).toBe("ink");
    expect(parseBrandParam("?brand=%20souq%20")).toBe("souq");
  });

  it("reads off as forgetting the preview, and current as the previous look", () => {
    expect(parseBrandParam("?brand=off")).toBe("off");
    // Not a reset: with a default brand shipped, "current" is the watercolour
    // look shown on purpose, for comparison.
    expect(parseBrandParam("?brand=current")).toBe("current");
  });

  it("ignores an absent or unknown value rather than reading it as off", () => {
    // A typo must not silently end a preview someone is in the middle of.
    expect(parseBrandParam("")).toBeNull();
    expect(parseBrandParam("?dialect=gulf")).toBeNull();
    expect(parseBrandParam("?brand=neon")).toBeNull();
    expect(parseBrandParam("?brand=")).toBeNull();
  });
});

describe("storage", () => {
  it("round-trips a state under the new-spelling key, and removes it on null", () => {
    writeStoredBrandPreview("ink");
    expect(localStorage.getItem(BRAND_PREVIEW_STORAGE_KEY)).toBe("ink");
    expect(BRAND_PREVIEW_STORAGE_KEY).toBe("hikaya_brand_preview");
    expect(readStoredBrandPreview()).toBe("ink");

    writeStoredBrandPreview("current");
    expect(readStoredBrandPreview()).toBe("current");

    writeStoredBrandPreview(null);
    expect(localStorage.getItem(BRAND_PREVIEW_STORAGE_KEY)).toBeNull();
    expect(readStoredBrandPreview()).toBeNull();
  });

  it("ignores a corrupted stored value", () => {
    localStorage.setItem(BRAND_PREVIEW_STORAGE_KEY, "neon");
    expect(readStoredBrandPreview()).toBeNull();
  });

  it("never throws when storage does (private mode, blocked site data)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readStoredBrandPreview()).toBeNull();
    expect(() => writeStoredBrandPreview("weave")).not.toThrow();
    expect(() => writeStoredBrandPreview(null)).not.toThrow();
  });
});

describe("applyBrandPreview", () => {
  it("stamps data-brand and injects the direction's font link once", () => {
    applyBrandPreview("weave");
    expect(document.documentElement.getAttribute("data-brand")).toBe("weave");
    const links = fontLinks();
    expect(links).toHaveLength(1);
    const link = links[0] as HTMLLinkElement;
    expect(link.rel).toBe("stylesheet");
    expect(link.getAttribute("href")).toBe(getBrandDirection("weave").fontsHref);
    expect(link.parentElement).toBe(document.head);

    // Idempotent: applying again does not add a second link.
    applyBrandPreview("weave");
    expect(fontLinks()).toHaveLength(1);
  });

  it("retargets the same link when the direction changes", () => {
    applyBrandPreview("weave");
    applyBrandPreview("souq");
    expect(document.documentElement.getAttribute("data-brand")).toBe("souq");
    expect(fontLinks()).toHaveLength(1);
    expect(fontLinks()[0].getAttribute("href")).toBe(getBrandDirection("souq").fontsHref);
  });

  it("clears both the attribute and the link for current and for off", () => {
    applyBrandPreview("ink");
    applyBrandPreview("current");
    expect(document.documentElement.hasAttribute("data-brand")).toBe(false);
    expect(fontLinks()).toHaveLength(0);

    applyBrandPreview("ink");
    applyBrandPreview(null);
    expect(document.documentElement.hasAttribute("data-brand")).toBe(false);
    expect(fontLinks()).toHaveLength(0);
  });
});

describe("initBrandPreview (boot)", () => {
  it("does nothing at all for someone who never asked", () => {
    expect(initBrandPreview("")).toBeNull();
    expect(document.documentElement.hasAttribute("data-brand")).toBe(false);
    expect(fontLinks()).toHaveLength(0);
    expect(localStorage.getItem(BRAND_PREVIEW_STORAGE_KEY)).toBeNull();
    expect(getBrandPreview()).toBeNull();
  });

  it("switches a direction on from the URL and remembers it", () => {
    expect(initBrandPreview("?brand=ink")).toBe("ink");
    expect(document.documentElement.getAttribute("data-brand")).toBe("ink");
    expect(localStorage.getItem(BRAND_PREVIEW_STORAGE_KEY)).toBe("ink");
    expect(getBrandPreview()).toBe("ink");
  });

  it("keeps a remembered preview on a later page load with no parameter", () => {
    localStorage.setItem(BRAND_PREVIEW_STORAGE_KEY, "souq");
    expect(initBrandPreview("?dialect=gulf")).toBe("souq");
    expect(document.documentElement.getAttribute("data-brand")).toBe("souq");
  });

  it("forgets the preview on ?brand=off", () => {
    localStorage.setItem(BRAND_PREVIEW_STORAGE_KEY, "weave");
    expect(initBrandPreview("?brand=off")).toBeNull();
    expect(localStorage.getItem(BRAND_PREVIEW_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.hasAttribute("data-brand")).toBe(false);
  });

  it("still applies a URL preview for the session when storage refuses it", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(initBrandPreview("?brand=weave")).toBe("weave");
    expect(document.documentElement.getAttribute("data-brand")).toBe("weave");
    expect(getBrandPreview()).toBe("weave");
  });

  it("reads window.location by default", () => {
    window.history.replaceState(null, "", "/today?brand=souq");
    try {
      expect(initBrandPreview()).toBe("souq");
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });
});

describe("the store", () => {
  it("notifies subscribers on every change and stops after unsubscribe", () => {
    const seen: Array<string | null> = [];
    const unsubscribe = subscribeBrandPreview(() => seen.push(getBrandPreview()));

    setBrandPreview("weave");
    setBrandPreview("current");
    setBrandPreview(null);
    unsubscribe();
    setBrandPreview("ink");

    expect(seen).toEqual(["weave", "current", null]);
    expect(getBrandPreview()).toBe("ink");
    expect(document.documentElement.getAttribute("data-brand")).toBe("ink");
    expect(localStorage.getItem(BRAND_PREVIEW_STORAGE_KEY)).toBe("ink");
  });

  it("falls back to storage when boot never ran (a fresh module)", async () => {
    // Tests and any tree rendered without main.tsx skip initBrandPreview; the
    // switcher must still see a remembered preview rather than none.
    vi.resetModules();
    localStorage.setItem(BRAND_PREVIEW_STORAGE_KEY, "weave");
    const fresh = await import("./brandPreview");
    expect(fresh.getBrandPreview()).toBe("weave");
  });
});

/**
 * Ink's two marks (`?mark=sadu|clean`). The owner chose the faint-sadu mark
 * as the primary, so it is the default and is never written down; the clean
 * redraw is the secondary, and choosing it behaves like the preview it rides
 * with: read off the URL, remembered on the device, ignored when misspelt,
 * and forgotten when the preview ends.
 */
describe("the Ink mark variant", () => {
  it("defaults to the sadu mark", () => {
    expect(DEFAULT_INK_MARK).toBe("sadu");
    expect(getMarkVariant()).toBe("sadu");
  });

  it("parses sadu and clean, case-insensitively, and ignores anything else", () => {
    expect(parseMarkParam("?mark=sadu")).toBe("sadu");
    expect(parseMarkParam("?brand=ink&mark=%20Clean%20")).toBe("clean");
    expect(parseMarkParam("")).toBeNull();
    expect(parseMarkParam("?mark=")).toBeNull();
    expect(parseMarkParam("?mark=weave")).toBeNull();
  });

  it("stores clean under its own new-spelling key and the default as nothing", () => {
    expect(BRAND_MARK_STORAGE_KEY).toBe("hikaya_brand_mark");
    expect(readStoredMarkVariant()).toBe("sadu");

    writeStoredMarkVariant("clean");
    expect(localStorage.getItem(BRAND_MARK_STORAGE_KEY)).toBe("clean");
    expect(readStoredMarkVariant()).toBe("clean");

    writeStoredMarkVariant("sadu");
    expect(localStorage.getItem(BRAND_MARK_STORAGE_KEY)).toBeNull();
    expect(readStoredMarkVariant()).toBe("sadu");

    localStorage.setItem(BRAND_MARK_STORAGE_KEY, "neon");
    expect(readStoredMarkVariant()).toBe("sadu");
  });

  it("falls back to the default, without throwing, when storage does", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(readStoredMarkVariant()).toBe("sadu");
    expect(() => writeStoredMarkVariant("clean")).not.toThrow();
  });

  it("is read off the URL at boot and remembered for the next load", () => {
    initBrandPreview("?brand=ink&mark=clean");
    expect(getMarkVariant()).toBe("clean");
    expect(localStorage.getItem(BRAND_MARK_STORAGE_KEY)).toBe("clean");

    // A later load with no parameter keeps it.
    initBrandPreview("");
    expect(getMarkVariant()).toBe("clean");

    // ?mark=sadu switches back and stores nothing.
    initBrandPreview("?mark=sadu");
    expect(getMarkVariant()).toBe("sadu");
    expect(localStorage.getItem(BRAND_MARK_STORAGE_KEY)).toBeNull();
  });

  it("leaves storage alone for someone who never asked", () => {
    initBrandPreview("");
    expect(getMarkVariant()).toBe("sadu");
    expect(localStorage.getItem(BRAND_MARK_STORAGE_KEY)).toBeNull();
  });

  it("is forgotten with the preview, by ?brand=off or by the switcher's ×", () => {
    initBrandPreview("?brand=ink&mark=clean");
    initBrandPreview("?brand=off&mark=clean");
    expect(getMarkVariant()).toBe("sadu");
    expect(localStorage.getItem(BRAND_MARK_STORAGE_KEY)).toBeNull();

    setBrandPreview("ink");
    setMarkVariant("clean");
    expect(getMarkVariant()).toBe("clean");
    setBrandPreview(null);
    expect(getMarkVariant()).toBe("sadu");
    expect(localStorage.getItem(BRAND_MARK_STORAGE_KEY)).toBeNull();
  });

  it("notifies the same subscribers the preview does", () => {
    const seen: string[] = [];
    const unsubscribe = subscribeBrandPreview(() => seen.push(getMarkVariant()));
    setMarkVariant("clean");
    setMarkVariant("sadu");
    unsubscribe();
    setMarkVariant("clean");
    expect(seen).toEqual(["clean", "sadu"]);
  });

  it("reads a remembered choice when boot never ran (a fresh module)", async () => {
    vi.resetModules();
    localStorage.setItem(BRAND_MARK_STORAGE_KEY, "clean");
    const fresh = await import("./brandPreview");
    expect(fresh.getMarkVariant()).toBe("clean");
  });
});

/**
 * The default brand index.html declares (`data-brand-default`). With one
 * declared, "no preview" means that brand rather than the previous look: it
 * is stamped at boot, its faces are the static <link> so no extra stylesheet
 * is injected for it, and `current` has to fetch the previous look's faces
 * itself. Previews stay an explicit layer on top.
 */
describe("a declared default brand", () => {
  const declareInk = () => document.documentElement.setAttribute(BRAND_DEFAULT_ATTRIBUTE, "ink");

  it("reads the declaration, and ignores one that names nothing we know", () => {
    expect(readDeclaredDefaultBrand()).toBeNull();
    declareInk();
    expect(readDeclaredDefaultBrand()).toBe("ink");
    document.documentElement.setAttribute(BRAND_DEFAULT_ATTRIBUTE, "neon");
    expect(readDeclaredDefaultBrand()).toBeNull();
  });

  it("is what no preview renders, with no extra font link (index.html carries its faces)", () => {
    declareInk();
    applyBrandPreview(null);
    expect(document.documentElement.getAttribute("data-brand")).toBe("ink");
    expect(fontLinks()).toHaveLength(0);
  });

  it("makes the previous look fetch its own faces", () => {
    declareInk();
    applyBrandPreview("current");
    expect(document.documentElement.hasAttribute("data-brand")).toBe(false);
    expect(fontLinks()).toHaveLength(1);
    expect(fontLinks()[0].getAttribute("href")).toBe(LEGACY_FONTS_HREF);
  });

  it("adds another direction's faces over it, and drops them on the way back", () => {
    declareInk();
    applyBrandPreview("weave");
    expect(document.documentElement.getAttribute("data-brand")).toBe("weave");
    expect(fontLinks()[0].getAttribute("href")).toBe(getBrandDirection("weave").fontsHref);
    applyBrandPreview("ink");
    expect(document.documentElement.getAttribute("data-brand")).toBe("ink");
    expect(fontLinks()).toHaveLength(0);
  });

  it("is the active brand until someone asks for a preview", () => {
    expect(getActiveBrand()).toBe("current");
    declareInk();
    expect(getActiveBrand()).toBe("ink");
    setBrandPreview("souq");
    expect(getActiveBrand()).toBe("souq");
    setBrandPreview("current");
    expect(getActiveBrand()).toBe("current");
    setBrandPreview(null);
    expect(getActiveBrand()).toBe("ink");
  });

  it("boots into it, ?brand=off comes back to it, and ?brand=current is remembered", () => {
    declareInk();
    expect(initBrandPreview("")).toBeNull();
    expect(document.documentElement.getAttribute("data-brand")).toBe("ink");

    expect(initBrandPreview("?brand=current")).toBe("current");
    expect(localStorage.getItem(BRAND_PREVIEW_STORAGE_KEY)).toBe("current");
    expect(document.documentElement.hasAttribute("data-brand")).toBe(false);

    expect(initBrandPreview("?brand=off")).toBeNull();
    expect(localStorage.getItem(BRAND_PREVIEW_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.getAttribute("data-brand")).toBe("ink");
  });
});
