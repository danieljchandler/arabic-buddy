import { useCallback, useEffect, useRef, useState } from "react";
import { useDialect } from "@/contexts/DialectContext";
import { fetchSpeechBlob } from "@/lib/speakArabic";

interface UseLineAudioOptions {
  /** The Arabic lines, in reading order. */
  lines: string[];
  /** Dialect override; defaults to the learner's active dialect. */
  dialect?: string;
}

interface UseLineAudioResult {
  /** The line currently sounding, or null. */
  playingIndex: number | null;
  /** The line whose audio is being synthesised, or null. */
  loadingIndex: number | null;
  /** True while a read-through is walking the lines. */
  isPlayingAll: boolean;
  /** Play one line. Tapping the line that is already sounding stops it. */
  playLine: (index: number) => void;
  /** Read from `from` to the end, one line after another. Tapping again stops. */
  playAll: (from?: number) => void;
  /** Silence everything and forget what was queued. */
  stop: () => void;
}

/**
 * Speech for a passage that is read one line at a time.
 *
 * Owning all of a passage's lines in a single hook, rather than giving each
 * line its own, is what makes the read-through possible: a sequential walk
 * needs to know when a clip ended so it can start the next one, and that
 * decision cannot live inside the line that just finished.
 *
 * Clips are synthesised on demand and kept for the life of the passage, so
 * replaying a line — which is most of what a learner does with it — costs
 * nothing. While a line plays, the next one is already being fetched, so the
 * read-through does not pause between lines for a round trip.
 *
 * Nothing is requested until a learner asks for it. This is the read view of an
 * article, not a listening exercise: synthesising a whole page up front would
 * spend a learner's daily TTS cap on lines they never press play on.
 */
export function useLineAudio({ lines, dialect }: UseLineAudioOptions): UseLineAudioResult {
  const { activeDialect } = useDialect();
  const spokenDialect = dialect ?? activeDialect;

  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [loadingIndex, setLoadingIndex] = useState<number | null>(null);
  const [isPlayingAll, setIsPlayingAll] = useState(false);

  // The latest lines, read inside the walk below. The parent rebuilds this
  // array on every render, so closing over it would let a read-through advance
  // through the list as it stood when play was pressed.
  const linesRef = useRef(lines);
  linesRef.current = lines;

  /** dialect+text → the clip's blob URL. Holds the promise, so two taps on the
   *  same line while it is still synthesising share one request. */
  const clipsRef = useRef(new Map<string, Promise<string | null>>());
  /** Every URL handed out, so unmount can revoke all of them. */
  const createdRef = useRef<string[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /**
   * Bumped by every stop and every new request. A walk whose id has gone stale
   * drops whatever it was about to do — without it, a synthesis started before
   * a stop would still start speaking when it finally landed.
   */
  const runRef = useRef(0);

  const halt = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audioRef.current = null;
      // `onpause` is deliberately left attached: it is what resolves the
      // promise the walk is sitting on, so stopping ends the walk rather than
      // leaving it pending forever.
      audio.pause();
    }
  }, []);

  const stop = useCallback(() => {
    runRef.current++;
    halt();
    setPlayingIndex(null);
    setLoadingIndex(null);
    setIsPlayingAll(false);
  }, [halt]);

  const clipFor = useCallback(
    (text: string): Promise<string | null> => {
      const key = `${spokenDialect}\u0000${text}`;
      const clips = clipsRef.current;
      const cached = clips.get(key);
      if (cached) return cached;

      const pending = fetchSpeechBlob({ text, dialect: spokenDialect })
        .then((blob) => {
          if (!blob) {
            // Don't cache a failure: a 401 that a sign-in fixes, or a provider
            // blip, should not make the line permanently mute.
            clips.delete(key);
            return null;
          }
          const url = URL.createObjectURL(blob);
          createdRef.current.push(url);
          return url;
        })
        .catch((err) => {
          clips.delete(key);
          console.error("Line audio failed:", err);
          return null;
        });

      clips.set(key, pending);
      return pending;
    },
    [spokenDialect],
  );

  /** Resolves true when the clip reached its end, false when it was stopped. */
  const sound = useCallback((url: string) => {
    return new Promise<boolean>((resolve) => {
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => resolve(true);
      audio.onerror = () => resolve(false);
      audio.onpause = () => resolve(false);
      audio.play().catch(() => resolve(false));
    });
  }, []);

  const walk = useCallback(
    async (from: number, continuous: boolean) => {
      const id = ++runRef.current;
      halt();
      setIsPlayingAll(continuous);

      for (let i = from; i >= 0 && i < linesRef.current.length; i++) {
        const text = linesRef.current[i]?.trim();
        if (!text) {
          // A read-through steps over a blank line; a single-line play has
          // nothing else to say.
          if (continuous) continue;
          break;
        }

        setLoadingIndex(i);
        const url = await clipFor(text);
        if (id !== runRef.current) return;
        setLoadingIndex(null);
        if (!url) break;

        setPlayingIndex(i);
        if (continuous) {
          // Fetch the next line while this one is speaking. The TTS queue is
          // serial, so this is the whole reason a read-through sounds like a
          // reading rather than a line every few seconds.
          const next = linesRef.current[i + 1]?.trim();
          if (next) void clipFor(next);
        }

        const finished = await sound(url);
        if (id !== runRef.current) return;
        if (!finished || !continuous) break;
      }

      if (id !== runRef.current) return;
      setPlayingIndex(null);
      setLoadingIndex(null);
      setIsPlayingAll(false);
    },
    [clipFor, halt, sound],
  );

  const playLine = useCallback(
    (index: number) => {
      if (playingIndex === index) {
        stop();
        return;
      }
      void walk(index, false);
    },
    [playingIndex, stop, walk],
  );

  const playAll = useCallback(
    (from = 0) => {
      if (isPlayingAll) {
        stop();
        return;
      }
      void walk(from, true);
    },
    [isPlayingAll, stop, walk],
  );

  // A new passage silences the old one. Positions mean nothing across a change
  // of content, so a read-through must not carry into the next article.
  const contentKey = `${spokenDialect}\u0000${lines.join("\u0000")}`;
  useEffect(() => {
    stop();
  }, [contentKey, stop]);

  useEffect(() => {
    const clips = clipsRef.current;
    const created = createdRef.current;
    return () => {
      runRef.current++;
      halt();
      created.forEach((url) => URL.revokeObjectURL(url));
      created.length = 0;
      clips.clear();
    };
  }, [halt]);

  return { playingIndex, loadingIndex, isPlayingAll, playLine, playAll, stop };
}
