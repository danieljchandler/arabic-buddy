import { describe, expect, it } from "vitest";
import {
  aggregateChannelScores,
  scoreDialectMarkers,
  scoreLineForDialect,
} from "../../supabase/functions/_shared/dialectMarkers";

// The scorer classifies caption text by closed-class function words. Content
// words are shared across dialects — a caption saying كلب could be from Cairo,
// Riyadh or Sanaa — so everything below tests that the *surrounding* words
// carry the classification, and that the scorer abstains rather than guesses
// when they don't.

describe("scoreDialectMarkers", () => {
  it("classifies an Egyptian line by its function words", () => {
    const s = scoreDialectMarkers("أنا عايز أشوف الكلب ده دلوقتي");
    expect(s.best).toBe("Egyptian");
    expect(s.dialectScores.Egyptian).toBeGreaterThan(0);
    expect(s.dialectScores.Gulf).toBe(0);
    expect(s.confidence).toBe(1);
  });

  it("classifies a Gulf line", () => {
    const s = scoreDialectMarkers("شخبارك؟ عندنا كلاب وايد في البيت");
    expect(s.best).toBe("Gulf");
    expect(s.hits.Gulf).toEqual(expect.arrayContaining(["وايد", "شخبارك"]));
  });

  it("classifies a Yemeni line", () => {
    const s = scoreDialectMarkers("اشتي أروح السوق ذحين");
    expect(s.best).toBe("Yemeni");
    expect(s.dialectScores.Yemeni).toBeGreaterThan(0);
  });

  it("flags MSA when MSA markers dominate", () => {
    const s = scoreDialectMarkers("سوف نذهب الآن لأن هذا هو الذي يجب فعله");
    expect(s.best).toBe("MSA");
    expect(s.msaScore).toBeGreaterThan(0);
  });

  // The Gulf/Yemeni overlap is real (شلون, وش, زين are attested in both — see
  // the ALWAYS_ALLOWED audit in msaLeakDetector). A shared marker alone must
  // produce a tie with zero confidence, not a coin-flip classification.
  it("gives shared Gulf/Yemeni markers to both sides with zero confidence", () => {
    const s = scoreDialectMarkers("شلونك اليوم");
    expect(s.dialectScores.Gulf).toBeCloseTo(s.dialectScores.Yemeni);
    expect(s.dialectScores.Gulf).toBeGreaterThan(0);
    expect(s.confidence).toBe(0);
  });

  it("abstains on marker-free text instead of guessing", () => {
    // A bare content word is everyone's word.
    const s = scoreDialectMarkers("كلب كبير");
    expect(s.best).toBeNull();
    expect(s.confidence).toBe(0);
  });

  it("does not treat Gulf/Yemeni demonstratives as MSA", () => {
    // هذا/هذه/عندما are ordinary Gulf and Yemeni speech per the 2026-08
    // audits; penalizing them would mark half the Khaliji corpus as MSA.
    const s = scoreDialectMarkers("هذا البيت كبير");
    expect(s.msaScore).toBe(0);
  });

  it("matches marker spelling variants through normalization", () => {
    // إزّاي with hamza and tashkeel must still hit the ازاي marker.
    const s = scoreDialectMarkers("إِزّاي حضرتك؟");
    expect(s.best).toBe("Egyptian");
  });

  it("counts pan-dialect colloquial words as general, not directional", () => {
    const s = scoreDialectMarkers("بس خلاص يلا");
    expect(s.generalScore).toBeGreaterThan(0);
    expect(s.best).toBeNull();
  });

  it("handles empty input", () => {
    const s = scoreDialectMarkers("");
    expect(s.tokenCount).toBe(0);
    expect(s.best).toBeNull();
    expect(s.msaScore).toBe(0);
  });

  it("counts repeated markers each time they occur", () => {
    // Long enough that neither line saturates the density cap.
    const filler = "كلمة بعد كلمة بعد كلمة بعد كلمة بعد كلمة بعد كلمة";
    const once = scoreDialectMarkers(`وايد ${filler}`);
    const twice = scoreDialectMarkers(`وايد وايد ${filler}`);
    expect(once.dialectScores.Gulf).toBeGreaterThan(0);
    expect(once.dialectScores.Gulf).toBeLessThan(1);
    expect(twice.dialectScores.Gulf).toBeGreaterThan(once.dialectScores.Gulf);
  });
});

describe("scoreLineForDialect", () => {
  it("credits shared markers to the claimed dialect at split weight", () => {
    // A Yemeni channel's شلونك is Yemeni evidence, not noise.
    const { dialectScore } = scoreLineForDialect("شلونك يا صديقي", "Yemeni");
    expect(dialectScore).toBeGreaterThan(0);
  });

  it("reports MSA contamination alongside the dialect score", () => {
    const { dialectScore, msaScore } = scoreLineForDialect(
      "سوف نذهب بينما ليس لدينا وقت",
      "Gulf",
    );
    expect(dialectScore).toBe(0);
    expect(msaScore).toBeGreaterThan(0);
  });
});

describe("aggregateChannelScores", () => {
  const yemeniLines = [
    "اشتي أشرب شاهي ذحين",
    "عاد ما شي وقت اليوم",
    "وين رحت أمس يا أخي",
  ];

  it("rolls dialect and MSA scores up token-weighted", () => {
    const agg = aggregateChannelScores(yemeniLines, "Yemeni");
    expect(agg.dialectScore).toBeGreaterThan(0);
    expect(agg.msaScore).toBe(0);
    expect(agg.misfitShare).toBe(0);
    expect(agg.lineCount).toBe(3);
  });

  it("surfaces misfit lines that confidently point elsewhere", () => {
    const agg = aggregateChannelScores(
      [...yemeniLines, "أنا عايز أروح دلوقتي", "النهارده كده خالص"],
      "Yemeni",
    );
    expect(agg.misfitShare).toBeGreaterThan(0);
  });

  it("handles an empty corpus", () => {
    const agg = aggregateChannelScores([], "Gulf");
    expect(agg.dialectScore).toBe(0);
    expect(agg.misfitShare).toBe(0);
  });
});
