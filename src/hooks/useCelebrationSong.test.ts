import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { setSoundEnabled } from "@/lib/uiPrefs";
import { useCelebrationSong } from "./useCelebrationSong";
import { useProfileAvatar } from "./useProfileAvatar";
import type { Persona } from "@/test/support/personas";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(() => "toast-id"), { dismiss: vi.fn() }),
}));

/**
 * The celebration song hook.
 *
 * The song is a bonus that costs a generation, so most of what matters is when
 * it does *not* happen: no name, switched off, already sung, anonymous, a spent
 * allowance. Each of those has to end quietly, with the lesson or video the
 * learner just finished left as the main event.
 */

class FakeAudio {
  static instances: FakeAudio[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
  constructor(public src: string) {
    FakeAudio.instances.push(this);
  }
}

let cleanup: (() => void) | undefined;
let ids = 0;
/** A fresh thing-finished each time: the guard's memory outlives a single test. */
const lesson = () => ({ kind: "lesson_complete" as const, entityId: `lesson-hook-${++ids}` });

beforeEach(() => {
  FakeAudio.instances = [];
  vi.stubGlobal("Audio", FakeAudio);
  URL.revokeObjectURL = vi.fn();
  vi.mocked(toast).mockClear();
  vi.mocked(toast.dismiss).mockClear();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  setSoundEnabled(true);
  vi.unstubAllGlobals();
});

async function render(options: { persona?: Persona; displayName?: string | null } = {}) {
  const harness = renderHookWithProviders(
    () => ({ celebrate: useCelebrationSong(), profile: useProfileAvatar().data }),
    {
      persona: options.persona ?? "free",
      personaOptions: { profile: { display_name: options.displayName ?? null } },
    },
  );
  cleanup = harness.cleanup;
  // The name arrives with the profile; wait for it so the call is not a no-name no-op.
  if ((options.persona ?? "free") !== "anonymous") {
    await waitFor(() => expect(harness.result.current.profile).toBeDefined());
  }
  return harness;
}

const sang = (harness: Awaited<ReturnType<typeof render>>) =>
  harness.backend.callsTo("generate-celebration-song");

describe("singing", () => {
  it("asks for a song with the learner's name, their dialect and what they finished", async () => {
    const harness = await render({ displayName: "Layla" });
    const event = lesson();

    let started = false;
    await act(async () => {
      started = await harness.result.current.celebrate(event);
    });

    expect(started).toBe(true);
    expect(sang(harness)).toHaveLength(1);
    expect(sang(harness)[0].body).toEqual({
      name: "Layla",
      dialect: "Gulf",
      achievement: { kind: "lesson_complete" },
    });
  });

  it("plays it and shows the lyrics with a way to stop", async () => {
    const harness = await render({ displayName: "Layla" });

    await act(async () => {
      await harness.result.current.celebrate(lesson());
    });

    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].play).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      "A song for Layla!",
      expect.objectContaining({
        description: "يا بطل!",
        action: expect.objectContaining({ label: "Stop" }),
      }),
    );
  });

  it("stops the previous song when another starts", async () => {
    const harness = await render({ displayName: "Layla" });

    await act(async () => {
      await harness.result.current.celebrate(lesson());
      await harness.result.current.celebrate(lesson());
    });

    expect(FakeAudio.instances).toHaveLength(2);
    expect(FakeAudio.instances[0].pause).toHaveBeenCalled();
    expect(FakeAudio.instances[1].pause).not.toHaveBeenCalled();
  });

  it("clears the toast when the song ends", async () => {
    const harness = await render({ displayName: "Layla" });

    await act(async () => {
      await harness.result.current.celebrate(lesson());
    });
    act(() => FakeAudio.instances[0].onended?.());

    expect(toast.dismiss).toHaveBeenCalledWith("toast-id");
  });

  it("offers a Play button when the browser refuses sound that did not start from a tap", async () => {
    vi.stubGlobal(
      "Audio",
      class extends FakeAudio {
        play = vi.fn().mockRejectedValue(new DOMException("blocked", "NotAllowedError"));
      },
    );
    const harness = await render({ displayName: "Layla" });

    let started = false;
    await act(async () => {
      started = await harness.result.current.celebrate(lesson());
    });

    // Safari and some phones do this. Losing the song silently would make it
    // look as if the feature did not work.
    expect(started).toBe(true);
    expect(toast).toHaveBeenLastCalledWith(
      "A song for Layla!",
      expect.objectContaining({ id: "toast-id", action: expect.objectContaining({ label: "Play" }) }),
    );
  });
});

