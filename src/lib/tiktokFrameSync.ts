/**
 * Keeping the muted TikTok frame on the hidden audio's clock.
 *
 * The Discover player (src/pages/DiscoverVideo.tsx) treats TikTok's player/v1
 * iframe as a muted picture and plays our own audio copy as the master clock:
 * the transcript, phrase-end pauses and view tracking all hang off the audio,
 * and the frame is told where the audio is. How often to tell it has a history:
 *
 * - Re-seeking the frame on every tick to shave sub-second drift made the
 *   picture visibly choppy, and fed itself — a fresh seek briefly reports a
 *   transitional position that reads as more drift (#211).
 * - So the frame is aligned once when a play run starts, and not again on a
 *   buffering recovery (state 3 → 1) (#212).
 *
 * What that left open is the frame that *stalls*. When the player buffers, the
 * audio keeps going; when the picture resumes it resumes from where it stopped,
 * a second behind, and nothing re-aligns it for the rest of the clip. The
 * player does report its own clock (`onCurrentTime`), so this module decides
 * when that report is a reason to seek: only when it disagrees with the audio
 * by more than the tolerance on consecutive reports — one reading can straddle
 * a seek or a stall — and never inside the cooldown after a seek, where the
 * transitional readings live. Normal playback never trips it: both run at 1x,
 * and the tolerance is several times the report-to-report jitter.
 */

/** How far the frame may be from the audio before a seek is worth the hitch. */
export const FRAME_DRIFT_TOLERANCE_S = 0.4;

/** Consecutive over-tolerance reports before a seek: one can be transitional. */
export const FRAME_DRIFT_STRIKES = 2;

/** No correction this soon after a seek, which is when the readings lie. */
export const FRAME_REALIGN_COOLDOWN_MS = 1500;

/**
 * The seconds in an `onCurrentTime` payload.
 *
 * The documented shape is `{ currentTime, duration }`; a bare number is kept
 * for the player versions that sent one. Anything else is not a reading.
 */
export function frameTimeSeconds(value: unknown): number | null {
  const raw =
    typeof value === "number"
      ? value
      : value && typeof value === "object"
        ? (value as { currentTime?: unknown }).currentTime
        : undefined;
  const seconds = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export interface DriftGuardOptions {
  toleranceSeconds?: number;
  strikes?: number;
  cooldownMs?: number;
}

export interface DriftGuard {
  /** The frame was just seeked to the audio: start the cooldown, forget strikes. */
  noteAligned(nowMs: number): void;
  /** Whether this report of the frame's clock is a reason to seek it again. */
  shouldRealign(frameSeconds: number, audioSeconds: number, nowMs: number): boolean;
  /** A new video: nothing is known. */
  reset(): void;
}

export function createDriftGuard(options: DriftGuardOptions = {}): DriftGuard {
  const tolerance = options.toleranceSeconds ?? FRAME_DRIFT_TOLERANCE_S;
  const strikesNeeded = options.strikes ?? FRAME_DRIFT_STRIKES;
  const cooldown = options.cooldownMs ?? FRAME_REALIGN_COOLDOWN_MS;
  let lastAlignedAt = Number.NEGATIVE_INFINITY;
  let strikes = 0;

  return {
    noteAligned(nowMs) {
      lastAlignedAt = nowMs;
      strikes = 0;
    },
    shouldRealign(frameSeconds, audioSeconds, nowMs) {
      if (nowMs - lastAlignedAt < cooldown) return false;
      if (Math.abs(frameSeconds - audioSeconds) <= tolerance) {
        strikes = 0;
        return false;
      }
      strikes += 1;
      if (strikes < strikesNeeded) return false;
      // The caller seeks and calls noteAligned; clearing here too keeps a
      // caller that does not from firing on every report.
      strikes = 0;
      return true;
    },
    reset() {
      lastAlignedAt = Number.NEGATIVE_INFINITY;
      strikes = 0;
    },
  };
}
