/**
 * The production logo files HikayaInkMark draws (src/assets/brand), indexed
 * by variant, vowelling and kind, each with its night-mode `-reverse` twin.
 * Its own module so the component file exports only the component.
 */
import type { InkMarkVariant } from "@/lib/brandPreview";
import saduHarakatMark from "@/assets/brand/hikaya-sadu-harakat-mark.svg";
import saduHarakatMarkReverse from "@/assets/brand/hikaya-sadu-harakat-mark-reverse.svg";
import saduHarakatLockup from "@/assets/brand/hikaya-sadu-harakat-lockup.svg";
import saduHarakatLockupReverse from "@/assets/brand/hikaya-sadu-harakat-lockup-reverse.svg";
import saduPlainMark from "@/assets/brand/hikaya-sadu-plain-mark.svg";
import saduPlainMarkReverse from "@/assets/brand/hikaya-sadu-plain-mark-reverse.svg";
import saduPlainLockup from "@/assets/brand/hikaya-sadu-plain-lockup.svg";
import saduPlainLockupReverse from "@/assets/brand/hikaya-sadu-plain-lockup-reverse.svg";
import cleanHarakatMark from "@/assets/brand/hikaya-clean-harakat-mark.svg";
import cleanHarakatMarkReverse from "@/assets/brand/hikaya-clean-harakat-mark-reverse.svg";
import cleanHarakatLockup from "@/assets/brand/hikaya-clean-harakat-lockup.svg";
import cleanHarakatLockupReverse from "@/assets/brand/hikaya-clean-harakat-lockup-reverse.svg";
import cleanPlainMark from "@/assets/brand/hikaya-clean-plain-mark.svg";
import cleanPlainMarkReverse from "@/assets/brand/hikaya-clean-plain-mark-reverse.svg";
import cleanPlainLockup from "@/assets/brand/hikaya-clean-plain-lockup.svg";
import cleanPlainLockupReverse from "@/assets/brand/hikaya-clean-plain-lockup-reverse.svg";

type Art = { light: string; reverse: string };
export type InkMarkKind = "mark" | "lockup";

/** Every file in the set this component can show, by variant and vowelling. */
export const INK_MARK_ART: Record<InkMarkVariant, Record<"harakat" | "plain", Record<InkMarkKind, Art>>> = {
  sadu: {
    harakat: {
      mark: { light: saduHarakatMark, reverse: saduHarakatMarkReverse },
      lockup: { light: saduHarakatLockup, reverse: saduHarakatLockupReverse },
    },
    plain: {
      mark: { light: saduPlainMark, reverse: saduPlainMarkReverse },
      lockup: { light: saduPlainLockup, reverse: saduPlainLockupReverse },
    },
  },
  clean: {
    harakat: {
      mark: { light: cleanHarakatMark, reverse: cleanHarakatMarkReverse },
      lockup: { light: cleanHarakatLockup, reverse: cleanHarakatLockupReverse },
    },
    plain: {
      mark: { light: cleanPlainMark, reverse: cleanPlainMarkReverse },
      lockup: { light: cleanPlainLockup, reverse: cleanPlainLockupReverse },
    },
  },
};

/** Width over height of each artboard (the SVGs' viewBoxes). */
export const INK_MARK_ASPECT: Record<InkMarkKind, number> = {
  mark: 272.96 / 90,
  lockup: 251.84 / 100.22,
};
