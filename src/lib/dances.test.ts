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
  TAHTIB,
  TAHTIB_CROSSED_STEPS,
  TAHTIB_FIGURE_STEPS,
  TAHTIB_GRID_MS,
  TAHTIB_STEP_MS,
  TANOURA,
  TANOURA_HIP_TURNS,
  TANOURA_OVERHEAD_TURNS,
  TANOURA_QUARTER_MS,
  TANOURA_TURN_MS,
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
  KHAMMARI,
  KHAMMARI_GRID_MS,
  KHAMMARI_STEPS,
  MIZMAR,
  MIZMAR_CLAP_CONTACT_PULSES,
  MIZMAR_CLAP_MS,
  MIZMAR_OVERHEAD_PULSES,
  MIZMAR_PULSE_MS,
  MIZMAR_STRIDE_PULSES,
  MIZMAR_TWIRL_PULSES,
  RAZHA,
  RAZHA_ACCENT_MS,
  RAZHA_CROSSING_ACCENTS,
  RAZHA_LONG_UPRIGHT_ACCENTS,
  RAZHA_LOW_ACCENTS,
  RAZHA_UPRIGHT_ACCENTS,
  SANAANI,
  SANAANI_BOB_MS,
  SANAANI_BOB_PCT,
  SANAANI_CHAIN_BOBS,
  SANAANI_OPENING_BOBS,
  SANAANI_RELEASE_BOBS,
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

  it("is a Gulf dance, second in the Gulf rotation", () => {
    expect(dancesFor("Gulf")[1]).toBe(AYYALA);
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

describe("the Tanoura itself", () => {
  it("draws the turn a quarter at a time, in the counter-clockwise order the footage shows", () => {
    // README 4b: front, profile (face to frame-right), back, profile, front.
    const turn = TANOURA.sequence.slice(0, 4);
    expect(turn).toEqual([0, 1, 2, 3]);
    expect(TANOURA.beatMs).toBe(TANOURA_QUARTER_MS);
    expect(TANOURA_QUARTER_MS * 4).toBe(TANOURA_TURN_MS);
  });

  it("turns at the measured rate: about one turn a second", () => {
    // 0.994 s for the yellow-top dancer over 19 turns; 0.81–1.46 s across dancers.
    expect(Math.abs(TANOURA_TURN_MS - 994)).toBeLessThanOrEqual(72);
    expect(TANOURA_TURN_MS).toBeGreaterThanOrEqual(810);
    expect(TANOURA_TURN_MS).toBeLessThanOrEqual(1460);
  });

  it("spins with the skirt at the hips, then holds the upper layer overhead, front and back", () => {
    expect(runs(TANOURA.sequence.slice(4 * TANOURA_HIP_TURNS))).toEqual(
      Array.from({ length: TANOURA_OVERHEAD_TURNS }, () => [
        [4, 2],
        [5, 2],
      ]).flat(),
    );
    expect(new Set(TANOURA.sequence)).toEqual(new Set([0, 1, 2, 3, 4, 5]));
  });

  it("lifts the skirt after two full turns, inside even the three-second scene", () => {
    const liftAt = TANOURA.sequence.indexOf(4) * TANOURA.beatMs;
    expect(liftAt).toBe(TANOURA_HIP_TURNS * TANOURA_TURN_MS);
    expect(liftAt).toBeLessThan(TIER_DURATION_MS.medium);
  });

  it("is an Egyptian dance, rotating with the other Egyptian dances", () => {
    expect(dancesFor("Egyptian")).toContain(TANOURA);
    expect(TANOURA.musicianSequence).toEqual([0]);
  });
});

describe("the Tahtib itself", () => {
  it("uses only the three poses the reference keyframes show", () => {
    // 0 apart (3) · 1 crossed overhead (4) · 2 one level, one raised (6)
    expect(new Set(TAHTIB.sequence)).toEqual(new Set([0, 1, 2]));
  });

  it("runs the footage's commonest round: apart, crossed, the swing, apart", () => {
    expect(runs(TAHTIB.sequence).slice(0, 3)).toEqual([
      [0, 1],
      [1, TAHTIB_CROSSED_STEPS],
      [2, 1],
    ]);
  });

  it("changes pose about every 0.3 s and exchanges about every second", () => {
    // README 4c: poses change every 303–484 ms on average; 4b: an exchange
    // every 0.8–1.2 s (median); crossed segments 545 ms on average.
    expect(TAHTIB_STEP_MS).toBe(2 * TAHTIB_GRID_MS);
    expect(TAHTIB_STEP_MS).toBeGreaterThanOrEqual(250);
    expect(TAHTIB_STEP_MS).toBeLessThanOrEqual(484);
    const exchange = (2 + TAHTIB_CROSSED_STEPS) * TAHTIB_STEP_MS;
    expect(exchange).toBeGreaterThanOrEqual(800);
    expect(exchange).toBeLessThanOrEqual(1200);
    expect(Math.abs(TAHTIB_CROSSED_STEPS * TAHTIB_STEP_MS - 545)).toBeLessThan(60);
  });

  it("plays the drum's short-short-long figure on the 134 ms grid", () => {
    expect(TAHTIB_FIGURE_STEPS).toEqual([1, 1, 2]);
    expect(TAHTIB.musicianMs * 2).toBe(TAHTIB_GRID_MS);
    // Strikes (still 0) on half-steps 0, 2 and 4 of an 8-half-step (536 ms) figure.
    expect(TAHTIB.musicianSequence).toEqual([0, 1, 0, 1, 0, 1, 1, 1]);
    const strikes = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => poseAt(TAHTIB, k * TAHTIB.musicianMs).musicianPose);
    expect(strikes).toEqual([0, 1, 0, 1, 0, 1, 1, 1]);
  });

  it("is the third Egyptian dance in the rotation", () => {
    expect(dancesFor("Egyptian")).toEqual([ASSAYA, TANOURA, TAHTIB]);
  });
});


/** How far into the sequence a scene of this many milliseconds gets. */
const shownIn = (dance: typeof ARDAH, ms: number) => dance.sequence.slice(0, Math.ceil(ms / dance.beatMs));

describe("Al-Mizmar itself", () => {
  it("uses only the three poses the reference keyframes show", () => {
    // 0 stride, cane to the floor (10) · 1 cane vertical overhead (7) · 2 cane
    // level overhead, mid-twirl (4)
    expect(new Set(MIZMAR.sequence)).toEqual(new Set([0, 1, 2]));
  });

  it("claps every 1317 ms, the palms meeting for one pulse of eight", () => {
    // README 4b: 1317 ms over 22 intervals (SD 18.5); contact about 3 frames.
    expect(MIZMAR_CLAP_MS).toBe(1317);
    expect(MIZMAR.musicianMs).toBe(MIZMAR_PULSE_MS);
    expect(MIZMAR.musicianSequence).toHaveLength(8);
    expect(MIZMAR.musicianSequence.filter((p) => p === 1)).toHaveLength(MIZMAR_CLAP_CONTACT_PULSES);
    expect(MIZMAR.musicianSequence[0]).toBe(1);
    // The next clap lands one clap cycle later.
    expect(poseAt(MIZMAR, MIZMAR_CLAP_MS).musicianPose).toBe(1);
    expect(poseAt(MIZMAR, MIZMAR_CLAP_MS / 2).musicianPose).toBe(0);
  });

  it("steps on an eighth of the clap, within 2% of the take's own 166–168 ms pulse", () => {
    expect(MIZMAR.beatMs).toBe(MIZMAR_PULSE_MS);
    expect(Math.abs(MIZMAR_PULSE_MS - 167) / 167).toBeLessThan(0.02);
  });

  it("holds each pose about as long as its labelled mean, with strides between the others", () => {
    // README 4c: stride 693 ms, overhead 433 ms; one twirl revolution 630 ms (4d).
    expect(Math.abs(MIZMAR_STRIDE_PULSES * MIZMAR_PULSE_MS - 693)).toBeLessThan(MIZMAR_PULSE_MS / 2);
    expect(Math.abs(MIZMAR_OVERHEAD_PULSES * MIZMAR_PULSE_MS - 433)).toBeLessThan(MIZMAR_PULSE_MS / 2);
    expect(Math.abs(MIZMAR_TWIRL_PULSES * MIZMAR_PULSE_MS - 630)).toBeLessThan(MIZMAR_PULSE_MS / 2);
    const r = runs(MIZMAR.sequence);
    // Stride is the commonest pose, and every other pose comes between strides.
    r.forEach(([pose], i) => {
      if (pose !== 0) {
        expect(r[i - 1]?.[0]).toBe(0);
        if (i + 1 < r.length) expect(r[i + 1][0]).toBe(0);
      }
    });
    const stride = MIZMAR.sequence.filter((p) => p === 0).length;
    expect(stride).toBeGreaterThan(MIZMAR.sequence.length / 2);
  });

  it("shows all three poses inside the three-second scene", () => {
    expect(new Set(shownIn(MIZMAR, TIER_DURATION_MS.medium))).toEqual(new Set([0, 1, 2]));
  });

  it("holds a pose still between pulses, with no sway or bob", () => {
    expect(MIZMAR.pumpOnHold).toBe(false);
    expect(MIZMAR.swayDeg).toBe(0);
    expect(MIZMAR.bobPct).toBe(0);
  });
});

describe("Al-Razha itself", () => {
  it("uses only the three cane states drawn from the footage", () => {
    // 0 upright (2) · 1 raised and crossing (3) · 2 held low (Timing 4c)
    expect(new Set(RAZHA.sequence)).toEqual(new Set([0, 1, 2]));
  });

  it("steps on the drums' 775 ms accent, four strokes of about 197 ms", () => {
    expect(RAZHA.beatMs).toBe(RAZHA_ACCENT_MS);
    expect(Math.abs(RAZHA_ACCENT_MS / 4 - 195)).toBeLessThan(5);
  });

  it("holds each state for its measured length, in the footage's order", () => {
    // razha12 6:20–6:45: upright 3.1 s, crossing 3.9 s, low 4.0 s, upright 12.4 s.
    expect(Math.abs(RAZHA_UPRIGHT_ACCENTS * RAZHA_ACCENT_MS - 3100)).toBeLessThan(RAZHA_ACCENT_MS / 2);
    expect(Math.abs(RAZHA_CROSSING_ACCENTS * RAZHA_ACCENT_MS - 3900)).toBeLessThan(RAZHA_ACCENT_MS / 2);
    expect(Math.abs(RAZHA_LOW_ACCENTS * RAZHA_ACCENT_MS - 4000)).toBeLessThan(RAZHA_ACCENT_MS / 2);
    expect(Math.abs(RAZHA_LONG_UPRIGHT_ACCENTS * RAZHA_ACCENT_MS - 12400)).toBeLessThan(RAZHA_ACCENT_MS / 2);
    expect(runs(RAZHA.sequence)).toEqual([
      [0, RAZHA_UPRIGHT_ACCENTS / 2],
      [1, RAZHA_CROSSING_ACCENTS],
      [2, RAZHA_LOW_ACCENTS],
      [0, RAZHA_LONG_UPRIGHT_ACCENTS],
    ]);
  });

  it("reaches the crossing in the three-second scene and the low hold in the six", () => {
    expect(shownIn(RAZHA, TIER_DURATION_MS.medium)).toContain(1);
    expect(shownIn(RAZHA, TIER_DURATION_MS.large)).toContain(2);
  });

  it("keeps its one drummer still, and the row neither sways nor bobs", () => {
    expect(RAZHA.musicianSequence).toEqual([0]);
    expect(RAZHA.swayDeg).toBe(0);
    expect(RAZHA.bobPct).toBe(0);
  });
});

describe("the Khammari itself", () => {
  it("uses only the three poses of the footage: upright, lean and bow", () => {
    // 0 upright (1) · 1 lean (Timing 4c) · 2 bow (3)
    expect(new Set(KHAMMARI.sequence)).toEqual(new Set([0, 1, 2]));
  });

  it("steps on the music's 234 ms grid, two steps to its 464 ms beat", () => {
    expect(KHAMMARI.beatMs).toBe(KHAMMARI_GRID_MS);
    expect(Math.abs(2 * KHAMMARI_GRID_MS - 464) / 464).toBeLessThan(0.02);
  });

  it("holds each pose for the right-end woman's measured spell, in her order", () => {
    // Video 1 7:55.9–8:03.8: lean 0.3, bow 1.6, lean 0.5, upright 1.7,
    // lean 1.0, upright 2.8 s (the last split across the loop).
    const near = (steps: number, seconds: number) =>
      expect(Math.abs(steps * KHAMMARI_GRID_MS - seconds * 1000)).toBeLessThan(KHAMMARI_GRID_MS);
    near(KHAMMARI_STEPS.firstLean, 0.3);
    near(KHAMMARI_STEPS.bow, 1.6);
    near(KHAMMARI_STEPS.secondLean, 0.5);
    near(KHAMMARI_STEPS.upright, 1.7);
    near(KHAMMARI_STEPS.thirdLean, 1.0);
    near(KHAMMARI_STEPS.openingUpright + KHAMMARI_STEPS.longUpright, 2.8);
    expect(runs(KHAMMARI.sequence).map(([pose]) => pose)).toEqual([0, 1, 2, 1, 0, 1, 0]);
  });

  it("bows about every 7.9 s, as video 1 does", () => {
    // Bows at 7:56.2, 8:04.1 and 8:11.6: 7.9 and 7.6 s apart.
    const loop = KHAMMARI.sequence.length * KHAMMARI_GRID_MS;
    expect(loop).toBeGreaterThanOrEqual(7400);
    expect(loop).toBeLessThanOrEqual(8100);
  });

  it("reaches the bow inside the three-second scene", () => {
    expect(shownIn(KHAMMARI, TIER_DURATION_MS.medium)).toContain(2);
  });

  it("keeps its one drummer still, and the women neither sway nor bob", () => {
    expect(KHAMMARI.musicianSequence).toEqual([0]);
    expect(KHAMMARI.swayDeg).toBe(0);
    expect(KHAMMARI.bobPct).toBe(0);
  });
});

describe("the Sana'ani dance itself", () => {
  it("uses only the two poses the reference keyframes show", () => {
    // 0 the chain, hands joined (1) · 1 the release walk (3)
    expect(new Set(SANAANI.sequence)).toEqual(new Set([0, 1]));
  });

  it("bobs once every 535 ms, a few percent of their height", () => {
    // README: 535 ms in sanaani17 (484–547 across shots); 2–6% peak to peak.
    expect(SANAANI_BOB_MS).toBeGreaterThanOrEqual(484);
    expect(SANAANI_BOB_MS).toBeLessThanOrEqual(547);
    expect(SANAANI.beatMs).toBe(SANAANI_BOB_MS);
    expect(SANAANI.bobPeriodMs).toBe(SANAANI_BOB_MS);
    expect(SANAANI_BOB_PCT).toBeGreaterThanOrEqual(2);
    expect(SANAANI_BOB_PCT).toBeLessThanOrEqual(6);
    expect(SANAANI.bobPct).toBe(SANAANI_BOB_PCT);
  });

  it("lets go for about 1.5 s in a cycle of about 13.2 s", () => {
    expect(Math.abs(SANAANI_RELEASE_BOBS * SANAANI_BOB_MS - 1500)).toBeLessThanOrEqual(150);
    const cycle = (SANAANI_CHAIN_BOBS + SANAANI_RELEASE_BOBS) * SANAANI_BOB_MS;
    expect(Math.abs(cycle - 13200)).toBeLessThan(SANAANI_BOB_MS);
    expect(runs(SANAANI.sequence)).toEqual([
      [0, SANAANI_OPENING_BOBS],
      [1, SANAANI_RELEASE_BOBS],
      [0, SANAANI_CHAIN_BOBS - SANAANI_OPENING_BOBS],
    ]);
  });

  it("shows the release inside the three-second scene", () => {
    expect(shownIn(SANAANI, TIER_DURATION_MS.medium)).toContain(1);
  });

  it("is the second Yemeni dance, with one musician who doesn't strike", () => {
    expect(dancesFor("Yemeni")).toEqual([BARAA, SANAANI]);
    expect(SANAANI.musicianSequence).toEqual([0]);
    expect(SANAANI.swayDeg).toBe(0);
  });
});

describe("the rotation", () => {
  it("alternates kinds of dance within the Gulf: no two cane rows back to back", () => {
    expect(dancesFor("Gulf")).toEqual([ARDAH, AYYALA, MIZMAR, KHAMMARI, RAZHA]);
  });
});
