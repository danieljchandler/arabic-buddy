import { useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useProfileAvatar } from "@/hooks/useProfileAvatar";
import { SaduMark } from "@/components/brand/SaduMark";

/**
 * Your face, as the way into your profile.
 *
 * It shows the picture you chose. That was the point of choosing one: an
 * avatar that only ever appears on the profile page and the leaderboard is a
 * setting, not an identity.
 *
 * Where it sits depends on the screen. On the feed it rides the action rail on
 * the right, above the verbs, because the top-left corner belongs to the
 * Hakiya mark — the brand was there first and a corner can only say one thing.
 * On the chooser and a skill it takes the right end of the header, opposite
 * the mark. On the interior pages it is still the corner control, because
 * those pages carry no mark and have nothing to displace.
 *
 * The mark stays as the fallback, for a visitor who is signed out and for an
 * account that has not picked a picture yet — better a mark than an empty grey
 * disc, and it keeps the slot looking like something rather than like a
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
  return <ProfileEmblemView avatarUrl={data?.avatarUrl ?? null} hasNews={hasNews} className={className} />;
}

/**
 * The same emblem, handed its picture rather than fetching one.
 *
 * The feed needs this. Its rail lives inside `Clip`, and every clip in the
 * list is mounted at once — so a self-fetching emblem there would be a dozen
 * copies of `useAuth`, each with its own auth subscription and its own
 * `identify()` call, to render one person's face a dozen times. The feed reads
 * the picture once and passes it down instead.
 */
export function ProfileEmblemView({
  avatarUrl,
  hasNews = false,
  className,
}: {
  avatarUrl: string | null;
  hasNews?: boolean;
  className?: string;
}) {
  /**
   * A picture that 404s falls back to the mark rather than to a broken image.
   * Tracked by URL, not as a boolean, so picking a new avatar after a bad one
   * is given its own chance to load.
   */
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const src = avatarUrl && avatarUrl !== brokenUrl ? avatarUrl : null;

  return (
    <Link
      to="/me"
      data-tour="emblem"
      aria-label={hasNews ? "Your account — something new is waiting" : "Your account"}
      className={cn(
        "relative grid h-10 w-10 shrink-0 place-items-center rounded-full",
        "transition-transform active:scale-[0.98]",
        className,
      )}
    >
      {hasNews && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full ring-2 ring-primary ring-offset-2 ring-offset-transparent"
        />
      )}
      {src ? (
        <img
          src={src}
          alt=""
          aria-hidden
          onError={() => setBrokenUrl(src)}
          className="h-full w-full rounded-full object-cover ring-1 ring-border"
          draggable={false}
        />
      ) : (
        // The mark used to be dropped into this slot as bare artwork, which
        // meant padding it, giving it a background and ringing it — three CSS
        // properties standing in for the plate it did not have. The framed
        // mark is already a disc with its own edge, so all of that goes, and
        // the fallback stops looking like a picture that failed to fill.
        <SaduMark className="h-full w-full" />
      )}
    </Link>
  );
}
