import { useCallback, useEffect, useRef, useState } from "react";
import { useDialect, type DialectModule } from "@/contexts/DialectContext";
import { useStreakMilestoneCelebration } from "@/hooks/useStreakMilestoneCelebration";
import { playSuccessChime, vibrate } from "@/lib/tapFeedback";
import { danceById, type DanceDefinition } from "@/lib/dances";
import {
  CELEBRATE_PARAM,
  celebrate,
  celebrationCopy,
  celebrationSummary,
  largerTier,
  parseCelebrateParam,
  pickCheer,
  subscribeCelebrations,
  takeNextDance,
  tierFor,
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
import { DANCE_ART } from "./danceArt";

interface Shown {
  id: number;
  event: CelebrationEvent;
  dance: DanceDefinition | null;
  dialect: DialectModule;
  cheer: Cheer;
  tier: CelebrationTier;
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
 * One screen at a time. A second moment that arrives while one is showing
 * joins it as a line ("Badge earned! First Steps") rather than queueing a
 * second dance behind the first: a single rated card can finish the deck and
 * earn two badges at once, and three dances in a row would bury the point.
 */
export function CelebrationHost() {
  const { activeDialect } = useDialect();
  const dialectRef = useRef(activeDialect);
  dialectRef.current = activeDialect;

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
      // A preview names its dance, and plays it for that dance's dialect.
      const named = event.danceId ? danceById(event.danceId) : null;
      const dialect = named?.dialect ?? dialectRef.current;
      playSuccessChime();
      vibrate([12, 40, 12, 40, 24]);
      show({
        id: ++counter,
        event,
        dance: named ?? takeNextDance(dialect),
        dialect,
        cheer: pickCheer(dialect),
        tier: tierFor(event),
        extras: [],
      });
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
    url.searchParams.delete(DANCE_MUSIC_PARAM);
    try {
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch {
      // A sandboxed frame can refuse; the preview still plays.
    }
    if (found) celebrate({ kind: "preview", danceId: found.dance.id, tier: found.tier });
  }, []);

  // After the subscription above, so a milestone already in the query cache
  // at mount has a listener to land on.
  useStreakMilestoneCelebration();

  if (!shown) return null;
  const { title, subtitle } = celebrationCopy(shown.event);
  const music =
    shown.dance && shouldPlayDanceMusic(shown.event.kind === "preview")
      ? (DANCE_ART[shown.dance.id]?.music ?? null)
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
      onClose={() => show(null)}
    />
  );
}
