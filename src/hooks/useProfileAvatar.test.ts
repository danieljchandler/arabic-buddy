import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { useProfileAvatar, profileAvatarQueryKey } from "./useProfileAvatar";

/**
 * The picture the shell puts in the corner of nearly every screen.
 *
 * This exists because choosing an avatar used to change nothing a learner
 * could see: the write landed in `profiles.avatar_url`, and the emblem — the
 * one place the picture would have been seen daily — was a hard-coded logo.
 * So what is worth pinning is narrow: that the hook reads the column the
 * picker writes, and that it answers `null` rather than throwing in the two
 * states the corner still has to render — signed out, and signed in with no
 * picture chosen yet.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render(options: Parameters<typeof renderHookWithProviders>[1] = {}) {
  const harness = renderHookWithProviders(() => useProfileAvatar(), options);
  cleanup = harness.cleanup;
  return harness;
}

describe("reading the avatar", () => {
  it("returns the picture the picker stored", async () => {
    const { result } = render({
      persona: "free",
      personaOptions: {
        profile: { avatar_url: "/avatars/sadu-rose.png", display_name: "Layla" },
      },
    });

    await waitFor(() => expect(result.current.data?.avatarUrl).toBe("/avatars/sadu-rose.png"));
    expect(result.current.data?.displayName).toBe("Layla");
  });

  it("returns null when no picture has been chosen", async () => {
    const { result } = render({
      persona: "free",
      personaOptions: { profile: { avatar_url: null } },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.avatarUrl).toBeNull();
  });

  it("does not query for a signed-out visitor", async () => {
    const { result } = render({ persona: "anonymous" });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(result.current.data).toBeUndefined();
  });
});

describe("the cache key", () => {
  /**
   * Settings invalidates by this key after writing, so the emblem repaints
   * without a reload. A key that stopped varying by user would also hand one
   * account's picture to the next one signed in on the same device.
   */
  it("is per user", () => {
    expect(profileAvatarQueryKey("user-a")).not.toEqual(profileAvatarQueryKey("user-b"));
    expect(profileAvatarQueryKey(undefined)).toEqual(profileAvatarQueryKey(null));
  });
});
