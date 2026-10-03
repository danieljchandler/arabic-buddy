import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { InkWaveform } from "./InkWaveform";

/** A short voice, short enough to show whole beside the words on a phone. */
const VOICE = [40, 70, 100, 60, 85, 45, 75, 55, 30];

/**
 * The chooser's Review bar in the Ink direction.
 *
 * Same job and same words as the default bar — it leads with the count,
 * because "12 waiting" is a reason to tap and "Review" alone is not — set as
 * an editorial strip: the count as a big mustard numeral, "Review" in the
 * serif, a faint voice running out to a cream arrow key. An oxblood panel
 * with the sadu pressed into it, fixed rather than token-coloured, so it is
 * the same dark panel in both themes.
 */
export function InkReviewBar({ due }: { due: number }) {
  return (
    <Link
      to="/review"
      data-ink-sadu=""
      className="flex items-center gap-3.5 rounded-[4px] bg-[#6B1F1F] px-4 py-3 text-[#EFE6CF] transition-transform active:scale-[0.99]"
    >
      <span className="font-ink-serif text-[48px] leading-none tabular-nums text-[#E2B65C]">{due}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-ink-serif text-2xl leading-tight">Review</span>
        <span className="text-[12.5px] leading-snug text-[#D5BEAC]">
          {due > 0 ? `${due} ${due === 1 ? "card" : "cards"} ready now` : "Nothing due — you are caught up"}
        </span>
      </span>
      <InkWaveform
        bars={VOICE}
        className="ml-auto hidden h-6 min-w-0 flex-1 justify-end text-[#EFE6CF]/40 min-[380px]:flex"
      />
      <span
        aria-hidden="true"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-[4px] bg-[#EFE6CF] text-[#6B1F1F]"
      >
        <ArrowRight className="h-5 w-5" />
      </span>
    </Link>
  );
}
