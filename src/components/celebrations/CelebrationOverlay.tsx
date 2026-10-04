import { useEffect, useRef } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { TIER_DURATION_MS, type CelebrationTier, type DanceDefinition } from "@/lib/celebrations";
import { CelebrationScene } from "./CelebrationScene";

/**
 * A milestone celebration over the whole screen. It plays for its tier's
 * length and gets out of the way by itself; Continue, Escape or a tap outside
 * the stage end it sooner. It is a real dialog (focus moves to Continue and
 * comes back), because for those few seconds it is the only thing on screen.
 */

interface CelebrationOverlayProps {
  open: boolean;
  dance: DanceDefinition;
  tier: CelebrationTier;
  headline: string;
  onClose: () => void;
}

export function CelebrationOverlay({ open, dance, tier, headline, onClose }: CelebrationOverlayProps) {
  // The page re-renders while the celebration plays (its own save lands, for
  // one); a fresh onClose must not restart the clock.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => closeRef.current(), TIER_DURATION_MS[tier]);
    return () => window.clearTimeout(id);
  }, [open, tier]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-[#1A1C17]/92 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-[91] flex flex-col items-center justify-center gap-4 p-4 outline-none"
          onClick={(e) => {
            // A tap on the backdrop around the stage ends it, like the overlay.
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <DialogPrimitive.Title className="sr-only">
            {dance.praise} {headline}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {dance.gloss}, a dance from {dance.region}.
          </DialogPrimitive.Description>
          <CelebrationScene dance={dance} tier={tier} headline={headline} />
          <DialogPrimitive.Close
            className="rounded-[4px] border border-[#F7F1E3] px-5 py-2 text-sm font-medium text-[#F7F1E3] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E2B65C]"
          >
            Continue
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