describe("when it stays quiet", () => {
  it("sings a given lesson once, however often it is finished", async () => {
    const harness = await render({ displayName: "Layla" });
    const event = lesson();

    await act(async () => {
      expect(await harness.result.current.celebrate(event)).toBe(true);
      expect(await harness.result.current.celebrate(event)).toBe(false);
    });

    expect(sang(harness)).toHaveLength(1);
  });

  it("does nothing without a name", async () => {
    const harness = await render({ displayName: null });

    await act(async () => {
      expect(await harness.result.current.celebrate(lesson())).toBe(false);
    });

    expect(sang(harness)).toHaveLength(0);
  });

  it("does not use up the event when there is no name yet, so the next render can sing it", async () => {
    const noName = await render({ displayName: null });
    const event = lesson();
    await act(async () => {
      await noName.result.current.celebrate(event);
    });
    noName.cleanup();
    cleanup = undefined;

    const withName = await render({ displayName: "Layla" });
    await act(async () => {
      expect(await withName.result.current.celebrate(event)).toBe(true);
    });
  });

  it("does nothing when the learner has switched songs off", async () => {
    localStorage.setItem("hakiya:celebration-songs-enabled", "false");
    const harness = await render({ displayName: "Layla" });

    await act(async () => {
      expect(await harness.result.current.celebrate(lesson())).toBe(false);
    });

    expect(sang(harness)).toHaveLength(0);
  });

  it("does nothing when the app's sound is off", async () => {
    setSoundEnabled(false);
    const harness = await render({ displayName: "Layla" });

    await act(async () => {
      expect(await harness.result.current.celebrate(lesson())).toBe(false);
    });

    expect(sang(harness)).toHaveLength(0);
  });

  it("does nothing for a signed-out visitor", async () => {
    const harness = await render({ persona: "anonymous", displayName: "Layla" });

    await act(async () => {
      expect(await harness.result.current.celebrate(lesson())).toBe(false);
    });

    expect(sang(harness)).toHaveLength(0);
  });
});

describe("when the song cannot be made", () => {
  it("ends quietly when the daily allowance is spent, and does not retry", async () => {
    const harness = await render({ displayName: "Layla" });
    harness.backend.stubFunctionCapped("generate-celebration-song");
    const event = lesson();

    await act(async () => {
      expect(await harness.result.current.celebrate(event)).toBe(false);
      expect(await harness.result.current.celebrate(event)).toBe(false);
    });

    // No "limit reached" nag over a bonus feature, and no second paid attempt.
    expect(sang(harness)).toHaveLength(1);
    expect(toast).not.toHaveBeenCalled();
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it("ends quietly when the function fails", async () => {
    const harness = await render({ displayName: "Layla" });
    harness.backend.stubFunctionFailure("generate-celebration-song", 500);

    await act(async () => {
      expect(await harness.result.current.celebrate(lesson())).toBe(false);
    });

    expect(toast).not.toHaveBeenCalled();
  });

  it("ends quietly when the audio is unreadable", async () => {
    const harness = await render({ displayName: "Layla" });
    harness.backend.stubFunction("generate-celebration-song", { audioBase64: "!!!not base64!!!" });

    await act(async () => {
      expect(await harness.result.current.celebrate(lesson())).toBe(false);
    });

    expect(FakeAudio.instances).toHaveLength(0);
  });
});
