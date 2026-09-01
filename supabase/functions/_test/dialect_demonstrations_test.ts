import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getDialectDemonstrations, type Dialect } from "../_shared/dialectHelpers.ts";
import { detectMsaLeaks } from "../_shared/msaLeakDetector.ts";

/**
 * The worked examples the Brain shows every model, checked against the detector
 * that judges the model's output.
 *
 * These demonstrations exist because of the finding in AL-QASIDA
 * (arXiv:2412.04193): models under-produce dialectal Arabic out of reluctance
 * rather than inability, and few-shot demonstration is what moves them. That
 * makes them the one block of Arabic in the codebase the model is explicitly
 * told to imitate — so a leak inside a demonstration is not a cosmetic problem,
 * it is the app teaching the exact failure the leak detector, the repair pass
 * and the native-speaker validator are all paid to catch downstream.
 *
 * Checked with an empty `extraTokens`, which is the rulebook-less path on
 * purpose: the demonstrations are hard-coded precisely so they survive a cold
 * cache or a Postgres outage, so they have to be clean under the hardcoded
 * lists alone.
 */

const DIALECTS: Dialect[] = ["Gulf", "Egyptian", "Yemeni"];

/** Signature forms that make each block unmistakably its own dialect. */
const MARKERS: Record<Dialect, string[]> = {
  // Gulf: the "how are you" and the "now" that Egyptian and Yemeni don't share.
  Gulf: ["شخبارك", "هالحين", "واجد"],
  // Egyptian: ده/دي-land — the greeting, the "now", the "like that".
  Egyptian: ["إزيك", "دلوقتي", "كده"],
  // Yemeni: the "now" that is neither هالحين nor دلوقتي, plus the food that
  // places it in Sana'a rather than the Gulf.
  Yemeni: ["ذحين", "بغيت", "سلتة"],
};

for (const dialect of DIALECTS) {
  Deno.test(`${dialect} demonstrations contain no MSA or wrong-dialect leaks`, () => {
    const text = getDialectDemonstrations(dialect);
    const result = detectMsaLeaks(text, dialect);

    assertEquals(
      result.leaks,
      [],
      `The ${dialect} worked examples leak ${result.leaks.join(", ")}. ` +
        `The model is told to imitate this text, so a leak here is taught, not caught.`,
    );
  });

  Deno.test(`${dialect} demonstrations are recognisably ${dialect}`, () => {
    const text = getDialectDemonstrations(dialect);

    // Leak-free is only half of it: a block of flawless MSA-avoiding Arabic
    // that could be any dialect demonstrates nothing about *this* one.
    for (const marker of MARKERS[dialect]) {
      assertStringIncludes(text, marker);
    }
  });

  Deno.test(`${dialect} demonstrations show answers, not a word list`, () => {
    const text = getDialectDemonstrations(dialect);

    // The rulebook already renders vocabulary contrasts. What these add is a
    // worked *response* — several of them, each long enough to be a sentence
    // the model can pattern-match a full reply against.
    const answers = text.split("\n").filter((line) => line.startsWith("A: "));
    assert(answers.length >= 3, `expected at least 3 worked answers, got ${answers.length}`);
    for (const answer of answers) {
      assert(
        answer.length > 40,
        `a one-word answer demonstrates nothing about sustaining dialect: ${answer}`,
      );
    }
  });
}

Deno.test("each dialect gets its own demonstrations", () => {
  const blocks = DIALECTS.map(getDialectDemonstrations);
  assertEquals(new Set(blocks).size, DIALECTS.length, "two dialects share a block");
});

Deno.test("an unknown dialect still gets demonstrations rather than nothing", () => {
  // The prompt builders call this unconditionally. Returning "" for an
  // unrecognised dialect would silently drop the intervention on exactly the
  // path where nobody is looking.
  const text = getDialectDemonstrations("Levantine" as Dialect);
  assert(text.length > 0);
});
