import { BadgeCheck } from "lucide-react";
import { TappableArabicText } from "@/components/shared/TappableArabicText";
import type { NativeReviewFrame } from "../../../supabase/functions/_shared/arabicReviewCore";

interface NativeReviewNoteProps {
  review: NativeReviewFrame;
}

/** `humain/humain-m3` → `humain-m3`. The vendor prefix is routing, not provenance. */
function judgeName(model: string): string {
  return model.split("/").pop() ?? model;
}

const KIND_LABEL: Record<NativeReviewFrame["corrections"][number]["kind"], string> = {
  msa: "MSA, not spoken",
  dialect: "wrong dialect",
};

/**
 * What an Arabic-native model would have said instead, shown under the reply it
 * read.
 *
 * Deliberately a note and not a correction to the text above it. The learner
 * has already read that text; silently rewriting it after the fact would make
 * the assistant appear to have said something it did not, and the one thing a
 * tutor cannot afford is for a learner to doubt what they saw. It also keeps
 * the judgment falsifiable — both readings are on screen, attributed, and a
 * learner who knows better can see that the reviewer is the one that is wrong.
 */
export function NativeReviewNote({ review }: NativeReviewNoteProps) {
  if (review.corrections.length === 0) return null;

  return (
    <div
      className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2"
      data-testid="native-review-note"
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
        <BadgeCheck className="h-3 w-3" />
        A native speaker would say
      </div>

      <ul className="mt-1.5 space-y-1.5">
        {review.corrections.map((correction, i) => (
          <li key={i} className="text-xs">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-muted-foreground line-through" dir="rtl" lang="ar">
                {correction.arabic}
              </span>
              <span aria-hidden className="text-muted-foreground">
                →
              </span>
              <TappableArabicText
                text={correction.suggestion}
                source="ask-ai-review"
                inline
              />
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {correction.note || KIND_LABEL[correction.kind]}
            </p>
          </li>
        ))}
      </ul>

      <p className="mt-1.5 text-[10px] text-muted-foreground">
        Checked by {judgeName(review.model)}. A second opinion, not a correction — the
        answer above is unchanged.
      </p>
    </div>
  );
}
