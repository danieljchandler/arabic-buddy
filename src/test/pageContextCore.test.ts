import { describe, expect, it } from "vitest";
import {
  CHAT_BUDGET,
  clampPageContext,
  formatTimestamp,
  hasPageContext,
  isElision,
  serializeFocusUpdate,
  serializePageContext,
  windowDocument,
  VOICE_BUDGET,
  type PageContextLine,
} from "../../supabase/functions/_shared/pageContextCore";

/**
 * The context model behind "the tutor can see the whole video, not just the
 * subtitle under the cursor". Three sides depend on it agreeing with itself —
 * the browser builds a payload, `assistant-chat` re-clamps it, and
 * `realtime-session-token` bakes it into a live call — so the rules live here
 * and are pinned here.
 */

const line = (i: number, text = `line ${i}`): PageContextLine => ({
  index: i,
  arabic: text,
  english: `english ${i}`,
});

const lines = (n: number): PageContextLine[] =>
  Array.from({ length: n }, (_, i) => line(i + 1));

describe("formatTimestamp", () => {
  it("renders mm:ss, and h:mm:ss past an hour", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(47)).toBe("0:47");
    expect(formatTimestamp(90)).toBe("1:30");
    expect(formatTimestamp(3661)).toBe("1:01:01");
  });

  it("floors fractions and refuses to render negative time", () => {
    expect(formatTimestamp(47.9)).toBe("0:47");
    expect(formatTimestamp(-5)).toBe("0:00");
  });
});

describe("windowDocument", () => {
  it("keeps everything when it already fits", () => {
    const all = windowDocument(lines(5), 2, 10_000);
    expect(all).toHaveLength(5);
    expect(all.some(isElision)).toBe(false);
  });

  it("keeps the focused line rather than the opening when it has to choose", () => {
    // The failure this exists to prevent: slice(0, N) keeps lines 1-3 of a
    // 200-line transcript and drops the line the learner is actually asking
    // about.
    const entries = windowDocument(lines(200), 149, 400);
    const kept = entries.filter((e): e is PageContextLine => !isElision(e));
    expect(kept.map((l) => l.index)).toContain(150);
  });

  it("reports dropped runs instead of closing the gap silently", () => {
    const entries = windowDocument(lines(200), 149, 400);
    expect(entries.some(isElision)).toBe(true);
    const dropped = entries
      .filter(isElision)
      .reduce((sum, e) => sum + e.elided, 0);
    const kept = entries.filter((e) => !isElision(e)).length;
    expect(dropped + kept).toBe(200);
  });

  it("reserves a short head so the document is still identifiable", () => {
    const entries = windowDocument(lines(200), 149, 1200);
    const kept = entries.filter((e): e is PageContextLine => !isElision(e));
    expect(kept.map((l) => l.index)).toContain(1);
    expect(kept.map((l) => l.index)).toContain(150);
  });

  it("does not reserve a head when the focus is already near the top", () => {
    const entries = windowDocument(lines(200), 1, 400);
    const kept = entries.filter((e): e is PageContextLine => !isElision(e));
    // Nothing is elided before a focus this early — the window covers the top.
    expect(isElision(entries[0])).toBe(false);
    expect(kept[0].index).toBe(1);
  });

  it("keeps the window contiguous around the focus", () => {
    const entries = windowDocument(lines(60), 29, 600);
    const kept = entries.filter((e): e is PageContextLine => !isElision(e));
    const body = kept.filter((l) => (l.index ?? 0) > 2).map((l) => l.index!);
    for (let i = 1; i < body.length; i++) {
      expect(body[i]).toBe(body[i - 1] + 1);
    }
  });

  it("stays inside the character budget", () => {
    const budget = 500;
    const entries = windowDocument(lines(300), 100, budget);
    const rendered = entries
      .filter((e): e is PageContextLine => !isElision(e))
      .map((l) => `${l.index}. ${l.arabic} — ${l.english}`)
      .join("\n");
    expect(rendered.length).toBeLessThanOrEqual(budget);
  });

  it("falls back to the top when the focus index is unknown", () => {
    const entries = windowDocument(lines(100), -1, 300);
    const kept = entries.filter((e): e is PageContextLine => !isElision(e));
    expect(kept[0].index).toBe(1);
  });

  it("handles an empty document", () => {
    expect(windowDocument([], 0, 1000)).toEqual([]);
  });
});

