import { describe, expect, it } from "vitest";
import { buildPagePayload, hintKeyForPath, listingContext } from "./pageAiContext";
import { PAGE_HINTS } from "./pageHints";

/**
 * The route→hint mapping is the assistant's fallback knowledge of "where the
 * learner is" on pages that don't publish their own context. Keys in
 * PAGE_HINTS are slugs, not paths, so the mapping is hand-written — these
 * tests pin the resolution rules and catch a renamed hint key.
 */

describe("hintKeyForPath", () => {
  it("maps routes to their PAGE_HINTS slugs", () => {
    expect(hintKeyForPath("/discover")).toBe("discover");
    expect(hintKeyForPath("/review/my-words")).toBe("mywords-review");
    expect(hintKeyForPath("/review")).toBe("review");
    expect(hintKeyForPath("/grammar")).toBe("grammar-drills");
    expect(hintKeyForPath("/analytics")).toBe("learning-analytics");
    expect(hintKeyForPath("/")).toBe("today");
  });

  it("matches param routes by prefix", () => {
    expect(hintKeyForPath("/discover/abc-123")).toBe("discover");
    expect(hintKeyForPath("/stories/story-9")).toBe("stories");
    expect(hintKeyForPath("/bible/lessons/l1")).toBe("bible-lessons");
  });

  it("returns null for unmapped routes rather than guessing", () => {
    expect(hintKeyForPath("/admin/topics")).toBeNull();
    expect(hintKeyForPath("/no-such-page")).toBeNull();
  });

  it("only points at hint keys that exist", () => {
    // A rename in pageHints.ts must break this test, not silently degrade
    // the assistant's fallback context.
    const paths = ["/discover", "/review", "/review/my-words", "/grammar", "/", "/battles"];
    for (const p of paths) {
      const key = hintKeyForPath(p);
      expect(key && PAGE_HINTS[key], `hint for ${p}`).toBeTruthy();
    }
  });
});

describe("buildPagePayload", () => {
  it("prefers the registered page context and truncates it", () => {
    const payload = buildPagePayload("/discover/xyz", {
      kind: "video",
      title: "T".repeat(200),
      summary: "S".repeat(500),
      content: "C".repeat(2000),
    });

    expect(payload.route).toBe("/discover/xyz");
    expect(payload.title.length).toBeLessThanOrEqual(121); // 120 + ellipsis
    expect(payload.summary!.length).toBeLessThanOrEqual(401);
    expect(payload.content!.length).toBeLessThanOrEqual(1501);
  });

  it("falls back to the PAGE_HINTS blurb for the route", () => {
    const payload = buildPagePayload("/discover", null);
    expect(payload.title).toBe(PAGE_HINTS["discover"].title);
    expect(payload.summary).toBe(PAGE_HINTS["discover"].body);
  });

  it("still says what app it is when the route matches nothing", () => {
    // Every declared route resolves to a hint (askAiCoverage.test.ts holds it
    // to that), so this is the 404 page. "Hikaya" on its own left the tutor
    // guessing what kind of app it had been dropped into.
    const payload = buildPagePayload("/no-such-page", null);
    expect(payload.route).toBe("/no-such-page");
    expect(payload.title).toBe("Hikaya");
    expect(payload.summary).toMatch(/spoken \(dialectal\) Arabic/);
  });
});

describe("listingContext", () => {
  const items = [
    { arabic: "قهوة", english: "coffee" },
    { arabic: "شاي", english: "tea" },
  ];

  it("publishes the rows on screen, in order, as the document", () => {
    const ctx = listingContext({
      title: "My Words",
      summary: "Saved vocabulary.",
      label: "Words in this deck",
      items,
    });

    expect(ctx.document?.label).toBe("Words in this deck");
    expect(ctx.document?.lines).toEqual([
      { index: 1, arabic: "قهوة", english: "coffee" },
      { index: 2, arabic: "شاي", english: "tea" },
    ]);
    expect(ctx.position?.total).toBe(2);
  });

  it("caps the rows but keeps the real total visible", () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ english: `word ${i}` }));
    const ctx = listingContext({
      title: "My Words",
      summary: "Saved vocabulary.",
      label: "Words in this deck",
      items: many,
      limit: 10,
    });

    expect(ctx.document?.lines).toHaveLength(10);
    // Otherwise "how many do I have left?" gets answered from the cap.
    expect(ctx.position?.total).toBe(120);
  });

  it("drops blank rows rather than publishing empty lines", () => {
    const ctx = listingContext({
      title: "Stories",
      summary: "The library.",
      label: "Stories",
      items: [{ arabic: "  ", english: null }, { english: "The market" }],
    });

    expect(ctx.document?.lines).toEqual([{ index: 2, english: "The market" }]);
  });

  it("omits the document entirely while the list is still empty", () => {
    // A loading page must not tell the tutor the library is empty.
    const ctx = listingContext({
      title: "Stories",
      summary: "The library.",
      label: "Stories",
      items: [],
    });

    expect(ctx.document).toBeUndefined();
    expect(ctx.position).toBeUndefined();
    expect(ctx.title).toBe("Stories");
  });
});
