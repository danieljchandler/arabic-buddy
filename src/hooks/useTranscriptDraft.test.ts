import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptLine } from "@/types/transcript";
import { draftKey, readDraft, writeDraft } from "@/lib/transcriptDraft";
import { useTranscriptDraft } from "./useTranscriptDraft";

/**
 * Keeping an unpublished transcript alive without ever implying it is live.
 *
 * The failure this exists to prevent is losing an hour of correction work to a
 * closed tab. The failure it must not cause is worse: a reviewer reading
 * "saved" and believing learners are seeing their corrections, when publishing
 * is still a button nobody has pressed. So most of what is pinned here is about
 * a draft never being written over, never being deleted behind the reviewer's
 * back, and never being confused with what is stored.
 */

const aLine = (over: Partial<TranscriptLine> = {}): TranscriptLine => ({
  id: "line-1",
  arabic: "شلونك اليوم",
  translation: "how are you today",
  tokens: [{ id: "t1", surface: "شلونك" }],
  ...over,
});

const PUBLISHED = [aLine()];
const EDITED = [aLine({ arabic: "شخبارك اليوم" })];

const settle = (ms = 1000) => act(() => void vi.advanceTimersByTime(ms));

interface Options {
  videoId?: string | undefined;
  lines?: TranscriptLine[];
  publishedLines?: TranscriptLine[];
  enabled?: boolean;
}

function setup({
  videoId = "vid-1",
  lines = PUBLISHED,
  publishedLines = PUBLISHED,
  enabled = true,
}: Options = {}) {
  const onRestore = vi.fn();
  const view = renderHook(
    (props: Options) =>
      useTranscriptDraft({
        videoId: props.videoId,
        lines: props.lines!,
        publishedLines: props.publishedLines!,
        enabled: props.enabled,
        onRestore,
      }),
    { initialProps: { videoId, lines, publishedLines, enabled } },
  );
  return { ...view, onRestore };
}

/**
 * The same hook wired the way the form wires it: restoring a draft puts the
 * lines into state the hook then sees. The props-driven `setup` above cannot
 * model that — its `onRestore` is a spy, so the editor never diverges and the
 * next pass reads the restore as "nothing changed".
 */
