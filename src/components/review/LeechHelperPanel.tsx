import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Brain, RefreshCw, AlertTriangle, X } from "lucide-react";
import { MnemonicImagePanel } from "./MnemonicImagePanel";


/**
 * Which deck the leech lives in.
 *
 * "word"/"phrase" are the two decks a learner builds themselves. "curriculum"
 * is the deck the app hands them — the structured material everyone works
 * through — which had no rescue at all until now: a learner failing a
 * curriculum word for the seventh time got no mnemonic, no flag, and no way to
 * reset the count, while their own saved words got all three.
 */
export type LeechKind = "word" | "phrase" | "curriculum";

interface LeechHelperPanelProps {
  /** Which deck the row belongs to — controls the table written to. */
  kind: LeechKind;
  rowId: string;
  /** Arabic text to memorize. */
  arabic: string;
  /** English meaning. */
  english: string;
  transliteration?: string | null;
  dialect: string;
  mnemonic: string | null;
  /** The picture drawn from that mnemonic, if the learner has asked for one. */
  mnemonicImageUrl?: string | null;
  /** Invalidate which query keys after save. */
  invalidateKeys?: string[][];
}

const TABLE_BY_KIND: Record<LeechKind, "user_vocabulary" | "user_phrases" | "word_reviews"> = {
  word: "user_vocabulary",
  phrase: "user_phrases",
  // The per-user row for a curriculum word. The mnemonic goes here rather than
  // on vocabulary_words because a memory hook is personal, not content —
  // vocabulary_words is shared by every learner.
  curriculum: "word_reviews",
};

/** Only the two word decks carry a second, production-direction lapse counter. */
const HAS_PRODUCTION_LAPSES: Record<LeechKind, boolean> = {
  word: true,
  phrase: false,
  curriculum: true,
};

export function LeechHelperPanel({
  kind,
  rowId,
  arabic,
  english,
  transliteration,
  dialect,
  mnemonic: initialMnemonic,
  mnemonicImageUrl: initialMnemonicImageUrl = null,
  invalidateKeys = [],
}: LeechHelperPanelProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [mnemonic, setMnemonic] = useState<string | null>(initialMnemonic);
  const [mnemonicImageUrl, setMnemonicImageUrl] = useState<string | null>(
    initialMnemonicImageUrl,
  );
  const [mnLoading, setMnLoading] = useState(false);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    setMnemonic(initialMnemonic);
    setMnemonicImageUrl(initialMnemonicImageUrl);
  }, [rowId, initialMnemonic, initialMnemonicImageUrl]);

  // A new card is a fresh question, so a dismissal never carries over: the
  // parents render one panel and swap the row underneath it rather than
  // remounting, so without this the next leech would come up already hidden.
  useEffect(() => {
    setCleared(false);
  }, [rowId]);

  const invalidate = () => {
    invalidateKeys.forEach((key) =>
      queryClient.invalidateQueries({ queryKey: key }),
    );
  };

  /**
   * Write to whichever of the three decks this card came from.
   *
   * The cast is the price of one component serving three tables: the union of
   * their Update types has no common member, so `.update()` types to `never`.
   * It lives here once rather than at each of the three call sites, which also
   * keeps every write on the same `.eq("id", rowId)` — a leech write that lost
   * its filter would rewrite the learner's whole deck.
   */
  const updateRow = (payload: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from(TABLE_BY_KIND[kind]) as any).update(payload).eq("id", rowId);


  const generateMnemonic = async () => {
    setMnLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-mnemonic", {
        body: {
          arabic,
          english,
          transliteration,
          dialect,
          // The function interpolates this straight into its prompt ("Arabic
          // ${kind}s they keep forgetting"), so it takes the noun, not the deck
          // name — a curriculum card is still a word.
          kind: kind === "phrase" ? "phrase" : "word",
        },
      });
      if (error) throw new Error(error.message || "Failed");
      const text = (data as { mnemonic?: string })?.mnemonic;
      if (!text) throw new Error("Empty mnemonic");
      setMnemonic(text);
      // The picture illustrates the old hook, so it goes with it: leaving it
      // up would show the learner a scene that no longer matches the sentence
      // underneath it, which is exactly the confusion a mnemonic must not add.
      setMnemonicImageUrl(null);
      await updateRow({ mnemonic: text, mnemonic_image_url: null });
      invalidate();
      toast.success("Mnemonic ready!");
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.includes("429")) toast.error("Rate limited — try again shortly");
      else if (msg.includes("402")) toast.error("AI credits exhausted");
      else toast.error("Failed to generate mnemonic");
    } finally {
      setMnLoading(false);
    }
  };


  /** Keep a generated picture on the same row the mnemonic lives on. */
  const persistMnemonicImage = async (imageUrl: string) => {
    const { error } = await updateRow({ mnemonic_image_url: imageUrl });
    // PostgREST reports a rejected write on `error` rather than by throwing,
    // so without this the learner would be shown a picture that is gone on
    // their next review — and charged for it again to get it back.
    if (error) throw new Error(error.message || "Could not save the picture");
    // Held here as well as in the child, so the panel and the row agree even
    // before the refetch lands — and so a regenerated mnemonic has one place
    // to clear the picture from.
    setMnemonicImageUrl(imageUrl);
    invalidate();
  };

  const dismissLeech = async () => {
    try {
      // PostgREST reports a rejected write on the `error` channel rather than
      // by throwing, so without this check a failed clear would still toast
      // success and hide the panel over a row that is still flagged.
      const { error } = await updateRow({
        is_leech: false,
        lapses: 0,
        ...(HAS_PRODUCTION_LAPSES[kind] ? { production_lapses: 0 } : {}),
      });
      if (error) throw error;
      setCleared(true);
      invalidate();
      toast.success("Cleared — we'll stop flagging this card.");
    } catch {
      toast.error("Couldn't clear leech status");
    }
  };

  // The parents decide whether to render this panel from a cached row, and
  // that cache only catches up when the refetch `invalidate` kicks off comes
  // back — mid-review it may not come back at all. Hiding on the spot is what
  // makes the dismissal read as one; otherwise the learner clears the flag and
  // the "Stuck on this one?" prompt they just dismissed is still sitting there.
  if (cleared) return null;

  return (
    <div className="mt-6 rounded-xl border border-[hsl(var(--primary))]/40 bg-[hsl(var(--primary))]/5 p-4 text-left">
      <div className="flex items-start gap-2 mb-3">
        <AlertTriangle className="h-4 w-4 text-[hsl(var(--primary))] mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--primary))]">
            Stuck on this one?
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            You've missed it a few times. Let AI help you lock it in.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={dismissLeech}
          title="Not stuck — clear leech flag"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Mnemonic */}
      {mnemonic ? (
        <div className="mb-3 rounded-lg bg-card border border-border p-3">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1">
              <Brain className="h-3 w-3" /> Mnemonic
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={generateMnemonic}
              disabled={mnLoading}
              title="Regenerate mnemonic"
            >
              {mnLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            </Button>
          </div>
          <p className="text-sm text-foreground leading-relaxed">{mnemonic}</p>

          {/* A hook the learner can see, not only read. */}
          <MnemonicImagePanel
            cardKey={rowId}
            mnemonic={mnemonic}
            arabic={arabic}
            english={english}
            imageUrl={mnemonicImageUrl}
            onPersist={persistMnemonicImage}
          />
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="w-full mb-2 gap-1.5"
          onClick={generateMnemonic}
          disabled={mnLoading}
        >
          {mnLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
          {mnLoading ? "Crafting mnemonic..." : "Generate AI mnemonic"}
        </Button>
      )}
    </div>
  );
}

