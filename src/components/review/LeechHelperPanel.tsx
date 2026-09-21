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
  /**
   * The cached decks this card is served from.
   *
   * Patched in place rather than invalidated. Both review hooks refuse to
   * refetch their deck mid-session for the same reason — the query function
   * rebuilds the array the page is indexing into, so a refetch between two
   * cards silently swaps the card under the learner (useReview.useDueWords
   * and useUserVocabulary.useUpdateUserVocabularyReview both say so). That is
   * doubly wrong here: the row under the panel changes, and the hook that was
   * just saved disappears from the screen as if it had never been written.
   */
  deckKeys?: string[][];
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
  deckKeys = [],
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

  /**
   * Apply a saved patch to the decks already in the cache.
   *
   * A card reaches the panel either as the deck row itself (the two personal
   * decks) or as the `review` hanging off a curriculum word, so both shapes are
   * matched on the id the write used — nothing else can be mistaken for the row
   * that was just written.
   */
  const patchDecks = (patch: Record<string, unknown>) => {
    deckKeys.forEach((key) =>
      queryClient.setQueriesData({ queryKey: key }, (prev: unknown) => {
        if (!Array.isArray(prev)) return prev;
        let changed = false;
        const next = prev.map((row) => {
          if (!row || typeof row !== "object") return row;
          const card = row as { id?: string; review?: { id?: string } | null };
          if (card.id === rowId) {
            changed = true;
            return { ...card, ...patch };
          }
          if (card.review && card.review.id === rowId) {
            changed = true;
            return { ...card, review: { ...card.review, ...patch } };
          }
          return row;
        });
        return changed ? next : prev;
      }),
    );
  };

  /**
   * Write to whichever of the three decks this card came from, and confirm the
   * row actually changed.
   *
   * Two things make a leech write fail in silence, and this panel used to fall
   * for both. PostgREST reports a rejected write on the `error` channel rather
   * than by throwing; and a write whose filter matches nothing — a row the
   * policy will not hand over, an id that no longer exists — comes back 200
   * with no error at all, exactly as the curriculum image save does for a
   * learner who is not an admin (see Review.tsx). Either way the panel toasted
   * success, kept showing the hook it had just generated, and the learner met
   * the same bare card the next day, having paid for a mnemonic the database
   * never received. `.select("id")` is what turns both into a real failure:
   * a write that changed no row returns an empty list.
   *
   * The cast is the price of one component serving three tables: the union of
   * their Update types has no common member, so `.update()` types to `never`.
   * It lives here once rather than at each of the three call sites, which also
   * keeps every write on the same `.eq("id", rowId)` — a leech write that lost
   * its filter would rewrite the learner's whole deck.
   */
  const updateRow = async (payload: Record<string, unknown>) => {
    const { data, error } = await (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from(TABLE_BY_KIND[kind]) as any)
        .update(payload)
        .eq("id", rowId)
        .select("id")
    );
    if (error) throw new Error(error.message || "The card could not be saved");
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("That card could not be updated, so nothing was saved");
    }
    patchDecks(payload);
  };


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
      // Shown either way — the generation is already paid for and the hook is
      // useful for this card right now — but a save that did not land is said
      // so plainly, because "Mnemonic ready!" over an unwritten row is how a
      // learner ends up generating the same hook every day.
      try {
        await updateRow({ mnemonic: text, mnemonic_image_url: null });
      } catch (saveErr) {
        toast.error(
          saveErr instanceof Error && saveErr.message
            ? `Mnemonic couldn't be saved: ${saveErr.message}`
            : "Mnemonic couldn't be saved — it won't be here next time",
        );
        return;
      }
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


  /**
   * Keep a generated picture on the same row the mnemonic lives on.
   *
   * `updateRow` throws when the write is refused or changes nothing, and the
   * image panel awaits this before it shows the picture — so a picture the
   * learner can see is a picture the database has. Without that the learner
   * would be shown one that is gone on their next review, and charged for it
   * again to get it back.
   */
  const persistMnemonicImage = async (imageUrl: string) => {
    await updateRow({ mnemonic_image_url: imageUrl });
    // Held here as well as in the child so the panel and the row agree, and so
    // a regenerated mnemonic has one place to clear the picture from.
    setMnemonicImageUrl(imageUrl);
  };

  const dismissLeech = async () => {
    try {
      // `updateRow` throws when the clear is refused or matches no row, so a
      // failed clear can no longer toast success and hide the panel over a row
      // that is still flagged.
      await updateRow({
        is_leech: false,
        lapses: 0,
        ...(HAS_PRODUCTION_LAPSES[kind] ? { production_lapses: 0 } : {}),
      });
      setCleared(true);
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

