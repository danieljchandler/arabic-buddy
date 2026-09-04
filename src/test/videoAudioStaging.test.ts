import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  STAGED_AUDIO_EXTENSIONS,
  resolveStagedVideoAudioUrl,
} from "@/lib/videoAudioStaging";

/**
 * The one list two halves of the app have to agree on.
 *
 * `process-approved-video` reads a video's audio out of the `video-audio`
 * bucket; the Discover player streams the same file to drive TikTok's
 * hidden-audio playback (line sync, phrase pause, view tracking). They resolve
 * it independently, by trying extensions in order — so when the admin uploader
 * started staging WAV and only the edge function learned to read it, the
 * pipeline transcribed audio the player reported as missing, and every TikTok
 * uploaded from that point dropped to the legacy silent timer.
 *
 * Nothing typechecks across that boundary, so the drift check is a test.
 */

const signed = vi.hoisted(() => ({
  /** Paths that exist in the bucket. */
  present: new Set<string>(),
  /** Every path asked for, in order. */
  asked: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => {
          signed.asked.push(path);
          return signed.present.has(path)
            ? { data: { signedUrl: `https://cdn.test/${path}?token=x` }, error: null }
            : { data: null, error: { message: "Object not found" } };
        },
      }),
    },
  },
}));

beforeEach(() => {
  signed.present.clear();
  signed.asked.length = 0;
});

/** The edge function's own list, read out of its source. */
function pipelineExtensions(): string[] {
  const source = readFileSync(
    join(process.cwd(), "supabase", "functions", "process-approved-video", "index.ts"),
    "utf8",
  );
  const block = source.match(/const stagedAudioPaths = \(videoId: string\) => \[([\s\S]*?)\];/);
  if (!block) throw new Error("could not find stagedAudioPaths in process-approved-video");
  return [...block[1].matchAll(/\$\{videoId\}(\.[a-z0-9]+)/g)].map((m) => m[1]);
}

describe("staged video audio", () => {
  it("looks for the same extensions the pipeline stages, in the same order", () => {
    expect([...STAGED_AUDIO_EXTENSIONS]).toEqual(pipelineExtensions());
  });

  it("prefers the extracted WAV over a whole video file carrying the same audio", () => {
    expect(STAGED_AUDIO_EXTENSIONS[0]).toBe(".wav");
    expect(STAGED_AUDIO_EXTENSIONS).toContain(".mp4");
  });

  it("resolves audio staged as WAV by the admin uploader", async () => {
    signed.present.add("vid-1.wav");

    await expect(resolveStagedVideoAudioUrl("vid-1")).resolves.toContain("vid-1.wav");
  });

  it("stops at the first extension that resolves", async () => {
    signed.present.add("vid-1.wav");
    signed.present.add("vid-1.mp4");

    await resolveStagedVideoAudioUrl("vid-1");

    expect(signed.asked).toEqual(["vid-1.wav"]);
  });

  it("still finds the older containers uploads fall back to", async () => {
    signed.present.add("vid-1.m4a");

    await expect(resolveStagedVideoAudioUrl("vid-1")).resolves.toContain("vid-1.m4a");
  });

  it("returns null when nothing is staged, rather than a broken URL", async () => {
    await expect(resolveStagedVideoAudioUrl("vid-1")).resolves.toBeNull();
    expect(signed.asked.length).toBe(STAGED_AUDIO_EXTENSIONS.length);
  });
});
