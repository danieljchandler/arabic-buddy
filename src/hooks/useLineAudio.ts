import { useCallback, useEffect, useRef, useState } from "react";
import { useDialect } from "@/contexts/DialectContext";
import { fetchSpeechBlob } from "@/lib/speakArabic";

interface UseLineAudioOptions {
  /** The Arabic lines, in reading order. */
  lines: string[];
  /** Dialect override; defaults to the learner's active dialect. */
  dialect?: string;
  /**
   * Audio already made for a line, by index.
   *
   * Some passages are narrated ahead of time and stored — the reading
   * library's stories are, by an editor pressing "generate full audio". A URL
   * here is played as-is instead of being synthesised, so a learner replaying
   * a published story spends nothing from their daily cap. Leave an entry
   * empty and that line falls back to synthesis, which is what a page does
   * when the stored clip does not match the register on screen: a fusha
   * recording under dialect text is the one thing worse than no audio.
   */
  clips?: Array<string | null | undefined>;
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
 * A 44-byte WAV with no samples — silence, and the shortest legal thing an
 * `<audio>` element will accept. See `primeElement` for why one is needed.
 */
const SILENT_CLIP =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

/**
 * The one clip sounding anywhere on the page, as a function that silences it.
 *
 * A Souq News page mounts one of these hooks per article and one more per
 * headline, so without a page-wide rule a learner who taps a headline and then
 * a sentence hears both at once. Overlapping Arabic is not two things they can
 * hear — it is neither, which is the same reason `useAudioPlayer` owns a single
 * element for the app's one-off speaker buttons. Module scope rather than
 * context: the rule is about the sound card, not about a subtree.
 */
let sounding: (() => void) | null = null;

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
export function useLineAudio({ lines, dialect, clips }: UseLineAudioOptions): UseLineAudioResult {
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
  const presetsRef = useRef(clips);
  presetsRef.current = clips;

  /** The stored clip for a line, when there is one. */
  const presetFor = useCallback(
    (index: number) => presetsRef.current?.[index]?.trim() || null,
    [],
  );

  /** dialect+text → the clip's blob URL. Holds the promise, so two taps on the
   *  same line while it is still synthesising share one request. */
  const clipsRef = useRef(new Map<string, Promise<string | null>>());
  /** Every URL handed out, so unmount can revoke all of them. */
  const createdRef = useRef<string[]>([]);
  /**
   * One element for the passage, kept for the hook's whole life rather than
   * built per clip — see `primeElement`.
   */
  const elementRef = useRef<HTMLAudioElement | null>(null);
  const primedRef = useRef(false);
  /** Settles the promise the walk is currently waiting on. */
  const pendingRef = useRef<((finished: boolean) => void) | null>(null);
  /**
   * Bumped by every stop and every new request. A walk whose id has gone stale
   * drops whatever it was about to do — without it, a synthesis started before
   * a stop would still start speaking when it finally landed.
   */
  const runRef = useRef(0);

  /**
   * Spend the tap's user activation, while there still is one.
   *
   * iOS Safari only lets audio start from inside a gesture, and by the time a
   * line has been synthesised the gesture is long over — the first tap on every
   * line would fetch a clip and silently fail to play it, and a read-through
   * would stop on its first line with nothing to say why. (Our Playwright
   * Chromium runs with `--autoplay-policy=no-user-gesture-required`, so no e2e
   * test can see this.)
   *
   * So the element is created and played *during* the tap, on a clip of
   * silence. An element that has played once under a gesture may be given a new
   * source and played again later, which is what every subsequent line relies
   * on.
   */
  const primeElement = useCallback(() => {
    let audio = elementRef.current;
    if (!audio) {
      audio = new Audio();
      elementRef.current = audio;
    }
    if (!primedRef.current) {
      primedRef.current = true;
      audio.src = SILENT_CLIP;
      void audio.play().catch(() => {});
    }
    return audio;
  }, []);

  const halt = useCallback(() => {
    elementRef.current?.pause();
    // Settled here rather than from a `pause` listener. Swapping `src` on a
    // playing element fires `pause` too, so a listener could not tell "the
    // learner stopped this" from "the next line is starting".
    pendingRef.current?.(false);
  }, []);

  const stop = useCallback(() => {
    runRef.current++;
    halt();
    if (sounding === stopRef.current) sounding = null;
    setPlayingIndex(null);
    setLoadingIndex(null);
    setIsPlayingAll(false);
  }, [halt]);

  // This instance's own silencer, as the page-wide rule above stores it.
  const stopRef = useRef(stop);
  stopRef.current = stop;

  const clipFor = useCallback(
    (text: string): Promise<string | null> => {
      const key = `${spokenDialect}\u0000${text}`;
      // Named for what it is, so it is not read as the `clips` option above —
      // that one is recordings made earlier, this one is what this passage has
      // synthesised so far.
      const cache = clipsRef.current;
      const cached = cache.get(key);
      if (cached) return cached;

      const pending = fetchSpeechBlob({ text, dialect: spokenDialect })
        .then((blob) => {
          if (!blob) {
            // Don't cache a failure: a 401 that a sign-in fixes, or a provider
            // blip, should not make the line permanently mute.
            cache.delete(key);
            return null;
          }
          const url = URL.createObjectURL(blob);
          createdRef.current.push(url);
          return url;
        })
        .catch((err) => {
          cache.delete(key);
          console.error("Line audio failed:", err);
          return null;
        });

      cache.set(key, pending);
      return pending;
    },
    [spokenDialect],
  );

  /** Resolves true when the clip reached its end, false when it was stopped. */
  const sound = useCallback((url: string) => {
    const audio = elementRef.current;
    if (!audio) return Promise.resolve(false);

    return new Promise<boolean>((resolve) => {
      const finish = (finished: boolean) => {
        // Only the live clip may settle: a `play()` rejected because the next
        // line replaced the source arrives after that line has started.
        if (pendingRef.current !== finish) return;
        pendingRef.current = null;
        audio.onended = null;
        audio.onerror = null;
        resolve(finished);
      };

      pendingRef.current = finish;
      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);
      audio.src = url;
      audio.play().catch(() => finish(false));
    });
  }, []);

