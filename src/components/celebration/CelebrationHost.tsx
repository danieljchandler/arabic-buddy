import { useCallback, useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useDialect } from "@/contexts/DialectContext";
import { Button } from "@/components/ui/button";
import { SparkleBurst } from "@/components/gamification/SparkleBurst";
import { DanceClip } from "@/components/celebration/DanceClip";
import { useStreakMilestoneCelebration } from "@/hooks/useStreakMilestoneCelebration";
import { playSuccessChime, vibrate } from "@/lib/tapFeedback";
import {
  celebrationCopy,
  celebrationSummary,
  pickCheer,
  subscribeCelebrations,
  takeNextScene,
  type CelebrationEvent,
  type Cheer,
  type DanceScene,
} from "@/lib/celebrations";

interface Shown {
  id: number;
  event: CelebrationEvent;
  scene: DanceScene;
  cheer: Cheer;
  /** Moments that landed while this one was up, as one-line summaries. */
  extras: string[];
}

/**
 * The app-wide celebration screen. Mount once, beside the other app chrome in
 * App.tsx; anything that wants a celebration calls `celebrate()` from
 * `@/lib/celebrations` (the lesson finish, a cleared review deck, the day's
 * goal, a badge, and — watched here — a streak milestone).
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
        show({ ...current, extras: [...current.extras, line] });
        return;
      }
      playSuccessChime();
      vibrate([12, 40, 12, 40, 24]);
      show({
        id: ++counter,
        event,
        scene: takeNextScene(dialectRef.current),
        cheer: pickCheer(dialectRef.current),
        extras: [],
      });
    });
  }, [show]);

  // After the subscription above, so a milestone already in the query cache
  // at mount has a listener to land on.
  useStreakMilestoneCelebration();

  if (!shown) return null;
  return <CelebrationScreen shown={shown} onClose={() => show(null)} />;
}

function CelebrationScreen({ shown, onClose }: { shown: Shown; onClose: () => void }) {
  const { scene, cheer, extras } = shown;
  const { title, subtitle } = celebrationCopy(shown.event);
  const continueRef = useRef<HTMLButtonElement>(null);

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-background/85 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          data-testid="celebration"
          // Land on Continue: one tap (or Enter) and the learner is back.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            continueRef.current?.focus();
          }}
          className="fixed inset-0 z-[101] overflow-y-auto focus:outline-none"
        >
          {/* The content box fills the screen so a short phone can scroll the
              card; a click on the empty space around it still dismisses. */}
          <div
            className="flex min-h-full items-center justify-center p-4"
            onClick={(e) => e.target === e.currentTarget && onClose()}
          >
            <div className="relative w-full max-w-sm rounded-[2rem] bg-card p-5 text-center shadow-elegant ring-1 ring-border/60 animate-scale-in">
              <SparkleBurst />
              <DanceClip key={shown.id} scene={scene} className="mx-auto max-w-[42vh]" />

              <p lang="ar" dir="rtl" className="mt-4 font-arabic text-4xl font-bold leading-tight text-primary">
                {cheer.ar}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="italic">{cheer.translit}</span> · {cheer.en}
              </p>

              <DialogPrimitive.Title className="mt-3 text-2xl font-bold text-foreground">
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                {subtitle}
              </DialogPrimitive.Description>
              {extras.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-sm font-medium text-foreground">
                  {extras.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}

              <div className="mt-4 rounded-2xl bg-muted/60 px-4 py-3 text-start">
                <p className="text-sm font-semibold text-foreground">
                  <span lang="ar" dir="rtl" className="font-arabic">
                    {scene.nameAr}
                  </span>
                  {" · "}
                  {scene.nameEn}
                </p>
                <p className="text-xs text-muted-foreground">{scene.region}</p>
                <p className="mt-1 text-xs leading-relaxed text-foreground/80">{scene.blurb}</p>
              </div>

              <Button ref={continueRef} size="lg" className="mt-4 w-full" onClick={onClose}>
                Continue
              </Button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
