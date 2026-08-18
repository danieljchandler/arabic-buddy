import { useMemo, useState, type ReactNode, type SyntheticEvent } from "react";
import { cn } from "@/lib/utils";
import {
  getThumbnailCandidates,
  YOUTUBE_PLACEHOLDER_WIDTH,
} from "@/lib/videoEmbed";

interface VideoThumbnailProps {
  /** Whatever is stored on the row; upgraded to the best size available. */
  src: string | null | undefined;
  alt: string;
  className?: string;
  /** Shown when there is no thumbnail, or when every size failed to load. */
  fallback?: ReactNode;
  loading?: "lazy" | "eager";
  /** Hides the image from assistive tech, for decorative stills behind text. */
  decorative?: boolean;
}

/**
 * A video still, at the largest size the video actually has.
 *
 * Thumbnails used to be rendered straight from the stored URL, which for
 * YouTube meant a 480x360 `hqdefault` on cards two to four times that wide —
 * soft, and letterboxed into 4:3 on top of it. `getThumbnailCandidates` turns
 * one stored URL into a ladder of sizes; this walks down it, because
 * `maxresdefault` only exists for videos YouTube generated one for and comes
 * back as a 404 (or, occasionally, a grey 120x90 placeholder served with a
 * 200) for the rest. The step down happens before paint in practice, since a
 * missing size fails on headers alone.
 */
export function VideoThumbnail({
  src,
  alt,
  className,
  fallback = null,
  loading = "lazy",
  decorative = false,
}: VideoThumbnailProps) {
  const candidates = useMemo(() => getThumbnailCandidates(src), [src]);

  // The ladder is stored with the position in it, so a recycled card — the
  // feed reuses them as it scrolls — starts over rather than inheriting the
  // previous video's position. Resetting here rather than in an effect keeps
  // it from fetching a smaller still for one paint on the way past.
  const [ladder, setLadder] = useState({ candidates, attempt: 0 });
  if (ladder.candidates !== candidates) setLadder({ candidates, attempt: 0 });

  const attempt = ladder.candidates === candidates ? ladder.attempt : 0;
  const current = candidates[attempt];
  if (!current) return <>{fallback}</>;

  const stepDown = () => setLadder((prev) => ({ ...prev, attempt: prev.attempt + 1 }));

  /** Catch the grey placeholder, which loads "successfully" at 120x90. */
  const checkForPlaceholder = (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth } = event.currentTarget;
    if (naturalWidth > 0 && naturalWidth <= YOUTUBE_PLACEHOLDER_WIDTH && attempt < candidates.length - 1) {
      stepDown();
    }
  };

  return (
    <img
      // The size being tried is part of the identity: without it React keeps
      // the failed <img>, and its error state, when only `src` changes.
      key={current}
      src={current}
      alt={decorative ? "" : alt}
      aria-hidden={decorative || undefined}
      loading={loading}
      decoding="async"
      className={cn("w-full h-full object-cover", className)}
      onError={stepDown}
      onLoad={checkForPlaceholder}
    />
  );
}
