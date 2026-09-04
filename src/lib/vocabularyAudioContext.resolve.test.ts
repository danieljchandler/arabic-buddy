import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * How the Discover player gets a video's own audio copy.
 *
 * The private `video-audio` bucket admits reviewers and admins only, so the
 * old client-side signing loop (six extensions × two keys, twelve storage
 * calls) could never work for a learner. The resolver now asks
 * `discover-video-audio` once when there is a session, makes no request at
 * all without one, and keeps the legacy `audio_files` lookup as the last
 * resort for YouTube-keyed clips.
 */

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  invoke: vi.fn(),
  maybeSingle: vi.fn(),
  createSignedUrl: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: mocks.getSession },
    functions: { invoke: mocks.invoke },
    from: () => ({
      select: () => ({ eq: () => ({ limit: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
    }),
    storage: {
      from: () => ({
        createSignedUrl: mocks.createSignedUrl,
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/audio/${path}` } }),
      }),
    },
  },
}));

import { resolveDiscoverVideoAudioUrl } from "./vocabularyAudioContext";

const VIDEO = { id: "aaaaaaaa-0000-4000-8000-000000000000", source_url: "https://www.tiktok.com/@x/video/1" };

describe("resolveDiscoverVideoAudioUrl", () => {
  beforeEach(() => {
    mocks.getSession.mockReset();
    mocks.invoke.mockReset();
    mocks.maybeSingle.mockReset().mockResolvedValue({ data: null, error: null });
    mocks.createSignedUrl.mockReset();
  });

  it("asks the function once and returns its signed URL for a signed-in learner", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    mocks.invoke.mockResolvedValue({ data: { url: "https://x.supabase.co/storage/v1/object/sign/video-audio/a.wav?token=1" }, error: null });

    const url = await resolveDiscoverVideoAudioUrl(VIDEO);

    expect(url).toContain("/object/sign/video-audio/a.wav");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("discover-video-audio", { body: { videoId: VIDEO.id } });
    // No client-side signing attempts: the learner cannot, and it was the noise.
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
  });

  it("makes no request at all for a signed-out visitor", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });

    const url = await resolveDiscoverVideoAudioUrl(VIDEO);

    expect(url).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
  });

  it("drops into timer mode when nothing is staged", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    mocks.invoke.mockResolvedValue({ data: { url: null, reason: "no_audio" }, error: null });

    expect(await resolveDiscoverVideoAudioUrl(VIDEO)).toBeNull();
  });

  it("still finds a legacy YouTube clip in the public audio bucket", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    mocks.invoke.mockResolvedValue({ data: { url: null, reason: "no_audio" }, error: null });
    mocks.maybeSingle.mockResolvedValue({ data: { storage_path: "kTKcSSW6NZw.opus" }, error: null });

    const url = await resolveDiscoverVideoAudioUrl({ id: VIDEO.id, source_url: "https://youtube.com/shorts/kTKcSSW6NZw" });

    expect(url).toBe("https://cdn.test/audio/kTKcSSW6NZw.opus");
  });

  it("treats a failed function call as no audio rather than an error", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    mocks.invoke.mockResolvedValue({ data: null, error: new Error("Edge Function returned a non-2xx status code") });

    expect(await resolveDiscoverVideoAudioUrl(VIDEO)).toBeNull();
  });
});
