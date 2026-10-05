import { describe, expect, it } from "vitest";
import {
  ARDAH,
  ASSAYA,
  ASSAYA_HELD_OUT_STROKES,
  ASSAYA_SHOULDERS_STROKES,
  ASSAYA_SPIN_STROKES,
  ASSAYA_STROKE_MS,
  ASSAYA_UPRIGHT_STROKES,
  AYYALA,
  BARAA,
  BARAA_BOB_MS,
  BARAA_BOB_PCT,
  BARAA_HEAD_BOBS,
  BARAA_LOW_BOBS,
  BARAA_PULSE_MS,
  BARAA_STEP_MS,
  BARAA_WAIST_BOBS,
  AYYALA_ARM_OUT_STROKES,
  AYYALA_BOW_STROKES,
  AYYALA_CANE_UP_STROKES,
  AYYALA_FORWARD_STROKES,
  AYYALA_STROKE_MS,
  ARDAH_BEAT_MS,
  ARDAH_DRUM_MS,
  ARDAH_DRUM_STROKE_MS,
  ARDAH_SWAY_DEG,
  ARDAH_SWAY_PERIOD_MS,
  DANCES,
  danceById,
  dancesFor,
  jitter,
  poseAt,
} from "./dances";
import { TIER_DURATION_MS } from "./celebrations";

/**
 * The timing and catalogue behind the milestone dances. The scene draws
 * whatever `poseAt` says, so these are the rules a frame has to obey: the
 * first frame is clean, every later swap lands on a beat, and the same moment
 * always looks the same.
 */

describe("the catalogue", () => {
  it("files each dance under its dialect", () => {
    expect(dancesFor("Gulf")).toContain(ARDAH);
    for (const dialect of ["Gulf", "Egyptian", "Yemeni"] as const) {
      for (const dance of dancesFor(dialect)) expect(dance.dialect).toBe(dialect);
    }
  });

  it("uses each id once, and finds dances by it", () => {
    const ids = DANCES.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(danceById("ardah")).toBe(ARDAH);
    expect(danceById("nope")).toBeNull();
  });

  it("names every dance in Arabic and English and says where it is from", () => {
    for (const dance of DANCES) {
      expect(dance.title, dance.id).toMatch(/[\u0600-\u06FF]/);
      expect(dance.gloss, dance.id).not.toBe("");
      expect(dance.region, dance.id).not.toBe("");
    }
  });
});