  const walk = useCallback(
    async (from: number, continuous: boolean) => {
      if (sounding && sounding !== stopRef.current) sounding();
      sounding = stopRef.current;

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

        // A stored recording needs no round trip, so it never shows a spinner.
        let url = presetFor(i);
        if (!url) {
          setLoadingIndex(i);
          url = await clipFor(text);
          if (id !== runRef.current) return;
          setLoadingIndex(null);
        }
        if (!url) break;

        setPlayingIndex(i);
        if (continuous) {
          // Fetch the next line while this one is speaking. The TTS queue is
          // serial, so this is the whole reason a read-through sounds like a
          // reading rather than a line every few seconds.
          const next = linesRef.current[i + 1]?.trim();
          if (next && !presetFor(i + 1)) void clipFor(next);
        }

        const finished = await sound(url);
        if (id !== runRef.current) return;
        if (!finished || !continuous) break;
      }

      if (id !== runRef.current) return;
      if (sounding === stopRef.current) sounding = null;
      setPlayingIndex(null);
      setLoadingIndex(null);
      setIsPlayingAll(false);
    },
    [clipFor, halt, presetFor, sound],
  );

  const playLine = useCallback(
    (index: number) => {
      primeElement();
      if (playingIndex === index) {
        stop();
        return;
      }
      void walk(index, false);
    },
    [playingIndex, primeElement, stop, walk],
  );

  const playAll = useCallback(
    (from = 0) => {
      primeElement();
      if (isPlayingAll) {
        stop();
        return;
      }
      void walk(from, true);
    },
    [isPlayingAll, primeElement, stop, walk],
  );

  // A new passage silences the old one. Positions mean nothing across a change
  // of content, so a read-through must not carry into the next article.
  const contentKey = `${spokenDialect}\u0000${lines.join("\u0000")}\u0000${(clips ?? []).join("\u0000")}`;
  useEffect(() => {
    stop();
  }, [contentKey, stop]);

  useEffect(() => {
    const cache = clipsRef.current;
    const created = createdRef.current;
    return () => {
      // The *live* run id, deliberately: bumping it is what tells a walk still
      // waiting on a synthesis that its passage is gone. A copy taken when the
      // effect ran would be the one thing that could not do that.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      runRef.current++;
      halt();
      if (sounding === stopRef.current) sounding = null;
      elementRef.current = null;
      primedRef.current = false;
      created.forEach((url) => URL.revokeObjectURL(url));
      created.length = 0;
      cache.clear();
    };
  }, [halt]);

  return { playingIndex, loadingIndex, isPlayingAll, playLine, playAll, stop };
}
