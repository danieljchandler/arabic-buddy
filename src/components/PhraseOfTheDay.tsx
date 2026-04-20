import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDialect } from "@/contexts/DialectContext";
import { useAuth } from "@/hooks/useAuth";
import { useAddUserPhrase } from "@/hooks/useUserPhrases";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, BookmarkPlus, RefreshCw, Check, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface PhraseData {
  phrase_arabic: string;
  phrase_english: string;
  transliteration: string;
  notes: string;
  dialect: string;
  date: string;
}

const cacheKey = (dialect: string, date: string) => `phraseOfDay:${dialect}:${date}`;

export const PhraseOfTheDay = () => {
  const { activeDialect } = useDialect();
  const { isAuthenticated } = useAuth();
  const addPhrase = useAddUserPhrase();

  const [phrase, setPhrase] = useState<PhraseData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showArabic, setShowArabic] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  const fetchPhrase = async (force = false) => {
    setLoading(true);
    setSaved(false);
    setShowArabic(false);
    try {
      if (!force) {
        const cached = localStorage.getItem(cacheKey(activeDialect, today));
        if (cached) {
          setPhrase(JSON.parse(cached));
          setLoading(false);
          return;
        }
      }
      const { data, error } = await supabase.functions.invoke("phrase-of-the-day", {
        body: { dialect: activeDialect, seed: force ? `${today}-${Date.now()}` : today },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setPhrase(data);
      localStorage.setItem(cacheKey(activeDialect, today), JSON.stringify(data));
    } catch (e: any) {
      toast.error(e.message || "Couldn't fetch phrase");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPhrase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDialect]);

  const handleSave = async () => {
    if (!isAuthenticated) {
      toast.error("Please sign in to save phrases");
      return;
    }
    if (!phrase) return;
    try {
      await addPhrase.mutateAsync({
        phrase_arabic: phrase.phrase_arabic,
        phrase_english: phrase.phrase_english,
        transliteration: phrase.transliteration,
        notes: phrase.notes,
        source: "phrase-of-the-day",
      });
      setSaved(true);
      toast.success("Saved to your flashcards");
    } catch (e: any) {
      toast.error(e.message || "Couldn't save");
    }
  };

  return (
    <div
      className={cn(
        "w-full mb-6 p-5 rounded-2xl",
        "bg-gradient-to-br from-accent/15 via-primary/10 to-accent/5",
        "border-2 border-accent/30 relative overflow-hidden",
      )}
    >
      <div className="absolute top-0 right-0 w-32 h-32 bg-accent/5 rounded-full -translate-y-1/2 translate-x-1/2" />

      <div className="flex items-center justify-between mb-3 relative z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-accent-foreground" />
          </div>
          <div>
            <p className="font-bold text-foreground text-sm">Phrase of the Day</p>
            <p className="text-xs text-muted-foreground">{activeDialect} Arabic</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => fetchPhrase(true)}
          disabled={loading}
          title="New phrase"
          className="h-8 w-8"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </div>

      {loading && !phrase ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Generating today's phrase…
        </div>
      ) : phrase ? (
        <div className="space-y-3 relative z-10">
          {showArabic ? (
            <p
              dir="rtl"
              className="text-2xl font-semibold text-foreground leading-relaxed"
              style={{ fontFamily: "'Noto Sans Arabic', sans-serif" }}
            >
              {phrase.phrase_arabic}
            </p>
          ) : (
            <button
              onClick={() => setShowArabic(true)}
              className="w-full py-3 rounded-lg border-2 border-dashed border-accent/40 bg-card/40 text-sm text-muted-foreground hover:bg-card/60 transition flex items-center justify-center gap-2"
            >
              <Eye className="h-4 w-4" />
              Tap to reveal Arabic
            </button>
          )}

          <p className="text-base text-foreground font-medium">
            {phrase.phrase_english}
          </p>

          {showArabic && (
            <p className="text-sm text-muted-foreground italic">
              {phrase.transliteration}
            </p>
          )}

          {phrase.notes && (
            <p className="text-xs text-muted-foreground leading-relaxed border-l-2 border-accent/40 pl-3">
              {phrase.notes}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saved || addPhrase.isPending}
              className="flex-1"
            >
              {saved ? (
                <>
                  <Check className="h-4 w-4 mr-1.5" />
                  Saved
                </>
              ) : (
                <>
                  <BookmarkPlus className="h-4 w-4 mr-1.5" />
                  Save as flashcard
                </>
              )}
            </Button>
            {showArabic && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowArabic(false)}
                title="Hide Arabic"
              >
                <EyeOff className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};