describe("poseAt", () => {
  it("opens on the sequence's first pose, untilted, so a still render is clean", () => {
    expect(poseAt(ARDAH, 0)).toEqual({
      step: 0,
      swapStep: 0,
      pose: ARDAH.sequence[0],
      rotateDeg: 0,
      shiftPct: 0,
      musicianPose: 0,
    });
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
      expect(Math.abs(f.rotateDeg)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(f.shiftPct)).toBeLessThanOrEqual(2);
    }
  });

  it("changes the musician's still on its own stroke clock", () => {
    expect([0, 1, 2, 3].map((i) => poseAt(ARDAH, i * ARDAH.musicianMs).musicianPose)).toEqual([0, 1, 0, 1]);
  });

  it("holds a dance with no musician on a musician pose of 0", () => {
    const solo = { ...ARDAH, musicianSequence: [] };
    expect(poseAt(solo, 5 * ARDAH.beatMs).musicianPose).toBe(0);
  });

  it("lands a held pose's jolt on every beat when the dance pumps, and only on the change when it holds still", () => {
    const pumping = { ...ARDAH, sequence: [0, 1, 1, 1], pumpOnHold: true };
    const holding = { ...pumping, pumpOnHold: false };
    const at = (d: typeof pumping, step: number) => poseAt(d, step * d.beatMs);
    expect([0, 1, 2, 3].map((s) => at(pumping, s).swapStep)).toEqual([0, 1, 2, 3]);
    expect([0, 1, 2, 3].map((s) => at(holding, s).swapStep)).toEqual([0, 1, 1, 1]);
    // A held still keeps the wobble it was put down with.
    expect(at(holding, 3)).toMatchObject({ rotateDeg: at(holding, 1).rotateDeg, shiftPct: at(holding, 1).shiftPct });
    // The next lap puts the pose down afresh.
    expect(at(holding, 5).swapStep).toBe(5);
  });

  it("holds a one-pose dance still without looping forever", () => {
    const still = { ...ARDAH, sequence: [2], pumpOnHold: false };
    expect(poseAt(still, 7 * ARDAH.beatMs).swapStep).toBe(7);
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
  it("uses only the three poses the reference keyframes show", () => {
    // 0 rest (keyframes 5, 6) · 1 swords forward (7) · 2 swords overhead (8).
    // The first draft had a dip, a stamp and a leap, which no keyframe shows.
    expect(new Set(ARDAH.sequence)).toEqual(new Set([0, 1, 2]));
  });

  it("alternates rest and forward, then holds overhead as a section of its own", () => {
    // timing.md: rest and forward alternate one per drum cycle; overhead is
    // held for whole shots, never a single beat.
    expect(ARDAH.sequence.slice(0, 3)).toEqual([0, 1, 0]);
    const overhead = ARDAH.sequence.map((p, i) => (p === 2 ? i : -1)).filter((i) => i >= 0);
    expect(overhead.length).toBeGreaterThanOrEqual(3);
    expect(overhead).toEqual(overhead.map((_, k) => overhead[0] + k)); // one unbroken run
  });

  it("reaches overhead inside the six-second scene and shows the alternation in the three-second one", () => {
    const firstOverhead = ARDAH.sequence.indexOf(2) * ARDAH.beatMs;
    expect(firstOverhead).toBeLessThan(TIER_DURATION_MS.large);
    expect(new Set([0, 1, 2].map((s) => ARDAH.sequence[s])).size).toBeGreaterThan(1);
    expect(ARDAH.sequence.slice(0, Math.ceil(TIER_DURATION_MS.medium / ARDAH.beatMs))).not.toContain(2);
  });

  it("keeps the measured relationships: a pose per drum cycle, a sway every two", () => {
    expect(ARDAH_DRUM_STROKE_MS).toBe(1170);
    expect(ARDAH_BEAT_MS).toBe(ARDAH_DRUM_STROKE_MS);
    expect(ARDAH_DRUM_MS * 2).toBe(ARDAH_DRUM_STROKE_MS);
    expect(ARDAH_SWAY_PERIOD_MS).toBe(2 * ARDAH_DRUM_STROKE_MS);
  });

  it("takes its timing from the named constants, so they live in one place", () => {
    expect(ARDAH.beatMs).toBe(ARDAH_BEAT_MS);
    expect(ARDAH.musicianMs).toBe(ARDAH_DRUM_MS);
    expect(ARDAH.swayDeg).toBe(ARDAH_SWAY_DEG);
    expect(ARDAH.swayPeriodMs).toBe(ARDAH_SWAY_PERIOD_MS);
  });
});

/** A sequence as runs of [pose, strokes]. */
const runs = (sequence: readonly number[]) =>
  sequence.reduce<[number, number][]>((out, pose) => {
    const last = out[out.length - 1];
    if (last && last[0] === pose) last[1]++;
    else out.push([pose, 1]);
    return out;
  }, []);

describe("the Ayyala itself", () => {
  it("uses only the four poses the reference keyframes show", () => {
    // 0 cane up (keyframe 6) · 1 arm out (5) · 2 canes forward (4) · 3 bow (7)
    expect(new Set(AYYALA.sequence)).toEqual(new Set([0, 1, 2, 3]));
  });

  it("opens on the measured cane cycle: up for two strokes, out for four, about 2 s a cycle", () => {
    expect(runs(AYYALA.sequence).slice(0, 4)).toEqual([
      [0, AYYALA_CANE_UP_STROKES],
      [1, AYYALA_ARM_OUT_STROKES],
      [0, AYYALA_CANE_UP_STROKES],
      [1, AYYALA_ARM_OUT_STROKES],
    ]);
    // README Timing 4c: up about 0.5 s (0.3–0.7), out about 1.4 s (1.1–1.6),
    // a cycle every 2.0 s ±0.1, about six strokes.
    const up = AYYALA_CANE_UP_STROKES * AYYALA_STROKE_MS;
    const out = AYYALA_ARM_OUT_STROKES * AYYALA_STROKE_MS;
    expect(up).toBeGreaterThanOrEqual(300);
    expect(up).toBeLessThanOrEqual(700);
    expect(out).toBeGreaterThanOrEqual(1100);
    expect(out).toBeLessThanOrEqual(1600);
    expect(AYYALA_CANE_UP_STROKES + AYYALA_ARM_OUT_STROKES).toBe(6);
    expect(Math.abs(up + out - 2000)).toBeLessThanOrEqual(100);
  });

  it("then bends: forward and bow in halves of a six-stroke cycle", () => {
    expect(runs(AYYALA.sequence).slice(4)).toEqual([
      [2, AYYALA_FORWARD_STROKES],
      [3, AYYALA_BOW_STROKES],
      [2, AYYALA_FORWARD_STROKES],
      [3, AYYALA_BOW_STROKES],
    ]);
    expect(AYYALA_FORWARD_STROKES).toBe(AYYALA_BOW_STROKES);
    expect(AYYALA_FORWARD_STROKES + AYYALA_BOW_STROKES).toBe(6);
  });

  it("shows the cane cycle alone in the three-second scene and reaches the bow in the six", () => {
    const shown = (ms: number) => AYYALA.sequence.slice(0, Math.ceil(ms / AYYALA.beatMs));
    expect(new Set(shown(TIER_DURATION_MS.medium))).toEqual(new Set([0, 1]));
    expect(shown(TIER_DURATION_MS.large)).toContain(3);
  });

  it("holds a pose still between strokes, sways nothing, and keeps its one drummer still", () => {
    expect(AYYALA.pumpOnHold).toBe(false);
    expect(AYYALA.swayDeg).toBe(0);
    expect(AYYALA.musicianSequence).toEqual([0]);
    // The arm-out pose is put down once and held for its four strokes.
    const start = AYYALA_CANE_UP_STROKES;
    const frames = [0, 1, 2, 3].map((k) => poseAt(AYYALA, (start + k) * AYYALA.beatMs));
    expect(new Set(frames.map((f) => f.swapStep))).toEqual(new Set([start]));
  });

  it("is a Gulf dance, so Gulf learners rotate between it and the Ardah", () => {
    expect(dancesFor("Gulf")).toEqual([ARDAH, AYYALA]);
  });
});

describe("the Saidi cane dance itself", () => {
  it("uses only the four poses the reference keyframes show", () => {
    // 0 spin, cane across the chest (6) · 1 cane across the shoulders (9)
    // · 2 lunge, cane held out (8) · 3 cane upright over the hand (7)
    expect(new Set(ASSAYA.sequence)).toEqual(new Set([0, 1, 2, 3]));
  });

  it("steps on the music's main stroke, since the poses follow no beat", () => {
    // README Timing 4a: median 249.6 ms in three stretches of assaya3.
    expect(ASSAYA_STROKE_MS).toBe(250);
    expect(ASSAYA.beatMs).toBe(ASSAYA_STROKE_MS);
  });

  it("spins with the cane across the chest coming back about every 1.2 s", () => {
    expect(runs(ASSAYA.sequence).slice(0, 4)).toEqual([
      [0, ASSAYA_SPIN_STROKES],
      [1, ASSAYA_SHOULDERS_STROKES],
      [0, ASSAYA_SPIN_STROKES],
      [1, ASSAYA_SHOULDERS_STROKES],
    ]);
    // README 4b: the body turn, mean 1.17 s, SD 0.19.
    const turn = (ASSAYA_SPIN_STROKES + ASSAYA_SHOULDERS_STROKES) * ASSAYA_STROKE_MS;
    expect(Math.abs(turn - 1170)).toBeLessThanOrEqual(190);
  });

  it("then holds the cane upright about half a second at a time", () => {
    expect(runs(ASSAYA.sequence).slice(4)).toEqual([
      [3, ASSAYA_UPRIGHT_STROKES],
      [2, ASSAYA_HELD_OUT_STROKES],
      [3, ASSAYA_UPRIGHT_STROKES],
      [2, ASSAYA_HELD_OUT_STROKES],
    ]);
    // README 4d: upright holds 320–800 ms, mean 520.
    const hold = ASSAYA_UPRIGHT_STROKES * ASSAYA_STROKE_MS;
    expect(hold).toBeGreaterThanOrEqual(320);
    expect(hold).toBeLessThanOrEqual(800);
  });

  it("is a solo for Egyptian learners, with no musician and no sway", () => {
    expect(ASSAYA.dialect).toBe("Egyptian");
    expect(dancesFor("Egyptian")).toContain(ASSAYA);
    expect(ASSAYA.musicianSequence).toEqual([]);
    expect(ASSAYA.swayDeg).toBe(0);
  });

  it("reaches the upright holds inside the six-second scene", () => {
    const shown = ASSAYA.sequence.slice(0, Math.ceil(TIER_DURATION_MS.large / ASSAYA.beatMs));
    expect(shown).toContain(3);
  });
});

describe("Al-Bara' itself", () => {
  it("uses only the four poses the reference keyframes show", () => {
    // 0 dagger at the waist (3) · 1 blade by the head (4) · 2 folded, blade
    // at the brow (4) · 3 low, dagger at the side (5)
    expect(new Set(BARAA.sequence)).toEqual(new Set([0, 1, 2, 3]));
  });

  it("bobs once every 430 ms, three drum pulses to a bob", () => {
    // README 4b: 419–440 ms across methods, hand count 434.
    expect(BARAA_BOB_MS).toBeGreaterThanOrEqual(419);
    expect(BARAA_BOB_MS).toBeLessThanOrEqual(440);
    expect(BARAA.bobPeriodMs).toBe(BARAA_BOB_MS);
    expect(Math.abs(3 * BARAA_PULSE_MS - BARAA_BOB_MS) / BARAA_BOB_MS).toBeLessThan(0.03);
    // The head moves about 5% of body height (2–7%).
    expect(BARAA_BOB_PCT).toBeGreaterThanOrEqual(2);
    expect(BARAA_BOB_PCT).toBeLessThanOrEqual(7);
  });

  it("changes still on the half bob, so the folded still lands at the bottom", () => {
    expect(BARAA.beatMs).toBe(BARAA_STEP_MS);
    expect(BARAA_STEP_MS * 2).toBe(BARAA_BOB_MS);
    // Odd steps are the bottom of a bob; in the head section that is the fold.
    const head = BARAA.sequence.slice(0, 2 * BARAA_HEAD_BOBS);
    expect(head.filter((_, i) => i % 2 === 1)).toEqual(Array(BARAA_HEAD_BOBS).fill(2));
    expect(head.filter((_, i) => i % 2 === 0)).toEqual(Array(BARAA_HEAD_BOBS).fill(1));
  });

  it("keeps the footage's order and proportions: head, then low, then the waist", () => {
    expect(runs(BARAA.sequence).map(([pose]) => pose).slice(-2)).toEqual([3, 0]);
    expect(runs(BARAA.sequence).slice(-2)).toEqual([
      [3, 2 * BARAA_LOW_BOBS],
      [0, 2 * BARAA_WAIST_BOBS],
    ]);
    // 6.4 s : 1.2 s : 12.4 s in baraa2 0:26–0:46.
    const total = BARAA_HEAD_BOBS + BARAA_LOW_BOBS + BARAA_WAIST_BOBS;
    expect(Math.abs(BARAA_HEAD_BOBS / total - 6.4 / 20)).toBeLessThan(0.05);
    expect(Math.abs(BARAA_WAIST_BOBS / total - 12.4 / 20)).toBeLessThan(0.05);
  });

  it("is the Yemeni learners' dance, with one drummer who doesn't strike", () => {
    expect(dancesFor("Yemeni")).toContain(BARAA);
    expect(BARAA.musicianSequence).toEqual([0]);
    expect(BARAA.swayDeg).toBe(0);
  });

  it("shows all three sections inside the six-second scene", () => {
    const shown = BARAA.sequence.slice(0, Math.ceil(TIER_DURATION_MS.large / BARAA.beatMs));
    expect(new Set(shown)).toEqual(new Set([0, 1, 2, 3]));
  });
});

