import { describe, expect, it } from "vitest";
import {
  FRAME_DRIFT_STRIKES,
  FRAME_DRIFT_TOLERANCE_S,
  FRAME_REALIGN_COOLDOWN_MS,
  createDriftGuard,
  frameTimeSeconds,
} from "./tiktokFrameSync";

describe("frameTimeSeconds", () => {
  it("reads the documented { currentTime, duration } payload", () => {
    expect(frameTimeSeconds({ currentTime: 12.5, duration: 30 })).toBe(12.5);
  });

  it("keeps the bare-number shape older players sent", () => {
    expect(frameTimeSeconds(3.25)).toBe(3.25);
  });

  it("accepts a numeric string and rejects everything that is not a time", () => {
    expect(frameTimeSeconds({ currentTime: "4.5" })).toBe(4.5);
    expect(frameTimeSeconds(undefined)).toBeNull();
    expect(frameTimeSeconds(null)).toBeNull();
    expect(frameTimeSeconds({})).toBeNull();
    expect(frameTimeSeconds({ currentTime: Number.NaN })).toBeNull();
    expect(frameTimeSeconds(-1)).toBeNull();
    expect(frameTimeSeconds("later")).toBeNull();
  });
});

describe("createDriftGuard", () => {
  const T0 = 100_000;
  /** Well past any cooldown. */
  const settled = T0 + FRAME_REALIGN_COOLDOWN_MS + 1;

  it("lets ordinary jitter through without a seek", () => {
    const guard = createDriftGuard();
    guard.noteAligned(T0);
    expect(guard.shouldRealign(10.1, 10.0, settled)).toBe(false);
    expect(guard.shouldRealign(10.0, 10.3, settled + 250)).toBe(false);
    expect(guard.shouldRealign(10.0 + FRAME_DRIFT_TOLERANCE_S, 10.0, settled + 500)).toBe(false);
  });

  it("ignores a single over-tolerance reading (it can straddle a seek or a stall)", () => {
    const guard = createDriftGuard();
    guard.noteAligned(T0);
    expect(guard.shouldRealign(9.0, 10.0, settled)).toBe(false);
    // Back inside tolerance: the strike is forgotten.
    expect(guard.shouldRealign(10.0, 10.05, settled + 250)).toBe(false);
    expect(guard.shouldRealign(9.0, 10.0, settled + 500)).toBe(false);
  });

  it("seeks once the frame has been behind on consecutive reports — a stall, not a blip", () => {
    const guard = createDriftGuard();
    guard.noteAligned(T0);
    const reports = Array.from({ length: FRAME_DRIFT_STRIKES }, (_, i) =>
      guard.shouldRealign(9.0 + i * 0.25, 10.0 + i * 0.25, settled + i * 250),
    );
    expect(reports.slice(0, -1).every((r) => r === false)).toBe(true);
    expect(reports.at(-1)).toBe(true);
  });

  it("treats a frame that ran ahead the same way", () => {
    const guard = createDriftGuard();
    guard.noteAligned(T0);
    expect(guard.shouldRealign(11.0, 10.0, settled)).toBe(false);
    expect(guard.shouldRealign(11.25, 10.25, settled + 250)).toBe(true);
  });

  it("stays quiet inside the cooldown after a seek, where readings are transitional", () => {
    const guard = createDriftGuard();
    guard.noteAligned(T0);
    // Two readings a full second out, both within the cooldown: no seek, no strikes.
    expect(guard.shouldRealign(9.0, 10.0, T0 + 200)).toBe(false);
    expect(guard.shouldRealign(9.0, 10.0, T0 + 900)).toBe(false);
    // The first reading after the cooldown is a fresh first strike.
    expect(guard.shouldRealign(9.0, 10.0, T0 + FRAME_REALIGN_COOLDOWN_MS)).toBe(false);
    expect(guard.shouldRealign(9.0, 10.0, T0 + FRAME_REALIGN_COOLDOWN_MS + 250)).toBe(true);
  });

  it("does not fire on every report once it has fired", () => {
    const guard = createDriftGuard();
    guard.noteAligned(T0);
    expect(guard.shouldRealign(9.0, 10.0, settled)).toBe(false);
    expect(guard.shouldRealign(9.0, 10.0, settled + 250)).toBe(true);
    // The caller seeks and says so; a reading in the cooldown is ignored.
    guard.noteAligned(settled + 260);
    expect(guard.shouldRealign(9.6, 10.3, settled + 500)).toBe(false);
  });

  it("works before any alignment has been recorded, and forgets everything on reset", () => {
    const guard = createDriftGuard({ strikes: 1 });
    expect(guard.shouldRealign(9.0, 10.0, T0)).toBe(true);
    guard.noteAligned(T0);
    guard.reset();
    expect(guard.shouldRealign(9.0, 10.0, T0 + 10)).toBe(true);
  });

  it("takes its thresholds from options", () => {
    const guard = createDriftGuard({ toleranceSeconds: 1, strikes: 3, cooldownMs: 100 });
    guard.noteAligned(T0);
    expect(guard.shouldRealign(9.5, 10.0, T0 + 200)).toBe(false); // inside tolerance 1s
    expect(guard.shouldRealign(8.5, 10.0, T0 + 300)).toBe(false); // strike 1
    expect(guard.shouldRealign(8.5, 10.0, T0 + 400)).toBe(false); // strike 2
    expect(guard.shouldRealign(8.5, 10.0, T0 + 500)).toBe(true); // strike 3
  });
});
