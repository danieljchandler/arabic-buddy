import { useSyncExternalStore } from "react";
import {
  DEFAULT_INK_MARK,
  getActiveBrand,
  getMarkVariant,
  subscribeBrandPreview,
  type BrandPreviewState,
  type InkMarkVariant,
} from "@/lib/brandPreview";

/**
 * The brand being rendered (src/lib/brandPreview.ts), as React state.
 *
 * The token layer re-skins every page from CSS alone, but a few components
 * have to render something else under a direction — Ink's type-led tiles and
 * redrawn mark instead of the watercolour art and the raster logo. They read
 * the active brand through this: an explicit `?brand=` preview if someone
 * asked for one, otherwise the default index.html declares (Ink), otherwise
 * `"current"`, the previous look. They re-render the moment the switcher
 * flips it.
 */
export function useBrandPreview(): BrandPreviewState {
  return useSyncExternalStore(subscribeBrandPreview, getActiveBrand, getActiveBrand);
}

/** True while Ink is the brand being rendered — by default, or by preview. */
export function useIsInk(): boolean {
  return useBrandPreview() === "ink";
}

/** Which of Ink's two marks to draw (`?mark=sadu|clean`, default sadu). */
export function useInkMarkVariant(): InkMarkVariant {
  return useSyncExternalStore(subscribeBrandPreview, getMarkVariant, () => DEFAULT_INK_MARK);
}
