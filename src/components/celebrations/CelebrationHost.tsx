import { useCallback, useEffect, useRef, useState } from "react";
import { useDialect, type DialectModule } from "@/contexts/DialectContext";
import { useStreakMilestoneCelebration } from "@/hooks/useStreakMilestoneCelebration";
import { useCelebrationSong } from "@/hooks/useCelebrationSong";
import { playSuccessChime, vibrate } from "@/lib/tapFeedback";
import type { DanceDefinition } from "@/lib/dances";
import {
  CELEBRATE_BADGE_PARAM,
  CELEBRATE_DAYS_PARAM,
  CELEBRATE_PARAM,
  celebrate,
  celebrationCopy,
  celebrationSummary,
  largerTier,
  parseCelebrateParam,
  pickSceneCheer,
  previewBadge,
  previewScene,
  subscribeCelebrations,
  takeScene,
  tierFor,
  type CelebrationBadge,
  type CelebrationEvent,
  type CelebrationTier,
  type Cheer,
} from "@/lib/celebrations";
import {
  DANCE_MUSIC_PARAM,
  parseDanceMusicParam,
  setDanceMusicTestOn,
  shouldPlayDanceMusic,
} from "@/lib/danceMusic";
import { CelebrationOverlay } from "./CelebrationOverlay";
import { artFor } from "./danceArt";

interface Shown {
  id: number;
  event: CelebrationEvent;
  dance: DanceDefinition | null;
  dialect: DialectModule;
  cheer: Cheer;
  tier: CelebrationTier;
  /** The badge the first moment was for, when it was a badge. */
  badge?: CelebrationBadge;
  /** Moments that landed while this one was up, as one-line summaries. */
  extras: string[];
}

/**
 * The app-wide celebration screen. Mount once, ahead of the routes in
 * App.tsx; anything that wants a celebration calls `celebrate()` from
 * `@/lib/celebrations` (a lesson's first finish, a letter learned, a cleared
 * review deck, the day's goal, a badge, and, watched here, a streak
 * milestone). It also plays the `?celebrate=` preview link.
 *
 * A badge is on the screen as a sticker and, once, in a song about it: the
 * first badge of a screen is sung (a second one that folds in is a line), and
 * never over a song that is already playing.
 *
 * What it plays is `takeScene`'s choice (a dance, or a vignette that suits the
 * moment; a streak is always its dialect's ladder).
 *
 * One screen at a time. A second moment that arrives while one is showing
 * joins it as a line ("Badge earned! First Steps") rather than queueing a
 * second dance behind the first: a single rated card can finish the deck and
 * earn two badges at once, and three dances in a row would bury the point.
 */
export function CelebrationHost() {
  const { activeDialect } = useDialect();
  const dialectRef = useRef(activeDialect);
  dialectRef.current = activeDialect;

  // The latest `sing`, so the subscription below (made once) never holds a
  // stale name or dialect.
  const sing = useCelebrationSong();
  const singRef = useRef(sing);
  singRef.current = sing;

  const shownRef = useRef<Shown | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const show = useCallback((next: Shown | null) => {
    shownRef.current = next;
    setShown(next);
  }, []);

  useEffect(() => {
    let counter = 0;
    return subscribeCelebrations((event) => {
      const current = shownRef.current;
      if (current) {
        const line = celebrationSummary(event);
        if (line === celebrationSummary(current.event) || current.extras.includes(line)) return;
        show({ ...current, tier: largerTier(current.tier, tierFor(event)), extras: [...current.extras, line] });
        return;
      }
      // A preview names its scene, and plays a dance for its own region and
      // a vignette for the learner's dialect when it is made for it.
      const named = event.danceId ? previewScene(event.danceId, dialectRef.current, event.days) : null;
      const dialect = named?.dialect ?? dialectRef.current;
      const scene = named?.scene ?? takeScene(event, dialect);
      playSuccessChime();
      vibrate([12, 40, 12, 40, 24]);
      show({
        id: ++counter,
        event,
        dance: scene,
        dialect,
        cheer: pickSceneCheer(scene, dialect),
        tier: tierFor(event),
        badge: event.badge,
        extras: [],
      });
      // A badge earned is sung about, once; a previewed one never is.
      if (event.kind === "achievement" && event.badge) {
        void singRef.current({ kind: "badge_earned", entityId: event.badge.id }, { onlyIfQuiet: true });
      }
    });
  }, [show]);

  // The preview link and the dance-music test switch, once, after the
  // subscription above so a preview has a listener. Both parameters come out
  // of the address so a reload doesn't replay them.
  useEffect(() => {
    const search = window.location.search;
    const found = parseCelebrateParam(search);
    const musicSwitch = parseDanceMusicParam(search);
    if (!found && musicSwitch === null) return;
    if (musicSwitch !== null) setDanceMusicTestOn(musicSwitch);
    const url = new URL(window.location.href);
    url.searchParams.delete(CELEBRATE_PARAM);
    url.searchParams.delete(CELEBRATE_DAYS_PARAM);
    url.searchParams.delete(CELEBRATE_BADGE_PARAM);
    url.searchParams.delete(DANCE_MUSIC_PARAM);
    try {
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch {
      // A sandboxed frame can refuse; the preview still plays.
    }
    if (found) {
      celebrate({
        kind: "preview",
        danceId: found.dance.id,
        tier: found.tier,
        days: found.days,
        badge: found.badge ? previewBadge(found.badge) : undefined,
      });
    }
  }, []);

  // After the subscription above, so a milestone already in the query cache
  // at mount has a listener to land on.
  useStreakMilestoneCelebration();

  if (!shown) return null;
  const { title, subtitle } = celebrationCopy(shown.event);
  const music =
    shown.dance && shouldPlayDanceMusic(shown.event.kind === "preview")
      ? (artFor(shown.dance.id)?.music ?? null)
      : null;
  return (
    <CelebrationOverlay
      key={shown.id}
      open
      dance={shown.dance}
      dialect={shown.dialect}
      tier={shown.tier}
      cheer={shown.cheer}
      title={title}
      subtitle={subtitle}
      extras={shown.extras}
      clockKey={shown.extras.length}
      music={music}
      badge={shown.badge}
      onClose={() => show(null)}
    />
  );
}
