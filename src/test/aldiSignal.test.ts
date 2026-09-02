import { describe, expect, it } from "vitest";
import { aldiModel, parseAldiResponse } from "../../supabase/functions/_shared/aldiSignal";

/**
 * The ALDi signal is log-only and inert until configured; what must hold is
 * that it never invents a score from a shape it does not recognise, and that
 * an unset model means "off", not "error".
 */

describe("parseAldiResponse", () => {
  it("reads the shapes HuggingFace serves a regression head in", () => {
    expect(parseAldiResponse(0.83)).toBeCloseTo(0.83);
    expect(parseAldiResponse([0.4])).toBeCloseTo(0.4);
    expect(parseAldiResponse([{ label: "ALDi", score: 0.91 }])).toBeCloseTo(0.91);
    expect(parseAldiResponse([[{ label: "ALDi", score: 0.2 }]])).toBeCloseTo(0.2);
    expect(parseAldiResponse({ score: 0.55 })).toBeCloseTo(0.55);
  });

  it("clamps to 0..1 and refuses anything else", () => {
    expect(parseAldiResponse(1.7)).toBe(1);
    expect(parseAldiResponse(-0.2)).toBe(0);
    expect(parseAldiResponse("0.5")).toBeNull();
    expect(parseAldiResponse({ label: "x" })).toBeNull();
    expect(parseAldiResponse([])).toBeNull();
    expect(parseAldiResponse(null)).toBeNull();
  });
});

describe("aldiModel", () => {
  it("is null — switched off — until ALDI_HF_MODEL is set", () => {
    expect(aldiModel({ get: () => undefined })).toBeNull();
    expect(aldiModel({ get: () => "   " })).toBeNull();
    expect(aldiModel({ get: (k) => (k === "ALDI_HF_MODEL" ? "AMR-KELEG/Sentence-ALDi" : undefined) })).toBe("AMR-KELEG/Sentence-ALDi");
  });
});
