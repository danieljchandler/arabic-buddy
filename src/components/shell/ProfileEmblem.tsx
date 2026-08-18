import { useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useProfileAvatar } from "@/hooks/useProfileAvatar";
import hakiyaIconAsset from "@/assets/hakiya-icon.png.asset.json";

/**
 * Your face, top-left, as the way into your profile.
 *
 * Deliberately not a dock tab. A tab competes with four neighbours and shifts
 * as the bar changes; a corner emblem is in the same place on every screen and
 * never moves, which is what makes it reachable without looking.
 *
 * It shows the picture you chose. That was the point of choosing one: an
 * avatar that only ever appears on the profile page and the leaderboard is a
 * setting, not an identity, and this is the one spot that is on the screen
 * often enough to make it feel like yours. The Hakiya mark it used to carry
 * moved to `BrandMark`, alongside this, so the brand is still on the page.
 *
 * The mark stays here as the fallback, for a visitor who is signed out and for
 * an account that has not picked a picture yet — better a mark than an empty
 * grey disc, and it keeps the corner looking like something rather than like a
 * failure to load.
 *
 * When something is waiting, the desert-red ring lights up and the emblem
 * becomes a status light. That reads at a glance the way a story ring does,
 * without spending a badge on it.
 */
export function ProfileEmblem({
  hasNews = false,
  className,
}: {
  /** Ring on: something is waiting (due reviews, a new streak day, a reply). */
  hasNews?: boolean;
  className?: string;
}) {
  const { data } = useProfileAvatar();
  /**
   * A picture that 404s falls back to the mark rather than to a broken image.
   * Tracked by URL, not as a boolean, so picking a new avatar after a bad one
   * is given its own chance to load.
   */
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const avatarUrl = data?.avatarUrl && data.avatarUrl !== brokenUrl ? data.avatarUrl : null;

  return (
    <Link
      to="/me"
      data-tour="emblem"
      aria-label={hasNews ? "Your account — something new is waiting" : "Your account"}
      className={cn(
        "relative grid h-10 w-10 shrink-0 place-items-center rounded-full",
        "transition-transform active:scale-95",
        className,
      )}
    >
      {hasNews && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full ring-2 ring-primary ring-offset-2 ring-offset-transparent"
        />
      )}
      <img
        src={avatarUrl ?? hakiyaIconAsset.url}
        alt=""
        aria-hidden
        onError={avatarUrl ? () => setBrokenUrl(avatarUrl) : undefined}
        className={cn(
          "h-full w-full rounded-full ring-1 ring-border",
          // A photo or a woven medallion fills the disc; the mark is artwork
          // with its own margins, so cropping it to a circle would cut it.
          avatarUrl ? "object-cover" : "object-contain",
        )}
        draggable={false}
      />
    </Link>
  );
}
