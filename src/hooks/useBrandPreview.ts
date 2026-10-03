import { useSyncExternalStore } from "react";
import {
  DEFAULT_INK_MARK,
  getBrandPreview,
  getMarkVariant,
  subscribeBrandPreview,
  type BrandPreviewState,
  type InkMarkVariant,
} from "@/lib/brandPreview";

/**
 * The opt-in brand preview (src/lib/brandPreview.ts), as React state.
 *
 * The token layer re-skins every page from CSS alone, but a few components
 * have to render something else under a direction — Ink's type-led tiles and
 * redrawn mark instead of the watercolour art and the raster logo. They read
 * the preview through this, so they re-render the moment the switcher flips
 * it, and for anyone who never opened a `?brand=` link it is `null` and the
 * default branch is the only one that ever runs.
 *
 * The server snapshot is `null` / the default mark: no preview is the
 * default look.
 */
export function useBrandPreview(): BrandPreviewState | null {
  return useSyncExternalStore(subscribeBrandPreview, getBrandPreview, () => null);
}

/** True only while the Ink direction is the one being previewed. */
export function useIsInk(): boolean {
  return useBrandPreview() === "ink";
}

/** Which of Ink's two marks to draw (`?mark=sadu|clean`, default sadu). */
export function useInkMarkVariant(): InkMarkVariant {
  return useSyncExternalStore(subscribeBrandPreview, getMarkVariant, () => DEFAULT_INK_MARK);
}
