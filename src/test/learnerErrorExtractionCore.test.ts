import { describe, expect, it } from "vitest";
import {
  buildExtractionPrompt,
  clipInput,
  CONVERSATION_SOURCES,
  EXTRACTION_KINDS,
  MAX_INPUT_CHARS,
  MAX_ITEMS_PER_TURN,
  normalizeExtraction,
} from "../../supabase/functions/_shared/learnerErrorExtractionCore";

/**
 * The pure half of extract-learner-errors. The rule it exists to enforce:
 * open conversation has no reference the learner was matching, so the only
 * admissible evidence of an error is the tutor correcting it — everything the
 * model reports without `corrected_by_assistant: true` is dropped, whatever
 * else it says.
 */

const item = (over: Record<string, unknown> = {}) => ({
  produced_arabic: "أريد",
  target_arabic: "أبغى",
  error_kind: "msa_leak",
  corrected_by_assistant: true,
  note: "MSA verb; Gulf uses أبغى",
  ...over,
});

const opts = { source: "conversation" as const, dialect: "Gulf" };

describe("normalizeExtraction — what gets through", () => {
  it("keeps a corrected item with an Arabic target", () => {
    const rows = normalizeExtraction({ items: [item()] }, opts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "conversation",
      dialect: "Gulf",
      targetArabic: "أبغى",
      producedArabic: "أريد",
      errorKind: "msa_leak",
    });
    expect(rows[0].detail).toMatchObject({ note: "MSA verb; Gulf uses أبغى" });
  });

  it("drops anything the tutor did not correct — the whole point", () => {
    const rows = normalizeExtraction(
      { items: [item({ corrected_by_assistant: false }), item({ corrected_by_assistant: "true" })] },
      opts,
    );
    expect(rows).toEqual([]);
  });

  it("drops a target with no Arabic in it", () => {
    expect(normalizeExtraction({ items: [item({ target_arabic: "abgha" })] }, opts)).toEqual([]);
    expect(normalizeExtraction({ items: [item({ target_arabic: "" })] }, opts)).toEqual([]);
  });

  it("drops an item whose target equals what was produced, diacritics aside", () => {
    expect(normalizeExtraction({ items: [item({ produced_arabic: "أَبْغَى" })] }, opts)).toEqual([]);
  });

  it("allows an omission — nothing produced, a target to learn", () => {
    const rows = normalizeExtraction({ items: [item({ produced_arabic: "", error_kind: "omission" })] }, opts);
    expect(rows).toHaveLength(1);
    expect(rows[0].producedArabic).toBeNull();
    expect(rows[0].errorKind).toBe("omission");
  });

  it("files an unknown kind as other rather than rejecting the row", () => {
    const rows = normalizeExtraction({ items: [item({ error_kind: "vibes" })] }, opts);
    expect(rows[0].errorKind).toBe("other");
  });

  it("dedupes on target and caps the row count", () => {
    const many = Array.from({ length: 12 }, (_, i) => item({ target_arabic: `هدف${i % 8}` }));
    const rows = normalizeExtraction({ items: many }, opts);
    expect(rows.length).toBeLessThanOrEqual(MAX_ITEMS_PER_TURN);
    expect(new Set(rows.map((r) => r.targetArabic)).size).toBe(rows.length);
  });

  it("never throws on garbage", () => {
    for (const raw of [null, undefined, 42, "x", {}, { items: "no" }, { items: [null, 1, "s"] }]) {
      expect(normalizeExtraction(raw, opts)).toEqual([]);
    }
  });
});

describe("normalizeExtraction — the voice lane", () => {
  it("records which engine heard the learner, so a bad transcript can be traced", () => {
    const rows = normalizeExtraction({ items: [item()] }, {
      source: "voice",
      dialect: "Egyptian",
      asrProvider: "openai-realtime",
    });
    expect(rows[0].source).toBe("voice");
    expect(rows[0].detail).toMatchObject({ asr_provider: "openai-realtime" });
  });

  it("keeps the tutor's correction line in detail for the conversation lane", () => {
    const rows = normalizeExtraction({ items: [item()] }, { ...opts, correction: "Say أبغى, not أريد" });
    expect(rows[0].detail).toMatchObject({ correction: "Say أبغى, not أريد" });
  });
});

describe("buildExtractionPrompt", () => {
  it("names the dialect, forbids MSA targets, and demands the tool", () => {
    const { systemPromptExtra, userPrompt, tool } = buildExtractionPrompt({
      dialectLabel: "Gulf Arabic",
      source: "conversation",
      userText: "أريد ماء",
      assistantText: "[[CORRECTION]] Gulf uses أبغى\n\nتبي ماي؟",
      correction: "Gulf uses أبغى",
    });
    expect(systemPromptExtra).toContain("Gulf Arabic");
    expect(systemPromptExtra).toMatch(/never Modern Standard Arabic/);
    expect(systemPromptExtra).toMatch(/tool ONLY/);
    expect(userPrompt).toContain("أريد ماء");
    expect(userPrompt).toContain("explicit correction line");
    expect(tool.name).toBe("record_learner_errors");
    for (const kind of EXTRACTION_KINDS) expect(userPrompt).toContain(kind);
  });

  it("tells the model a voice transcript's spelling is the transcriber's, not the learner's", () => {
    const { systemPromptExtra, userPrompt } = buildExtractionPrompt({
      dialectLabel: "Egyptian Arabic",
      source: "voice",
      userText: "عايز مايه",
      assistantText: "تمام",
    });
    expect(systemPromptExtra).toMatch(/transcriber/);
    expect(userPrompt).toContain("(ASR transcript)");
  });

  it("clips oversized inputs before they reach the prompt", () => {
    const long = "ك".repeat(MAX_INPUT_CHARS * 2);
    expect(clipInput(long)).toHaveLength(MAX_INPUT_CHARS);
    expect(clipInput(undefined)).toBe("");
  });

  it("exports exactly the two sources the migration allows", () => {
    expect(CONVERSATION_SOURCES).toEqual(["conversation", "voice"]);
  });
});
