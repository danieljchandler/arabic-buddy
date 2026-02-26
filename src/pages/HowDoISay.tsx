import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { HomeButton } from "@/components/HomeButton";
import { AppShell } from "@/components/layout/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAddUserVocabulary } from "@/hooks/useUserVocabulary";
import { useAddUserPhrase } from "@/hooks/useUserPhrases";
import type { VocabItem } from "@/types/transcript";
import {
  MessageCircleQuestion,
  Loader2,
  Search,
  Star,
  BookOpen,
  Info,
  Users,
  Plus,
  Check,
  Bookmark,
  BookmarkCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PhraseTranslation {
  arabic: string;
  transliteration: string;
  english: string;
  context: string;
  naturalness: number;
  isPreferred: boolean;
}

interface HowDoISayResult {
  phrase: string;
  translations: PhraseTranslation[];
  vocabulary: VocabItem[];
  culturalNotes?: string;
  genderVariants?: string;
}

/** Extracts the real error message from a supabase.functions.invoke error. */
async function readInvokeError(err: unknown): Promise<string> {
  if (!err || typeof err !== "object") return String(err);
  const context = (err as { context?: Response }).context;
  if (context) {
    try {
      const body = await context.clone().json();
      if (body?.error) return body.error;
      if (body?.message) return body.message;
    } catch {
      /* ignore */
    }
  }
  return (err as Error).message ?? "Unknown error";
}

const NaturalnessStars = ({ value }: { value: number }) => (
  <div className="flex gap-0.5" aria-label={`Naturalness ${value} out of 5`}>
    {[1, 2, 3, 4, 5].map((i) => (
      <Star
        key={i}
        className={cn(
          "h-3 w-3",
          i <= value ? "text-amber-400 fill-amber-400" : "text-muted-foreground/30",
        )}
      />
    ))}
  </div>
);

const HowDoISay = () => {
  const { isAuthenticated } = useAuth();
  const addUserVocabulary = useAddUserVocabulary();
  const addUserPhrase = useAddUserPhrase();

  const [phraseInput, setPhraseInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<HowDoISayResult | null>(null);
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());
  const [savedPhrases, setSavedPhrases] = useState<Set<string>>(new Set());

  const handleSearch = async () => {
    const trimmed = phraseInput.trim();
    if (!trimmed) return;

    setIsLoading(true);
    setResult(null);
    setSavedWords(new Set());
    setSavedPhrases(new Set());

    try {
      const { data, error } = await supabase.functions.invoke("translate-jais", {
        body: { phrase: trimmed },
      });

      if (error) throw new Error(await readInvokeError(error));
      if (!data?.success || !data?.result) throw new Error(data?.error ?? "Translation failed");

      setResult(data.result as HowDoISayResult);
      toast.success("Got it!", {
        description: `Found ${data.result.translations.length} ways to say it`,
      });
    } catch (err) {
      console.error("how-do-i-say error:", err);
      toast.error("Translation failed", {
        description: err instanceof Error ? err.message : "An unexpected error occurred",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveWord = useCallback(
    async (word: VocabItem) => {
      if (!isAuthenticated) {
        toast.error("Sign in to save words");
        return;
      }
      if (savedWords.has(word.arabic)) return;

      try {
        await addUserVocabulary.mutateAsync({
          word_arabic: word.arabic,
          word_english: word.english,
          root: word.root,
          source: "how-do-i-say",
        });
        setSavedWords((prev) => new Set(prev).add(word.arabic));
        toast.success("Saved to My Words!", { description: word.arabic });
      } catch {
        toast.error("Failed to save word");
      }
    },
    [isAuthenticated, addUserVocabulary, savedWords],
  );

  const handleSavePhrase = useCallback(
    async (translation: PhraseTranslation) => {
      if (!isAuthenticated) {
        toast.error("Sign in to save phrases");
        return;
      }
      if (savedPhrases.has(translation.arabic)) return;

      try {
        await addUserPhrase.mutateAsync({
          phrase_arabic: translation.arabic,
          phrase_english: result?.phrase ?? translation.english,
          transliteration: translation.transliteration,
          notes: translation.context || undefined,
          source: "how-do-i-say",
        });
        setSavedPhrases((prev) => new Set(prev).add(translation.arabic));
        toast.success("Phrase saved!", { description: translation.arabic });
      } catch {
        toast.error("Failed to save phrase");
      }
    },
    [isAuthenticated, addUserPhrase, result, savedPhrases],
  );

  return (
    <AppShell>
      <HomeButton />

      <div className="mb-6 mt-4">
        <h1
          className="text-2xl font-bold text-foreground flex items-center gap-2"
          style={{ fontFamily: "'Montserrat', sans-serif" }}
        >
          <MessageCircleQuestion className="h-7 w-7 text-primary" />
          How do I say…?
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Type anything in English and get natural Gulf Arabic phrases
        </p>
      </div>

      {/* Search input */}
      <div className="flex gap-2 mb-6">
        <Input
          value={phraseInput}
          onChange={(e) => setPhraseInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !isLoading && handleSearch()}
          placeholder="e.g. I'm hungry, How are you?, Thank you so much"
          className="flex-1"
          disabled={isLoading}
        />
        <Button onClick={handleSearch} disabled={isLoading || !phraseInput.trim()} className="gap-2 shrink-0">
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Asking…
            </>
          ) : (
            <>
              <Search className="h-4 w-4" />
              Ask
            </>
          )}
        </Button>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-5">
          {/* Translations */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Ways to say it in Gulf Arabic
            </h2>
            <div className="space-y-3">
              {result.translations.map((t, idx) => (
                <Card
                  key={idx}
                  className={cn(
                    "border",
                    t.isPreferred
                      ? "border-primary/40 bg-primary/5 shadow-sm"
                      : "border-border bg-card",
                  )}
                >
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {t.isPreferred && (
                          <Badge
                            variant="default"
                            className="mb-2 text-xs gap-1 bg-primary/90"
                          >
                            <Star className="h-3 w-3 fill-current" />
                            Best option
                          </Badge>
                        )}
                        {/* Arabic phrase */}
                        <p
                          className="text-2xl font-semibold text-foreground leading-snug"
                          dir="rtl"
                          style={{ fontFamily: "'Amiri', serif" }}
                        >
                          {t.arabic}
                        </p>
                        {/* Transliteration */}
                        <p className="text-sm text-primary/80 mt-1 italic">{t.transliteration}</p>
                        {/* Back-translation */}
                        <p className="text-sm text-muted-foreground mt-0.5">{t.english}</p>
                        {/* Context */}
                        {t.context && (
                          <p className="text-xs text-muted-foreground/70 mt-1.5 italic">
                            {t.context}
                          </p>
                        )}
                        {/* Naturalness stars */}
                        <div className="mt-2">
                          <NaturalnessStars value={t.naturalness} />
                        </div>
                      </div>

                      {/* Save phrase button */}
                      {isAuthenticated && (
                        <button
                          onClick={() => handleSavePhrase(t)}
                          disabled={savedPhrases.has(t.arabic)}
                          className={cn(
                            "shrink-0 p-2 rounded-lg transition-all",
                            savedPhrases.has(t.arabic)
                              ? "text-primary bg-primary/10"
                              : "text-muted-foreground hover:text-primary hover:bg-primary/10",
                          )}
                          title={savedPhrases.has(t.arabic) ? "Saved" : "Save phrase"}
                        >
                          {savedPhrases.has(t.arabic) ? (
                            <BookmarkCheck className="h-5 w-5" />
                          ) : (
                            <Bookmark className="h-5 w-5" />
                          )}
                        </button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Cultural notes */}
          {result.culturalNotes && (
            <Card className="border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Info className="h-4 w-4 text-primary" />
                  Cultural Notes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {result.culturalNotes}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Gender variants */}
          {result.genderVariants && (
            <Card className="border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  Gender Variants
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {result.genderVariants}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Vocabulary breakdown */}
          {result.vocabulary.length > 0 && (
            <Card className="border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-primary" />
                  Vocabulary Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {result.vocabulary.map((word, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border/50"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className="text-lg font-semibold text-foreground shrink-0"
                          dir="rtl"
                          style={{ fontFamily: "'Amiri', serif" }}
                        >
                          {word.arabic}
                        </span>
                        <span className="text-sm text-muted-foreground truncate">
                          {word.english}
                        </span>
                        {word.root && (
                          <Badge variant="outline" className="text-xs shrink-0">
                            Root: {word.root}
                          </Badge>
                        )}
                      </div>
                      {isAuthenticated && (
                        <button
                          onClick={() => handleSaveWord(word)}
                          disabled={savedWords.has(word.arabic)}
                          className={cn(
                            "shrink-0 p-1.5 rounded-lg transition-all ml-2",
                            savedWords.has(word.arabic)
                              ? "text-primary"
                              : "text-muted-foreground hover:text-primary hover:bg-primary/10",
                          )}
                          title={savedWords.has(word.arabic) ? "Saved" : "Save word"}
                        >
                          {savedWords.has(word.arabic) ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Plus className="h-4 w-4" />
                          )}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Try another */}
          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={() => {
              setResult(null);
              setPhraseInput("");
              setSavedWords(new Set());
              setSavedPhrases(new Set());
            }}
          >
            <Search className="h-4 w-4" />
            Try another phrase
          </Button>
        </div>
      )}
    </AppShell>
  );
};

export default HowDoISay;
