import { Button } from "@/components/ui/button";
import { BookmarkPlus, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMarkUnknowns } from "@/contexts/MarkUnknownsContext";

interface Props {
  className?: string;
}

/**
 * Toggle button for entering "mark unknowns" mode. When enabled,
 * tapping Arabic words in TappableArabicText (and the inline tappable
 * line in Reading Practice) adds them to a batch instead of opening
 * the translation popover. Bulk-saved via SaveUnknownsBar.
 */
export const MarkUnknownsToggle = ({ className }: Props) => {
  const { enabled, setEnabled, unknowns, clear } = useMarkUnknowns();

  return (
    <Button
      variant={enabled ? "default" : "outline"}
      size="sm"
      className={cn("text-xs gap-1.5", className)}
      onClick={() => {
        if (enabled && unknowns.size === 0) {
          setEnabled(false);
        } else if (enabled) {
          // already marking — leave bar to handle save/cancel
          setEnabled(false);
          clear();
        } else {
          setEnabled(true);
        }
      }}
    >
      {enabled ? (
        <>
          <Check className="h-3.5 w-3.5" />
          Marking
        </>
      ) : (
        <>
          <BookmarkPlus className="h-3.5 w-3.5" />
          Mark unknowns
        </>
      )}
    </Button>
  );
};
