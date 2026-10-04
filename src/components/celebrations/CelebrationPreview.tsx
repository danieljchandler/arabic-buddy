import { useEffect, useState } from "react";
import { CELEBRATE_PARAM, parseCelebrateParam, type CelebrationTier, type DanceDefinition } from "@/lib/celebrations";
import { CelebrationOverlay } from "./CelebrationOverlay";

/**
 * Plays a celebration named in the address (`?celebrate=ardah`, or
 * `?celebrate=ardah-large`) once, then takes the parameter out of the address
 * so a reload doesn't replay it. A lesson only celebrates the first time it is
 * finished, so without this a scene could be seen once per lesson, ever.
 */
export function CelebrationPreview() {
  const [preview, setPreview] = useState<{ dance: DanceDefinition; tier: CelebrationTier } | null>(null);

  useEffect(() => {
    const found = parseCelebrateParam(window.location.search);
    if (!found) return;
    setPreview(found);
    const url = new URL(window.location.href);
    url.searchParams.delete(CELEBRATE_PARAM);
    try {
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch {
      // A sandboxed frame can refuse; the preview still plays.
    }
  }, []);

  if (!preview) return null;
  return (
    <CelebrationOverlay
      open
      dance={preview.dance}
      tier={preview.tier}
      headline="Preview"
      onClose={() => setPreview(null)}
    />
  );
}
