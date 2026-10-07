import { useEffect, useRef } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { DialectModule } from "@/contexts/DialectContext";
import type { DanceDefinition } from "@/lib/dances";
import { useDanceMusic } from "@/hooks/useDanceMusic";
import { TIER_DURATION_MS, type CelebrationTier, type Cheer } from "@/lib/celebrations";
import { CelebrationScene } from "./CelebrationScene";

/**
 * A milestone celebration over the whole screen. It plays for its tier's
 * length and gets out of the way by itself; Continue, Escape or a tap outside
 * the stage end it sooner. It is a real dialog (focus moves to Continue and
 * comes back), because for those few seconds it is the only thing on screen.
 */

interface CelebrationOverlayProps {
  open: boolean;
  dance: DanceDefinition | null;
  dialect: DialectModule;
  tier: CelebrationTier;
  cheer: Cheer;
  /** "Lesson complete!": on the stage, and the dialog's name. */
  title: string;
  /** "You finished “At the souq”." */
  subtitle: string;
  /** Moments that joined this one while it was up, one line each. */
  extras?: readonly string[];
  /**
   * Changes when the screen gains something new to read (an extra line), so
   * the clock starts over rather than taking it away half-read.
   */
  clockKey?: number;
  /** The dance's music loop, or null to dance in silence (src/lib/danceMusic.ts). */
  music?: string | null;
  onClose: () => void;
}

export function CelebrationOverlay({
  open,
  dance,
  dialect,
  tier,
  cheer,
  title,
  subtitle,
  extras = [],
  clockKey = 0,
  music = null,
  onClose,
}: CelebrationOverlayProps) {
  const musicStarted = useDanceMusic(open ? music : null);
  // The page re-renders while the celebration plays (its own save lands, for
  // one); a fresh onClose must not restart the clock.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => closeRef.current(), TIER_DURATION_MS[tier]);
    return () => window.clearTimeout(id);
  }, [open, tier, clockKey]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-[#1A1C17]/92 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          data-testid="celebration"
          className="fixed inset-0 z-[91] flex flex-col items-center justify-center gap-3 overflow-y-auto p-4 outline-none"
          onClick={(e) => {
            // A tap on the backdrop around the stage ends it, like the overlay.
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <CelebrationScene
            dance={dance}
            dialect={dialect}
            tier={tier}
            cheer={cheer.ar}
            headline={title}
            running={musicStarted}
          />
          <div className="w-[min(92vw,60vh,440px)] text-center text-[#F7F1E3]">
            <p className="text-xs text-[#E2B65C]">
              <span lang="ar" dir="rtl" className="sr-only">
                {cheer.ar}{" "}
              </span>
              <span className="italic">{cheer.translit}</span> · {cheer.en}
            </p>
            <DialogPrimitive.Description className="mt-1 text-sm">{subtitle}</DialogPrimitive.Description>
            {extras.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-sm font-medium">
                {extras.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>
          <DialogPrimitive.Close className="rounded-[4px] border border-[#F7F1E3] px-5 py-2 text-sm font-medium text-[#F7F1E3] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E2B65C]">
            Continue
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
