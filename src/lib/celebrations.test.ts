import { describe, expect, it } from "vitest";
import {
  ARDAH,
  TIER_DURATION_MS,
  danceById,
  danceForDialect,
  jitter,
  parseCelebrateParam,
  poseAt,
} from "./celebrations";

/**
 * The timing and catalogue behind the milestone dances. The scene draws
 * whatever `poseAt` says, so these are the rules a frame has to obey: the
 * first frame is clean, every later swap lands on a beat, and the same moment
 * always looks the same.
 */

describe("danceForDialect", () => {
  it("gives Gulf learners the Ardah, however the dialect is spelled", () => {
    expect(danceForDialect("Gulf")).toBe(ARDAH);
    expect(danceForDialect("gulf")).toBe(ARDAH);
  });

  it("has nothing yet for the dialects whose dances aren't made", () => {
    expect(danceForDialect("Egyptian")).toBeNull();
    expect(danceForDialect("Yemeni")).toBeNull();
  });

  it("has nothing for a missing dialect", () => {
    expect(danceForDialect(undefined)).toBeNull();
    expect(danceForDialect("")).toBeNull();
  });
});

describe("poseAt", () => {
  it("opens on the sequence's first pose, untilted, so a still render is clean", () => {
    expect(poseAt(ARDAH, 0)).toEqual({ step: 0, pose: ARDAH.sequence[0], rotateDeg: 0, shiftPct: 0, drummerPose: 0 });
    expect(poseAt(ARDAH, ARDAH.beatMs - 1).pose).toBe(ARDAH.sequence[0]);
  });

  it("moves to the next pose exactly on the beat", () => {
    for (let step = 0; step < ARDAH.sequence.length; step++) {
      expect(poseAt(ARDAH, step * ARDAH.beatMs).pose).toBe(ARDAH.sequence[step]);
    }
  });

  it("loops the sequence", () => {
    const n = ARDAH.sequence.length;
    expect(poseAt(ARDAH, n * ARDAH.beatMs).pose).toBe(ARDAH.sequence[0]);
    expect(poseAt(ARDAH, (n + 3) * ARDAH.beatMs).pose).toBe(ARDAH.sequence[3]);
  });

  it("returns the same frame for the same moment", () => {
    expect(poseAt(ARDAH, 5 * ARDAH.beatMs + 10)).toEqual(poseAt(ARDAH, 5 * ARDAH.beatMs + 200));
  });

  it("keeps the hand-placed wobble small", () => {
    for (let step = 1; step < 200; step++) {
      const f = poseAt(ARDAH, step * ARDAH.beatMs);
      expect(Math.abs(f.rotateDeg)).toBeLessThanOrEqual(2.5);
      expect(Math.abs(f.shiftPct)).toBeLessThanOrEqual(3);
    }
  });

  it("strikes the drum on every half beat", () => {
    const half = ARDAH.beatMs / 2;
    expect([0, 1, 2, 3].map((i) => poseAt(ARDAH, i * half).drummerPose)).toEqual([0, 1, 0, 1]);
  });

  it("treats a negative clock as the start", () => {
    expect(poseAt(ARDAH, -50).step).toBe(0);
  });
});

describe("jitter", () => {
  it("stays in [0, 1) and differs by salt", () => {
    for (let i = 0; i < 100; i++) {
      const v = jitter(i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(jitter(3, 0)).not.toBe(jitter(3, 1));
  });
});

describe("the Ardah itself", () => {
  it("returns to the home pose between big moves", () => {
    // Every other beat is the dip: without it the swap reads as a slideshow.
    ARDAH.sequence.forEach((pose, i) => {
      if (i % 2 === 1) expect(pose).toBe(1);
    });
  });

  it("praises in Gulf Arabic", () => {
    expect(ARDAH.praise).toBe("كفو!");
  });
});

describe("tiers", () => {
  it("get longer as the milestone gets bigger", () => {
    expect(TIER_DURATION_MS.small).toBeLessThan(TIER_DURATION_MS.medium);
    expect(TIER_DURATION_MS.medium).toBeLessThan(TIER_DURATION_MS.large);
  });
});

describe("parseCelebrateParam", () => {
  it("plays a dance by id at the medium tier", () => {
    expect(parseCelebrateParam("?celebrate=ardah")).toEqual({ dance: ARDAH, tier: "medium" });
  });

  it("takes a tier after a dash", () => {
    expect(parseCelebrateParam("?celebrate=ardah-large")?.tier).toBe("large");
    expect(parseCelebrateParam("?celebrate=Ardah-Small")?.tier).toBe("small");
    expect(parseCelebrateParam("?celebrate=ardah-huge")?.tier).toBe("medium");
  });

  it("ignores a dance that doesn't exist, or no parameter at all", () => {
    expect(parseCelebrateParam("?celebrate=dabke")).toBeNull();
    expect(parseCelebrateParam("?brand=ink")).toBeNull();
    expect(parseCelebrateParam("")).toBeNull();
  });

  it("finds dances by id", () => {
    expect(danceById("ardah")).toBe(ARDAH);
    expect(danceById("nope")).toBeNull();
  });
});
