import { useState, useCallback } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { useDialect } from "@/contexts/DialectContext";
import { useAuth } from "@/hooks/useAuth";
import { useBibleAccess } from "@/hooks/useBibleAccess";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ALL_BOOKS,
  OLD_TESTAMENT,
  NEW_TESTAMENT,
  ARABIC_VERSIONS,
  ENGLISH_VERSION,
  type BibleBook,
} from "@/data/bibleBooks";
import {
  BookOpen,
  Loader2,
  Lock,
  Eye,
  EyeOff,
  ChevronRight,
  Languages,
  ArrowLeft,
} from "lucide-react";
import { DIALECT_FLAGS, DIALECT_LABELS } from "@/config";

// ─── Types ───────────────────────────────────────────────────────────────────
type ViewMode = "select" | "reading";

interface PassageData {
  arabicVerses: string[];
  englishVerses: string[];
  dialectVerses: string[];
  bookUsfm: string;
  chapter: number;
  dialect: string;
}

// ─── Component ───────────────────────────────────────────────────────────────
const BibleReading = () => {
  const { isAuthenticated } = useAuth();
  const { hasAccess, loading: accessLoading } = useBibleAccess();
  const { activeDialect } = useDialect();

  // Selection state
  const [selectedBook, setSelectedBook] = useState<BibleBook | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<number>(1);
  const [arabicVersionId, setArabicVersionId] = useState<number>(
    ARABIC_VERSIONS[0].id,
  );

  // View state
  const [mode, setMode] = useState<ViewMode>("select");
  const [passage, setPassage] = useState<PassageData | null>(null);
  const [loading, setLoading] = useState(false);

  // Toggle states
  const [showEnglish, setShowEnglish] = useState(false);
  const [showFormal, setShowFormal] = useState(true);
  const [showDialect, setShowDialect] = useState(true);

  // ── Fetch passage ────────────────────────────────────────────────────────
  const fetchPassage = useCallback(async () => {
    if (!selectedBook) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "bible-passage",
        {
          body: {
            arabicVersionId,
            englishVersionId: ENGLISH_VERSION.id,
            bookUsfm: selectedBook.usfm,
            chapter: selectedChapter,
            dialect: activeDialect,
          },
        },
      );

      if (error) {
        // The edge function returns structured errors
        const message =
          typeof error === "object" && error !== null && "message" in error
            ? (error as { message: string }).message
            : String(error);
        throw new Error(message);
      }

      setPassage(data as PassageData);
      setMode("reading");
    } catch (err: unknown) {
      console.error("Failed to fetch Bible passage:", err);
      toast.error("Failed to load passage", {
        description: err instanceof Error ? err.message : "Please try again later.",
      });
    } finally {
      setLoading(false);
    }
  }, [selectedBook, selectedChapter, arabicVersionId, activeDialect]);

  // ── Access gate ──────────────────────────────────────────────────────────
  if (accessLoading) {
    return (
      <AppShell>
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!isAuthenticated || !hasAccess) {
    return (
      <AppShell>
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="rounded-full bg-muted p-4">
            <Lock className="h-8 w-8 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-bold">Bible Reading</h1>
          <p className="text-muted-foreground max-w-sm">
            {!isAuthenticated
              ? "Please sign in to access this feature."
              : "This feature is available by invitation only. Contact an administrator to request access."}
          </p>
          <HomeButton />
        </div>
      </AppShell>
    );
  }

  // ── Reading mode ─────────────────────────────────────────────────────────
  if (mode === "reading" && passage) {
    const bookMeta = ALL_BOOKS.find((b) => b.usfm === passage.bookUsfm);
    const versionMeta = ARABIC_VERSIONS.find(
      (v) => v.id === arabicVersionId,
    );

    return (
      <AppShell>
        <div className="min-h-screen bg-background pb-24">
          {/* Header */}
          <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-3">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMode("select")}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div className="flex-1 min-w-0">
                <h1 className="font-bold truncate">
                  {bookMeta?.name ?? passage.bookUsfm} {passage.chapter}
                </h1>
                <p className="text-xs text-muted-foreground truncate font-arabic" dir="rtl">
                  {bookMeta?.nameArabic ?? ""} {passage.chapter}
                </p>
              </div>
              <Badge variant="outline" className="shrink-0">
                {DIALECT_FLAGS[activeDialect as keyof typeof DIALECT_FLAGS]}{" "}
                {activeDialect}
              </Badge>
            </div>

            {/* Toggle row */}
            <div className="flex items-center gap-4 mt-3 text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <Switch
                  checked={showFormal}
                  onCheckedChange={setShowFormal}
                />
                <span>Formal Arabic</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Switch
                  checked={showDialect}
                  onCheckedChange={setShowDialect}
                />
                <span>{activeDialect} Dialect</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Switch
                  checked={showEnglish}
                  onCheckedChange={setShowEnglish}
                />
                <span>English (ESV)</span>
              </label>
            </div>
          </div>

          {/* Version info */}
          <div className="px-4 py-2 text-xs text-muted-foreground flex items-center gap-2 border-b">
            <Languages className="h-3.5 w-3.5" />
            <span>
              Arabic: {versionMeta?.abbreviation ?? "?"} | English: ESV |
              Dialect: {DIALECT_LABELS[activeDialect as keyof typeof DIALECT_LABELS] ?? activeDialect}
            </span>
          </div>

          {/* Verses */}
          <ScrollArea className="h-[calc(100vh-180px)]">
            <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
              {passage.arabicVerses.map((verse, idx) => (
                <div key={idx} className="space-y-2">
                  {/* Formal Arabic */}
                  {showFormal && (
                    <p
                      className="text-lg leading-relaxed font-arabic text-foreground"
                      dir="rtl"
                    >
                      {verse}
                    </p>
                  )}

                  {/* Dialect */}
                  {showDialect && passage.dialectVerses[idx] && (
                    <p
                      className="text-lg leading-relaxed font-arabic text-primary"
                      dir="rtl"
                    >
                      {passage.dialectVerses[idx]}
                    </p>
                  )}

                  {/* English */}
                  {showEnglish && passage.englishVerses[idx] && (
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {passage.englishVerses[idx]}
                    </p>
                  )}

                  {/* Divider */}
                  {idx < passage.arabicVerses.length - 1 && (
                    <div className="border-b border-border/50 pt-2" />
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </AppShell>
    );
  }

  // ── Select mode ──────────────────────────────────────────────────────────
  return (
    <AppShell>
      <div className="min-h-screen bg-background p-4 pb-24">
        <div className="max-w-lg mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3">
            <HomeButton />
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <BookOpen className="h-6 w-6 text-primary" />
                Bible Reading
              </h1>
              <p className="text-sm text-muted-foreground">
                Read the Bible in{" "}
                {DIALECT_LABELS[activeDialect as keyof typeof DIALECT_LABELS] ?? activeDialect}
              </p>
            </div>
          </div>

          {/* Arabic Version */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Arabic Translation</label>
            <Select
              value={String(arabicVersionId)}
              onValueChange={(v) => setArabicVersionId(Number(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select Arabic version" />
              </SelectTrigger>
              <SelectContent>
                {ARABIC_VERSIONS.map((v) => (
                  <SelectItem key={v.id} value={String(v.id)}>
                    {v.abbreviation} — {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* English version (read-only info) */}
          <div className="space-y-2">
            <label className="text-sm font-medium">English Translation</label>
            <div className="border rounded-md px-3 py-2 text-sm text-muted-foreground bg-muted/50">
              {ENGLISH_VERSION.abbreviation} — {ENGLISH_VERSION.name}
            </div>
          </div>

          {/* Dialect info */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Dialect</label>
            <div className="border rounded-md px-3 py-2 text-sm bg-muted/50 flex items-center gap-2">
              <span>{DIALECT_FLAGS[activeDialect as keyof typeof DIALECT_FLAGS]}</span>
              <span>
                {DIALECT_LABELS[activeDialect as keyof typeof DIALECT_LABELS] ?? activeDialect}
              </span>
              <span className="text-xs text-muted-foreground ml-auto">
                Change dialect in app settings
              </span>
            </div>
          </div>

          {/* Book selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Book</label>
            <Select
              value={selectedBook?.usfm ?? ""}
              onValueChange={(usfm) => {
                const book = ALL_BOOKS.find((b) => b.usfm === usfm) ?? null;
                setSelectedBook(book);
                setSelectedChapter(1);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a book" />
              </SelectTrigger>
              <SelectContent>
                {/* Old Testament group */}
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                  Old Testament
                </div>
                {OLD_TESTAMENT.map((b) => (
                  <SelectItem key={b.usfm} value={b.usfm}>
                    {b.name}{" "}
                    <span className="text-muted-foreground font-arabic text-xs">
                      ({b.nameArabic})
                    </span>
                  </SelectItem>
                ))}
                {/* New Testament group */}
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground mt-1">
                  New Testament
                </div>
                {NEW_TESTAMENT.map((b) => (
                  <SelectItem key={b.usfm} value={b.usfm}>
                    {b.name}{" "}
                    <span className="text-muted-foreground font-arabic text-xs">
                      ({b.nameArabic})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Chapter selector */}
          {selectedBook && (
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Chapter{" "}
                <span className="text-muted-foreground font-normal">
                  (1–{selectedBook.chapters})
                </span>
              </label>
              <div className="grid grid-cols-8 sm:grid-cols-10 gap-1.5 max-h-48 overflow-y-auto">
                {Array.from({ length: selectedBook.chapters }, (_, i) => i + 1).map(
                  (ch) => (
                    <Button
                      key={ch}
                      variant={selectedChapter === ch ? "default" : "outline"}
                      size="sm"
                      className="h-9 w-full text-xs"
                      onClick={() => setSelectedChapter(ch)}
                    >
                      {ch}
                    </Button>
                  ),
                )}
              </div>
            </div>
          )}

          {/* Load button */}
          <Button
            className="w-full"
            size="lg"
            disabled={!selectedBook || loading}
            onClick={fetchPassage}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Loading passage…
              </>
            ) : (
              <>
                Read Chapter
                <ChevronRight className="h-4 w-4 ml-1" />
              </>
            )}
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            One chapter at a time to keep AI usage manageable.
          </p>
        </div>
      </div>
    </AppShell>
  );
};

export default BibleReading;
