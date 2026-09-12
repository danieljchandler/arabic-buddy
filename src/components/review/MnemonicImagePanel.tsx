import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { showCapToastIfLimited } from "@/lib/handleCapResponse";
import { ImagePlus, Loader2, RefreshCw, SlidersHorizontal } from "lucide-react";

/**
 * The picture half of a mnemonic.
 *
 * The text hook is only half of the technique it implements: the keyword
 * method works because the learner *sees* the absurd scene, and a learner who
 * cannot picture it from prose gets none of the benefit. So the panel offers
 * to draw it — and, more importantly, to redraw it, because the first attempt
 * routinely illustrates the pun and drops the meaning, and an image the
 * learner cannot read their word off is worse than none.
 *
 * "Adjust" is therefore not a nicety bolted on after generation; it is the
 * same control the word illustrator (`GenerateImageDialog`) offers, in the
 * shape this surface can afford — the leech panel appears mid-review, under a
 * card the learner is in the middle of failing, so it stays inline rather than
 * opening a dialog over the review they are part-way through.
 */

interface MnemonicImagePanelProps {
  /** The card this picture belongs to — an adjustment never outlives it. */
  cardKey: string;
  /** The hook to illustrate. The panel renders nothing without one. */
  mnemonic: string;
  arabic: string;
  english: string;
  /** The picture already stored against this card, if any. */
  imageUrl: string | null;
  /** Persist a freshly generated URL onto the card's row. Awaited. */
  onPersist: (imageUrl: string) => Promise<void>;
}

export function MnemonicImagePanel({
  cardKey,
  mnemonic,
  arabic,
  english,
  imageUrl: initialImageUrl,
  onPersist,
}: MnemonicImagePanelProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(initialImageUrl);
  const [loading, setLoading] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [instructions, setInstructions] = useState("");

  // The review screens swap the card under one mounted panel rather than
  // remounting it, so without this the previous word's picture would sit over
  // the next word's mnemonic. It follows the stored URL rather than the card
  // alone because regenerating the mnemonic clears the picture it illustrated.
  useEffect(() => {
    setImageUrl(initialImageUrl);
  }, [initialImageUrl]);

  // The adjustment is about *this* card, so it is cleared by a new card and by
  // nothing else — in particular not by the panel's own save, which comes back
  // as a changed `imageUrl` prop and would otherwise wipe the note that
  // produced the picture the learner is looking at.
  useEffect(() => {
    setAdjusting(false);
    setInstructions("");
  }, [cardKey]);

  const generate = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-mnemonic-image", {
        body: {
          mnemonic,
          word_arabic: arabic,
          word_english: english,
          custom_instructions: instructions.trim() || undefined,
        },
      });

      if (showCapToastIfLimited(error, data)) return;
      if (error) throw error;
      const url = (data as { imageUrl?: string; fallback?: boolean; message?: string })?.imageUrl;
      if ((data as { fallback?: boolean })?.fallback || !url) {
        throw new Error(
          (data as { message?: string })?.message ||
            "Picture generation is temporarily unavailable. Please try again.",
        );
      }

      // Cache-busted: a regeneration can land on the same storage path, and the
      // browser would otherwise keep showing the picture the learner rejected.
      const busted = `${url}?t=${Date.now()}`;
      // Awaited, so a failed save reaches the catch — a picture that was
      // generated but not kept must not toast as if it were.
      await onPersist(busted);
      setImageUrl(busted);
      // The adjustment box stays open with what it said. Closing it would hide
      // instructions that are still in force — the next redraw would apply
      // them again with nothing on screen to say so.
      toast.success("Picture ready!");
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to generate picture");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-2.5 border-t border-border pt-2.5">
      {imageUrl && (
        <img
          src={imageUrl}
          alt={`Mnemonic picture for ${english}`}
          className="w-full max-h-56 object-contain rounded-lg border border-border bg-muted/30 mb-2"
        />
      )}

      <div className="flex items-center gap-2">
        <Button
          variant={imageUrl ? "ghost" : "outline"}
          size="sm"
          className="flex-1 gap-1.5 text-xs"
          onClick={generate}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : imageUrl ? (
            <RefreshCw className="h-3.5 w-3.5" />
          ) : (
            <ImagePlus className="h-3.5 w-3.5" />
          )}
          {loading ? "Drawing it..." : imageUrl ? "Redraw picture" : "Picture this mnemonic"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => setAdjusting((open) => !open)}
          disabled={loading}
          aria-expanded={adjusting}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Adjust
        </Button>
      </div>

      {adjusting && (
        <Textarea
          className="mt-2 text-xs"
          rows={2}
          placeholder="e.g. make it a cartoon, put the mat in a desert doorway..."
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          disabled={loading}
          aria-label="Adjust the picture"
        />
      )}
    </div>
  );
}
