import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TranscriptLine } from "@/types/transcript";
import {
  clearDraft,
  linesEqual,
  readDraft,
  writeDraft,
  type TranscriptDraft,
} from "@/lib/transcriptDraft";

const DEFAULT_DEBOUNCE_MS = 1000;

export interface UseTranscriptDraftOptions {
  /** The video being edited. Drafts are keyed by it; a new video has none. */
  videoId: string | undefined;
  /** The transcript as the editor currently holds it. */
  lines: TranscriptLine[];
  /** The transcript as it is stored — what learners see, and what Update Video overwrites. */
  publishedLines: TranscriptLine[];
  /** Put a recovered draft back into the form. */
  onRestore: (lines: TranscriptLine[]) => void;
  /** False until the stored transcript has actually arrived, so nothing is compared against a placeholder. */
  enabled?: boolean;
  debounceMs?: number;
}

export interface TranscriptDraftState {
  /** The editor holds changes the server has not got. */
  dirty: boolean;
  /** When the draft was last written to this device, or null if nothing is stored. */
  savedAt: number | null;
  /** The browser refused to store the draft — there is no safety net right now. */
  failed: boolean;
  /** A draft found on arrival that the form has not applied. */
  recovered: TranscriptDraft | null;
  /** Put the recovered draft into the editor. */
  restore: () => void;
  /** Throw the recovered draft away and keep what is published. */
  discardRecovered: () => void;
  /** Drop the draft — what a successful publish does, since the server now holds it. */
  clear: () => void;
}

/**
 * Keeps an unpublished transcript alive on the reviewer's own device.
 *
 * Two jobs, and the second is why this is a hook rather than a `useEffect` in
 * the form. The first is the obvious one: write every settled edit somewhere
 * that survives the tab. The second is telling the truth about it — a reviewer
 * has to be able to see, without asking, that their corrections are saved *on
 * this machine* and not yet published, because those two words mean completely
 * different things to the learner opening the video.
 *
 * A stored draft is never overwritten or dropped behind the reviewer's back:
 * it is cleared when they publish, when they explicitly discard it, or when the
 * editor comes back into step with what is published after this session wrote
 * one. A draft written by an earlier session is offered back and left alone
 * until they answer.
 */
export function useTranscriptDraft({
  videoId,
  lines,
  publishedLines,
  onRestore,
  enabled = true,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: UseTranscriptDraftOptions): TranscriptDraftState {
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [recovered, setRecovered] = useState<TranscriptDraft | null>(null);

  /** This session has written a draft, so clearing one is clearing our own. */
  const wroteDraft = useRef(false);
  /** The video whose stored draft has already been looked at. */
  const checked = useRef<string | null>(null);

  const dirty = useMemo(
    () => enabled && !linesEqual(lines, publishedLines),
    [enabled, lines, publishedLines],
  );

  // Look for an abandoned draft, once per video. This has to happen before any
  // autosave: on arrival the editor holds exactly what is published, and a
  // "nothing has changed, tidy up" pass would delete the very work being
  // recovered before the reviewer ever saw it offered.
  useEffect(() => {
    if (!enabled || !videoId) return;
    if (checked.current === videoId) return;
    checked.current = videoId;
    const stored = readDraft(videoId);
    if (stored && !linesEqual(stored.lines, publishedLines)) setRecovered(stored);
  }, [enabled, videoId, publishedLines]);

  useEffect(() => {
    if (!enabled || !videoId) return;
    // Leave a draft that is still on offer exactly where it is.
    if (recovered) return;

    if (!dirty) {
      if (wroteDraft.current) {
        // Back in step with what is published — usually an undo back to the
        // start. Only ever our own draft: one from an earlier session is
        // offered above, not deleted here.
        clearDraft(videoId);
        wroteDraft.current = false;
        setSavedAt(null);
        setFailed(false);
      }
      return;
    }

    const timer = setTimeout(() => {
      const written = writeDraft(videoId, lines);
      if (written) {
        wroteDraft.current = true;
        setSavedAt(written.savedAt);
        setFailed(false);
      } else {
        setFailed(true);
      }
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [debounceMs, dirty, enabled, lines, recovered, videoId]);

  // The last line of defence, for the case the draft cannot cover: a reload in
  // the second before the debounce fires, or a browser that refused storage.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const restore = useCallback(() => {
    if (!recovered) return;
    onRestore(recovered.lines);
    // Adopted rather than rewritten: the timestamp shown stays the one the work
    // was actually done at until the next edit moves it.
    wroteDraft.current = true;
    setSavedAt(recovered.savedAt);
    setRecovered(null);
  }, [onRestore, recovered]);

  const discardRecovered = useCallback(() => {
    if (videoId) clearDraft(videoId);
    setRecovered(null);
    setSavedAt(null);
    wroteDraft.current = false;
  }, [videoId]);

  const clear = useCallback(() => {
    if (videoId) clearDraft(videoId);
    setRecovered(null);
    setSavedAt(null);
    setFailed(false);
    wroteDraft.current = false;
  }, [videoId]);

  return { dirty, savedAt, failed, recovered, restore, discardRecovered, clear };
}
