import { useMemo, useCallback, useRef } from "react";
import type { LineWordTiming, TranscriptLine, WordToken, Segment, Word } from "@/types/transcript";
import { reconcileLineTokens } from "@/lib/transcriptTokens";
import TranscriptEditor, { type LineReviewSlot } from "@/components/TranscriptEditor";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

/**
 * What the edge function actually said, rather than what supabase-js says.
 *
 * The client raises `FunctionsHttpError` with the fixed message "Edge Function
 * returned a non-2xx status code" for every non-2xx, whatever the function put
 * in the body — so a 429 over-quota, a 400 bad request and a 500 crash all
 * reached the admin as the same opaque line, and there was nothing on screen to
 * act on. The status and the response live on `error.context`; the same place
 * `showCapToastIfLimited` reads them from.
 */
async function describeFunctionError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx === "object" && "status" in ctx) {
    const response = ctx as Response;
    try {
      const body = (await response.clone().json()) as { message?: string; error?: string };
      const detail = body.message || body.error;
      if (detail) return `${response.status}: ${detail}`;
    } catch {
      /* not JSON — the status is still worth more than the generic message */
    }
    return `The server returned ${response.status}.`;
  }
  return (error as { message?: string } | null)?.message ?? "Unknown error";
}

/** One line as `resync-transcript-timing` returns it. */
interface ResyncLine {
  id: string;
  arabic?: string;
  translation?: string;
  literal?: string;
  startMs: number;
  endMs: number;
  words?: LineWordTiming[];
  /** Set on a line the server cut out of a longer one, naming that line. */
  splitFrom?: string;
}

interface ResyncReply {
  lines?: ResyncLine[];
  matched?: number;
  total?: number;
  /** How many over-long lines were cut at the speaker's pauses, and into how many. */
  splitCount?: number;
  pieceCount?: number;
  /** Whether every new piece came back with English drafted for it. */
  translated?: boolean;
}

/**
 * What a re-sync did, in one line under the toast.
 *
 * "Review the proposed times" told the reviewer nothing they could check. The
 * counts are what let them judge the proposal before opening the diff: how
 * many words the aligner actually placed, and whether any line was cut up.
 */
function describeResync(reply: ResyncReply, lineCount: number): string {
  const parts: string[] = [];
  if (typeof reply.matched === "number" && typeof reply.total === "number" && reply.total > 0) {
    parts.push(`${reply.matched} of ${reply.total} words matched to the audio across ${lineCount} lines.`);
  } else {
    parts.push(`${lineCount} lines re-timed.`);
  }
  if (reply.splitCount && reply.pieceCount) {
    parts.push(
      `${reply.splitCount} long ${reply.splitCount === 1 ? "line was" : "lines were"} cut at the speaker's pauses into ${reply.pieceCount}` +
        (reply.translated ? ", with English drafted." : " — the new lines still need translating."),
    );
  }
  parts.push("Accept or reject the proposal below.");
  return parts.join(" ");
}

/**
 * A 404 here is not a missing video — the function checks that itself and
 * answers 404 with `video_not_found` — but a backend that has never had this
 * function deployed. Naming that is the difference between "nothing happened"
 * and knowing what to deploy.
 */
async function describeResyncError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx === "object" && "status" in ctx && (ctx as Response).status === 404) {
    try {
      const body = (await (ctx as Response).clone().json()) as { error?: string };
      if (body?.error === "video_not_found") return "404: this video no longer exists.";
    } catch {
      /* not JSON — a bare 404 from the gateway is the undeployed case */
    }
    return "The re-sync function is not deployed on this backend yet (resync-transcript-timing). Deploy the edge functions and try again.";
  }
  return describeFunctionError(error);
}

interface AdminTranscriptEditorProps {
  lines: TranscriptLine[];
  onChange: (lines: TranscriptLine[]) => void;
  audioUrl?: string;
  /**
   * The video whose transcript this is. Supplying it enables the "Re-sync
   * timing" action, which needs the id to find the staged audio server-side.
   */
  videoId?: string;
  /**
   * Per-line review state. Supplied by the native-speaker workspace and absent
   * in the video form, which is what decides whether the reviewer's chrome —
   * checkmarks, comments, per-line audio — appears at all.
   */
  lineReview?: (lineId: string) => LineReviewSlot | undefined;
  /** Re-translate one line from the Arabic it now holds. */
  onRetranslate?: (lineId: string) => void;
}