function setupLive(stored: TranscriptLine[]) {
  return renderHook(() => {
    const [lines, setLines] = useState<TranscriptLine[]>(stored);
    const draft = useTranscriptDraft({
      videoId: "vid-1",
      lines,
      publishedLines: stored,
      onRestore: setLines,
    });
    return { draft, lines };
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("knowing there is unpublished work", () => {
  it("is clean when the editor matches what is stored", () => {
    const { result } = setup();

    expect(result.current.dirty).toBe(false);
    expect(result.current.savedAt).toBeNull();
  });

  it("goes dirty the moment the editor diverges", () => {
    const { result, rerender } = setup();

    rerender({ videoId: "vid-1", lines: EDITED, publishedLines: PUBLISHED, enabled: true });

    expect(result.current.dirty).toBe(true);
  });

  it("stays quiet until the stored transcript has arrived", () => {
    const { result } = setup({ lines: [], publishedLines: [], enabled: false });

    // Before the video row loads the form holds an empty list, which against a
    // published transcript reads as "every line was deleted".
    expect(result.current.dirty).toBe(false);
  });
});

describe("auto-saving", () => {
  it("waits for the reviewer to stop typing", () => {
    const { result, rerender } = setup();
    rerender({ videoId: "vid-1", lines: EDITED, publishedLines: PUBLISHED, enabled: true });

    expect(result.current.savedAt).toBeNull();
    settle();

    expect(result.current.savedAt).not.toBeNull();
    expect(readDraft("vid-1")!.lines).toEqual(EDITED);
  });

  it("writes nothing at all while the transcript matches what is stored", () => {
    setup();
    settle();

    // Otherwise every video merely opened would leave a draft behind, and the
    // recovery prompt would become noise the reviewer learns to dismiss.
    expect(localStorage.getItem(draftKey("vid-1"))).toBeNull();
  });

  it("keeps up with later edits", () => {
    const { result, rerender } = setup();
    rerender({ videoId: "vid-1", lines: EDITED, publishedLines: PUBLISHED, enabled: true });
    settle();
    const first = result.current.savedAt!;

    vi.setSystemTime(new Date(Date.now() + 60_000));
    const later = [aLine({ arabic: "شخبارك الحين" })];
    rerender({ videoId: "vid-1", lines: later, publishedLines: PUBLISHED, enabled: true });
    settle();

    expect(readDraft("vid-1")!.lines).toEqual(later);
    expect(result.current.savedAt).toBeGreaterThan(first);
  });

  it("drops its own draft when the editor comes back into step", () => {
    const { result, rerender } = setup();
    rerender({ videoId: "vid-1", lines: EDITED, publishedLines: PUBLISHED, enabled: true });
    settle();
    expect(readDraft("vid-1")).not.toBeNull();

    // Undoing back to the start. Leaving the draft would offer work back that
    // the reviewer had already decided against.
    rerender({ videoId: "vid-1", lines: PUBLISHED, publishedLines: PUBLISHED, enabled: true });
    settle();

    expect(readDraft("vid-1")).toBeNull();
    expect(result.current.savedAt).toBeNull();
  });

  it("says so when the browser refuses to store anything", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    const { result, rerender } = setup();

    rerender({ videoId: "vid-1", lines: EDITED, publishedLines: PUBLISHED, enabled: true });
    settle();

    // The reviewer needs to know there is no net under them, so they can press
    // Update before they walk away.
    expect(result.current.failed).toBe(true);
    expect(result.current.savedAt).toBeNull();
  });

  it("does nothing for a video that has not been created yet", () => {
    const { result, rerender } = setup({ videoId: undefined });
    rerender({ videoId: undefined, lines: EDITED, publishedLines: PUBLISHED, enabled: true });
    settle();

    expect(result.current.savedAt).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});

describe("recovering an abandoned draft", () => {
  it("offers back work left by an earlier session", () => {
    writeDraft("vid-1", EDITED);

    const { result } = setup();

    expect(result.current.recovered?.lines).toEqual(EDITED);
  });

  it("does not touch the editor until the reviewer says so", () => {
    writeDraft("vid-1", EDITED);
    const { result, onRestore } = setup();

    // The transcript below the prompt is still the published one. Restoring
    // silently would leave a reviewer editing something they never chose.
    expect(onRestore).not.toHaveBeenCalled();
    expect(result.current.dirty).toBe(false);
  });

  it("leaves the stored draft alone while it is on offer", () => {
    writeDraft("vid-1", EDITED);
    setup();
    settle();

    // The autosave pass sees an editor that matches what is published and would
    // otherwise tidy away the very work being recovered.
    expect(readDraft("vid-1")!.lines).toEqual(EDITED);
  });

  it("hands the lines back on restore", () => {
    const written = writeDraft("vid-1", EDITED)!;
    const { result } = setupLive(PUBLISHED);

    act(() => result.current.draft.restore());

    expect(result.current.lines).toEqual(EDITED);
    expect(result.current.draft.recovered).toBeNull();
    expect(result.current.draft.dirty).toBe(true);
    // Still the time the work was actually done at, not the time it was picked
    // back up — that is what the reviewer is matching against their memory.
    expect(result.current.draft.savedAt).toBe(written.savedAt);
  });

  it("keeps the restored work on disk", () => {
    writeDraft("vid-1", EDITED);
    const { result } = setupLive(PUBLISHED);

    act(() => result.current.draft.restore());
    settle();

    // Restoring is not publishing. The draft has to survive the restore, or a
    // second crash between picking the work back up and pressing Update would
    // lose it for good.
    expect(readDraft("vid-1")!.lines).toEqual(EDITED);
  });

  it("deletes the draft when it is discarded", () => {
    writeDraft("vid-1", EDITED);
    const { result } = setup();

    act(() => result.current.discardRecovered());

    expect(result.current.recovered).toBeNull();
    expect(readDraft("vid-1")).toBeNull();
  });

  it("ignores a draft that says the same as what is published", () => {
    writeDraft("vid-1", PUBLISHED);

    // Someone else published the same corrections in the meantime, or the same
    // reviewer did from another tab. Nothing to recover.
    expect(setup().result.current.recovered).toBeNull();
  });

  it("looks only once, so a discarded draft does not come back", () => {
    writeDraft("vid-1", EDITED);
    const { result, rerender } = setup();
    act(() => result.current.discardRecovered());

    rerender({ videoId: "vid-1", lines: PUBLISHED, publishedLines: PUBLISHED, enabled: true });

    expect(result.current.recovered).toBeNull();
  });
});

describe("publishing", () => {
  it("drops the draft once the transcript is stored", () => {
    const { result, rerender } = setup();
    rerender({ videoId: "vid-1", lines: EDITED, publishedLines: PUBLISHED, enabled: true });
    settle();

    act(() => result.current.clear());

    expect(readDraft("vid-1")).toBeNull();
    expect(result.current.savedAt).toBeNull();
  });
});

describe("leaving the page", () => {
  it("asks the browser to confirm while there is unpublished work", () => {
    const { rerender } = setup();
    rerender({ videoId: "vid-1", lines: EDITED, publishedLines: PUBLISHED, enabled: true });

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);

    // Covers the second before the debounce fires, and the browser that refused
    // to store a draft at all.
    expect(event.defaultPrevented).toBe(true);
  });

  it("does not nag when everything is published", () => {
    setup();

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
