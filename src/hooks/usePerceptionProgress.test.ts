import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aPerceptionProgress } from "@/test/support/factories";
import { MINUTES_PER_CONTRAST, RESURFACE_AFTER_DAYS } from "@/lib/perceptionPairs";
import { usePerceptionProgress } from "./usePerceptionProgress";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * Perception progress is merged, never reset: a round adds its attempts,
 * correct answers and seconds to the row, and the contrast completes on the
 * minutes threshold. The durability check keeps its own counters.
 */

let cleanup: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-02T12:00:00Z"));
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
});

function render(seed: (backend: SupabaseBackend) => void = () => {}) {
  const rendered = renderHookWithProviders(() => usePerceptionProgress(), { persona: "free", seed });
  cleanup = rendered.cleanup;
  return rendered;
}

describe("reading", () => {
  it("reports an untouched contrast as zero minutes with no accuracy", async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const status = result.current.statusFor("qaf-kaf");
    expect(status.minutes).toBe(0);
    expect(status.accuracy).toBeNull();
    expect(status.complete).toBe(false);
    expect(result.current.programme.contrastsComplete).toBe(0);
  });

  it("reads a seeded row into minutes and accuracy", async () => {
    const { result } = render((b) => b.db.seed("user_perception_progress", [aPerceptionProgress()]));
    await waitFor(() => expect(result.current.statusFor("sad-sin").minutes).toBe(10));
    expect(result.current.statusFor("sad-sin").accuracy).toBeCloseTo(0.75);
  });

  it("ignores another dialect's rows", async () => {
    const { result } = render((b) => b.db.seed("user_perception_progress", [aPerceptionProgress({ dialect: "Egyptian" })]));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.statusFor("sad-sin").minutes).toBe(0);
  });
});

describe("recording a round", () => {
  it("merges into the existing row rather than replacing it", async () => {
    let backend: SupabaseBackend | undefined;
    const { result } = render((b) => {
      backend = b;
      b.db.seed("user_perception_progress", [aPerceptionProgress()]);
    });
    await waitFor(() => expect(result.current.statusFor("sad-sin").minutes).toBe(10));

    await act(async () => {
      await result.current.recordRound({ contrastId: "sad-sin", attempts: 10, correct: 9, seconds: 120 });
    });

    await waitFor(() => expect(result.current.statusFor("sad-sin").minutes).toBe(12));
    const row = backend!.db.rows("user_perception_progress")[0] as Record<string, unknown>;
    expect(row.attempts).toBe(30);
    expect(row.correct).toBe(24);
    expect(row.completed_at).toBeNull();
  });

  it("creates the row on a first round", async () => {
    let backend: SupabaseBackend | undefined;
    const { result } = render((b) => { backend = b; });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.recordRound({ contrastId: "qaf-kaf", attempts: 10, correct: 6, seconds: 90 });
    });
    await waitFor(() => expect(result.current.statusFor("qaf-kaf").minutes).toBeCloseTo(1.5));
    const rows = backend!.db.rows("user_perception_progress") as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ contrast_id: "qaf-kaf", dialect: "Gulf", attempts: 10, correct: 6, seconds: 90 });
  });

  it("completes the contrast when its share of the programme is met", async () => {
    let backend: SupabaseBackend | undefined;
    const { result } = render((b) => {
      backend = b;
      b.db.seed("user_perception_progress", [aPerceptionProgress({ seconds: MINUTES_PER_CONTRAST * 60 - 30 })]);
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.recordRound({ contrastId: "sad-sin", attempts: 5, correct: 5, seconds: 60 });
    });
    await waitFor(() => expect(result.current.statusFor("sad-sin").complete).toBe(true));
    const row = backend!.db.rows("user_perception_progress")[0] as Record<string, unknown>;
    expect(row.completed_at).toMatch(/^2026-09-02T12:00:00/);
  });

  it("keeps the durability check apart from the contrast's own numbers", async () => {
    const completedAt = new Date(Date.now() - (RESURFACE_AFTER_DAYS + 2) * 86_400_000).toISOString();
    let backend: SupabaseBackend | undefined;
    const { result } = render((b) => {
      backend = b;
      b.db.seed("user_perception_progress", [aPerceptionProgress({ completed_at: completedAt, seconds: 3000 })]);
    });
    await waitFor(() => expect(result.current.statusFor("sad-sin").resurfaceDue).toBe(true));

    await act(async () => {
      await result.current.recordRound({ contrastId: "sad-sin", attempts: 10, correct: 7, seconds: 60, resurface: true });
    });

    await waitFor(() => expect(result.current.statusFor("sad-sin").resurfaceDue).toBe(false));
    const row = backend!.db.rows("user_perception_progress")[0] as Record<string, unknown>;
    expect(row.resurface_attempts).toBe(10);
    expect(row.resurface_correct).toBe(7);
    expect(row.attempts).toBe(20);
    expect(row.seconds).toBe(3000);
    expect(row.resurfaced_at).toMatch(/^2026-09-02T12:00:00/);
  });
});