describe("clampPageContext", () => {
  it("caps every learner-influenced field", () => {
    const clamped = clampPageContext({
      route: "/r".repeat(200),
      title: "T".repeat(400),
      summary: "S".repeat(900),
      content: "C".repeat(4000),
      meta: { culturalContext: "X".repeat(4000) },
    });
    expect(clamped.route!.length).toBeLessThanOrEqual(CHAT_BUDGET.route + 1);
    expect(clamped.title!.length).toBeLessThanOrEqual(CHAT_BUDGET.title + 1);
    expect(clamped.summary!.length).toBeLessThanOrEqual(CHAT_BUDGET.summary + 1);
    expect(clamped.content!.length).toBeLessThanOrEqual(CHAT_BUDGET.content + 1);
    expect(clamped.meta!.culturalContext!.length).toBeLessThanOrEqual(
      CHAT_BUDGET.culturalContext + 1,
    );
  });

  it("caps list fields by count", () => {
    const clamped = clampPageContext({
      meta: {
        vocabulary: Array.from({ length: 100 }, (_, i) => ({ arabic: `w${i}`, english: `e${i}` })),
        grammarPoints: Array.from({ length: 100 }, (_, i) => `g${i}`),
        notes: Array.from({ length: 100 }, (_, i) => `n${i}`),
      },
    });
    expect(clamped.meta!.vocabulary).toHaveLength(CHAT_BUDGET.vocabulary);
    expect(clamped.meta!.grammarPoints).toHaveLength(CHAT_BUDGET.grammarPoints);
    expect(clamped.meta!.notes).toHaveLength(CHAT_BUDGET.notes);
  });

  it("drops junk rather than passing it through to a prompt", () => {
    const clamped = clampPageContext({
      title: "   ",
      content: "",
      document: {
        label: "Transcript",
        lines: [
          { arabic: "ok" },
          // Neither text field — nothing to say, so it should not survive.
          { index: 2 } as PageContextLine,
        ],
      },
      meta: { vocabulary: [{ arabic: "  " }], notes: ["  "] },
      position: { index: Number.NaN, total: Infinity },
    });
    expect(clamped.title).toBeUndefined();
    expect(clamped.content).toBeUndefined();
    expect(clamped.document!.lines).toHaveLength(1);
    expect(clamped.meta).toBeUndefined();
    expect(clamped.position).toBeUndefined();
  });

  it("drops a document with no lines and no text", () => {
    const clamped = clampPageContext({ document: { label: "Transcript", lines: [] } });
    expect(clamped.document).toBeUndefined();
  });

  it("survives null and undefined", () => {
    expect(clampPageContext(null)).toEqual({});
    expect(clampPageContext(undefined)).toEqual({});
  });

  it("gives voice a tighter document allowance than chat", () => {
    expect(VOICE_BUDGET.document).toBeLessThan(CHAT_BUDGET.document);
  });
});

describe("serializePageContext", () => {
  const videoPayload = {
    route: "/discover/abc",
    title: "Cooking with grandma",
    summary: "Watching a Gulf dialect video (A2).",
    content: "هذا هو — this is it",
    document: {
      label: "Full transcript of this video",
      sourceUrl: "https://example.com/v/1",
      lines: [
        { index: 1, arabic: "مرحبا", english: "hello", atSeconds: 0 },
        { index: 2, arabic: "كيف حالك", english: "how are you", atSeconds: 3 },
        { index: 3, arabic: "هذا هو", english: "this is it", atSeconds: 7 },
      ],
    },
    meta: {
      level: "A2",
      dialect: "Gulf",
      vocabulary: [{ arabic: "مرحبا", english: "hello" }],
      grammarPoints: ["present tense"],
      culturalContext: "Family cooking is a shared ritual.",
    },
    position: { index: 3, total: 3, atSeconds: 7, durationSeconds: 190 },
  };

  it("puts the learner's position and focus before the document", () => {
    const text = serializePageContext(videoPayload);
    const where = text.indexOf("Where the learner is");
    const focus = text.indexOf("In focus right now");
    const doc = text.indexOf("Full transcript");
    expect(where).toBeGreaterThan(-1);
    expect(where).toBeLessThan(focus);
    expect(focus).toBeLessThan(doc);
  });

  it("marks the focused line inside the document", () => {
    const text = serializePageContext(videoPayload);
    expect(text).toMatch(/▶ 3\. \[0:07\] هذا هو — this is it/);
    // And only that one.
    expect(text.match(/▶/g)).toHaveLength(1);
  });

  it("carries the source so the assistant can offer the original", () => {
    expect(serializePageContext(videoPayload)).toContain("https://example.com/v/1");
  });

  it("renders position, level, vocabulary, grammar and culture", () => {
    const text = serializePageContext(videoPayload);
    expect(text).toContain("line 3 of 3");
    expect(text).toContain("0:07 of 3:10");
    expect(text).toContain("Level: A2 · Dialect: Gulf");
    expect(text).toContain("Key vocabulary in this content: مرحبا (hello)");
    expect(text).toContain("Grammar in this content: present tense");
    expect(text).toContain("Cultural context: Family cooking is a shared ritual.");
  });

  it("spells out elisions so the model doesn't read a gap as continuity", () => {
    const text = serializePageContext(
      {
        document: { label: "Transcript", lines: lines(200) },
        position: { index: 150 },
      },
      { ...CHAT_BUDGET, document: 400 },
    );
    expect(text).toMatch(/… \d+ lines omitted …/);
    expect(text).toContain("▶ 150.");
  });

  it("renders a prose document when there are no lines", () => {
    const text = serializePageContext({
      document: { label: "Article", text: "Once upon a time." },
    });
    expect(text).toContain("Article:");
    expect(text).toContain("Once upon a time.");
  });

  it("is empty for an empty payload", () => {
    expect(serializePageContext({})).toBe("");
    expect(hasPageContext({})).toBe(false);
    expect(hasPageContext(videoPayload)).toBe(true);
  });
});

describe("serializeFocusUpdate", () => {
  it("carries the moving parts and not the document", () => {
    const note = serializeFocusUpdate({
      title: "Cooking with grandma",
      content: "هذا هو — this is it",
      document: { label: "Transcript", lines: lines(50) },
      position: { index: 40, total: 50, atSeconds: 95 },
      meta: { visualContext: "She is holding a pot." },
    });
    expect(note).toContain("line 40 of 50");
    expect(note).toContain("1:35");
    expect(note).toContain("In focus right now: هذا هو");
    expect(note).toContain("She is holding a pot.");
    expect(note).not.toContain("line 12");
  });

  it("says nothing when nothing has actually moved", () => {
    // A page title alone is not an update, and a note saying so would be noise
    // in the middle of a spoken conversation.
    expect(serializeFocusUpdate({ title: "Souq News", summary: "News in dialect." })).toBe("");
  });
});