/**
 * Adapter that bridges TranscriptLine[] (admin data model, ms-based)
 * with TranscriptEditor's Segment[] (seconds-based).
 *
 * Token glosses are preserved via a ref map so round-tripping doesn't lose data.
 */
export function AdminTranscriptEditor({
  lines,
  onChange,
  audioUrl,
  videoId,
  lineReview,
  onRetranslate,
}: AdminTranscriptEditorProps) {
  /**
   * The glosses that came in, kept per line and in order, so they survive the
   * round-trip through the editor.
   *
   * These were once keyed by `segmentId:tokenIndex:surface`, which tied every
   * gloss to a position. Deleting one word from the middle of a line renumbers
   * everything after it, so each of those words looked up a key that no longer
   * existed: the gloss was dropped and a fresh id minted, and the token came
   * back reading as brand new. Fixing a typo in the first word of a ten-word
   * line silently discarded nine hand-written glosses. A split was worse — one
   * half gets a new segment id, so none of its words could match at all.
   *
   * Order within the line is what actually carries the meaning, and it is what
   * the index was really standing in for: it is the only thing that tells the
   * two في in "في البيت في الصباح" apart. So the glosses are claimed in order
   * by surface instead, which survives a word being added or removed anywhere
   * in the line.
   *
   * Lines that have disappeared are kept on purpose — a split's original id is
   * gone, and its glosses are exactly what the two halves need.
   */
  const glossPoolRef = useRef<Map<string, WordToken[]>>(new Map());

  /**
   * The rest of each line, which the editor never sees.
   *
   * `Segment` carries five fields; `TranscriptLine` carries a dozen. The
   * conversion out drops `literal`, `fusha`, `needs_review`, `review_reason`,
   * `altTranslation`, `resolved_by` and `segmentType`, and the conversion back
   * rebuilt each line from scratch — so every save through this editor deleted
   * all of them, for every line, whether or not it had been touched. Fixing one
   * typo threw away the Fusha row and the ensemble's own review flags for the
   * entire transcript, silently, and the analysis pass that produced them costs
   * several model calls per line to redo.
   */
  const extrasRef = useRef<Map<string, TranscriptLine>>(new Map());

  useMemo(() => {
    for (const line of lines) {
      glossPoolRef.current.set(line.id, [...(line.tokens ?? [])]);
      extrasRef.current.set(line.id, line);
    }
  }, [lines]);

  const initialSegments: Segment[] = useMemo(
    () =>
      lines.map((line) => {
        const startSec = (line.startMs ?? 0) / 1000;
        const endSec = (line.endMs ?? 0) / 1000;
        // The card renders its Arabic from `words`, which is built from the
        // line's tokens — so a line whose tokens are missing was drawn blank,
        // and a line whose tokens have gone stale (an edit saved by a build
        // that set only `arabic`) kept showing the OLD words: the correction
        // was visible inside the edit box and "reverted" the moment it closed.
        // Reconcile against `arabic`, the source of truth — it also means the
        // next save writes the healed tokens back.
        const tokens = reconcileLineTokens(line).tokens ?? [];

        // Real per-word timings, when the alignment pass left them and they
        // still describe this text: `line.words` parallels the whitespace
        // split of `arabic`, so a token count that matches means each token
        // can carry its own word's time. A line edited since alignment (the
        // counts diverge) falls back to an even spread — the fabrication the
        // whole editor once ran on, now only the last resort. Either way the
        // AI re-segmentation, which rebuilds segment start/end from word
        // timings, gets something to anchor to.
        const timed = line.words;
        const useReal = Array.isArray(timed) && timed.length === tokens.length && timed.length > 0;
        const n = Math.max(tokens.length, 1);
        const dur = Math.max(endSec - startSec, 0);
        const step = dur / n;
        return {
          id: line.id,
          video_id: "",
          start: startSec,
          end: endSec,
          text: line.arabic,
          translation: line.translation,
          confidence: 1,
          words: tokens.map<Word>((t, i) => ({
            word: t.surface,
            start: useReal ? timed![i].startMs / 1000 : startSec + step * i,
            end: useReal ? timed![i].endMs / 1000 : startSec + step * (i + 1),
            confidence: 1,
          })),
        };
      }),
    [lines],
  );

  const handleSave = useCallback(
    (segments: Segment[]) => {
      // Rebuilt per save so each cached token can be claimed exactly once: two
      // occurrences of the same word must not both end up with the first one's
      // gloss.
      const claimed = new Set<WordToken>();
      const perLine = new Map<string, Map<string, WordToken[]>>();
      // The fallback for a line the editor renamed — a split gives one half a
      // fresh id, so its words have no line of their own to look in.
      const anywhere = new Map<string, WordToken[]>();

      const push = (bucket: Map<string, WordToken[]>, surface: string, token: WordToken) => {
        const queue = bucket.get(surface);
        if (queue) queue.push(token);
        else bucket.set(surface, [token]);
      };

      for (const [lineId, tokens] of glossPoolRef.current) {
        const bySurface = new Map<string, WordToken[]>();
        for (const token of tokens) {
          push(bySurface, token.surface, token);
          push(anywhere, token.surface, token);
        }
        perLine.set(lineId, bySurface);
      }

      const take = (bucket: Map<string, WordToken[]> | undefined, surface: string) => {
        const queue = bucket?.get(surface);
        while (queue?.length) {
          const token = queue.shift()!;
          if (!claimed.has(token)) return token;
        }
        return undefined;
      };

      /**
       * The per-word timings this save should carry.
       *
       * The editor's words now hold the best timing knowledge there is — real
       * where the alignment pass supplied them, respread only where an edit
       * forced it — so they round-trip back onto the line rather than letting
       * a save silently revert to whatever the pipeline wrote. When nothing
       * moved, the original array (with its `matched` provenance flags)
       * survives byte for byte; once anything differs, provenance is genuinely
       * mixed and the flags are dropped rather than invented.
       */
      const wordsFor = (seg: Segment, original?: TranscriptLine): LineWordTiming[] => {
        const fresh = seg.words.map<LineWordTiming>((w) => ({
          surface: w.word,
          startMs: Math.round(w.start * 1000),
          endMs: Math.round(w.end * 1000),
        }));
        const prior = original?.words;
        const unchanged =
          Array.isArray(prior) &&
          prior.length === fresh.length &&
          prior.every(
            (p, i) =>
              p.surface === fresh[i].surface &&
              p.startMs === fresh[i].startMs &&
              p.endMs === fresh[i].endMs,
          );
        return unchanged ? prior! : fresh;
      };

      const updated: TranscriptLine[] = segments.map((seg) => {
        const original = extrasRef.current.get(seg.id);
        const arabic = seg.text;
        // `fusha` and `altTranslation` are renderings of the exact previous
        // wording, so they are dropped when the Arabic moves — a Fusha row for
        // words that are no longer there is worse than none, and `useFushaLines`
        // refills it on demand. Everything else survives.
        const arabicChanged = Boolean(original) && original!.arabic !== arabic;

        return {
          ...original,
          ...(arabicChanged
            ? { fusha: undefined, altTranslation: undefined, resolved_by: undefined }
            : {}),
          id: seg.id,
          arabic,
          translation: seg.translation,
          literal: seg.literal ?? original?.literal,
          startMs: Math.round(seg.start * 1000),
          endMs: Math.round(seg.end * 1000),
          words: wordsFor(seg, original),
          tokens: seg.words.map<WordToken>((w) => {
            const cached = take(perLine.get(seg.id), w.word) ?? take(anywhere, w.word);
            if (cached) claimed.add(cached);
            return {
              id: cached?.id ?? crypto.randomUUID(),
              surface: w.word,
              standard: cached?.standard,
              gloss: cached?.gloss,
              compoundRef: cached?.compoundRef,
            };
          }),
        };
      });
      onChange(updated);
    },
    [onChange],
  );

  const handleResyncTiming = useCallback(
    async (segments: Segment[]): Promise<Segment[] | null> => {
      if (!videoId) return null;
      try {
        // The server aligns the text the reviewer is looking at — the editor's
        // current lines, unsaved edits included — against the staged audio.
        const { data, error } = await supabase.functions.invoke("resync-transcript-timing", {
          body: {
            videoId,
            lines: segments.map((seg) => ({ id: seg.id, arabic: seg.text })),
          },
        });
        if (error) throw error;
        const reply = (data ?? null) as ResyncReply | null;
        const retimed = reply?.lines;
        if (!retimed || retimed.length === 0) {
          toast({
            title: "Re-sync returned no timings",
            description: "The audio may not be staged for this video yet.",
            variant: "destructive",
          });
          return null;
        }

        // A line the server cut at the speaker's pauses comes back as several
        // lines naming it in `splitFrom`. They replace it, in the server's
        // order; a line it re-timed is matched by id; a line it did not mention
        // is left exactly as it was.
        const byId = new Map<string, ResyncLine>();
        const piecesOf = new Map<string, ResyncLine[]>();
        for (const line of retimed) {
          if (line.splitFrom) {
            const list = piecesOf.get(line.splitFrom) ?? [];
            list.push(line);
            piecesOf.set(line.splitFrom, list);
          } else {
            byId.set(line.id, line);
          }
        }
        const toWords = (line: ResyncLine): Word[] =>
          (line.words ?? []).map<Word>((w) => ({
            word: w.surface,
            start: w.startMs / 1000,
            end: w.endMs / 1000,
            confidence: 1,
          }));

        toast({
          title: "Timings aligned to the audio",
          description: describeResync(reply!, retimed.length),
        });
        return segments.flatMap<Segment>((seg) => {
          const pieces = piecesOf.get(seg.id);
          if (pieces && pieces.length > 0) {
            return pieces.map<Segment>((piece) => ({
              ...seg,
              id: piece.id,
              text: piece.arabic ?? seg.text,
              translation: piece.translation ?? "",
              literal: piece.literal,
              start: piece.startMs / 1000,
              end: piece.endMs / 1000,
              confidence: 1,
              words: toWords(piece),
            }));
          }
          const match = byId.get(seg.id);
          if (!match) return [seg];
          return [{
            ...seg,
            start: match.startMs / 1000,
            end: match.endMs / 1000,
            words: toWords(match),
          }];
        });
      } catch (e: unknown) {
        toast({
          title: "Re-sync failed",
          description: await describeResyncError(e),
          variant: "destructive",
        });
        return null;
      }
    },
    [videoId],
  );

  const handleAIResegment = useCallback(
    async (segments: Segment[]): Promise<Segment[] | null> => {
      try {
        const { data, error } = await supabase.functions.invoke("ai-resegment-transcript", {
          body: { segments },
        });
        if (error) throw error;
        const proposed = (data as { segments?: Segment[] } | null)?.segments;
        if (!proposed || proposed.length === 0) {
          toast({
            title: "AI re-segmentation returned no lines",
            description: "Try again or adjust the transcript first.",
            variant: "destructive",
          });
          return null;
        }
        toast({
          title: "AI proposed a new segmentation",
          description: `Review the ${proposed.length} suggested lines and accept or reject.`,
        });
        return proposed;
      } catch (e: unknown) {
        toast({
          title: "AI re-segmentation failed",
          description: await describeFunctionError(e),
          variant: "destructive",
        });
        return null;
      }
    },
    [],
  );

  return (
    <TranscriptEditor
      initialSegments={initialSegments}
      videoUrl={audioUrl}
      onSave={handleSave}
      onAIResegment={handleAIResegment}
      onResyncTiming={videoId ? handleResyncTiming : undefined}
      lineReview={lineReview}
      onRetranslate={onRetranslate}
    />
  );
}
