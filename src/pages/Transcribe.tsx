import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, FileAudio, Download, Loader2, X, BookOpen, Languages, Sparkles, Save, Check, Plus, Link2 } from "lucide-react";
import { toast } from "sonner";
import { HomeButton } from "@/components/HomeButton";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TranscriptResult, VocabItem, GrammarPoint } from "@/types/transcript";
import { LineByLineTranscript } from "@/components/transcript/LineByLineTranscript";
import { TimeRangeSelector } from "@/components/transcript/TimeRangeSelector";
import { useAuth } from "@/hooks/useAuth";
import { useAddUserVocabulary } from "@/hooks/useUserVocabulary";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function normalizeTranscriptResult(input: TranscriptResult): TranscriptResult {
  const safeLines = Array.isArray(input.lines) ? input.lines : [];
  const safeVocab = Array.isArray(input.vocabulary) ? input.vocabulary : [];
  const safeGrammar = Array.isArray(input.grammarPoints) ? input.grammarPoints : [];

  return {
    rawTranscriptArabic: String(input.rawTranscriptArabic ?? ""),
    culturalContext:
      input.culturalContext === undefined ? undefined : String(input.culturalContext),
    vocabulary: safeVocab
      .filter((v) => v && typeof v === "object")
      .map((v) => ({
        arabic: String((v as VocabItem).arabic ?? ""),
        english: String((v as VocabItem).english ?? ""),
        root: (v as VocabItem).root ? String((v as VocabItem).root) : undefined,
      }))
      .filter((v) => v.arabic.length > 0),
    grammarPoints: safeGrammar
      .filter((g) => g && typeof g === "object")
      .map((g) => ({
        title: String((g as GrammarPoint).title ?? ""),
        explanation: String((g as GrammarPoint).explanation ?? ""),
        examples: Array.isArray((g as GrammarPoint).examples)
          ? (g as GrammarPoint).examples!.map(String)
          : undefined,
      }))
      .filter((g) => g.title.length > 0),
    lines: safeLines
      .filter((l) => l && typeof l === "object")
      .map((l, idx) => {
        const line = l as TranscriptResult["lines"][number];
        const tokens = Array.isArray(line.tokens) ? line.tokens : [];
        return {
          id: typeof line.id === "string" && line.id ? line.id : `line-${idx}`,
          arabic: String(line.arabic ?? ""),
          translation: String(line.translation ?? ""),
          tokens: tokens
            .filter((t) => t && typeof t === "object")
            .map((t, tIdx) => ({
              id: typeof t.id === "string" && t.id ? t.id : `tok-${idx}-${tIdx}`,
              surface: String(t.surface ?? ""),
              standard: t.standard ? String(t.standard) : undefined,
              gloss: t.gloss ? String(t.gloss) : undefined,
            }))
            .filter((t) => t.surface.length > 0),
        };
      })
      .filter((l) => l.arabic.length > 0),
  };
}

interface ElevenLabsWord {
  text: string;
  start: number;
  end: number;
  speaker?: string;
}

interface ElevenLabsTranscriptionResult {
  text: string;
  words?: ElevenLabsWord[];
  audio_events?: Array<{
    type: string;
    start: number;
    end: number;
  }>;
}

function mapTimestampsToLines(
  lines: TranscriptResult["lines"],
  words: ElevenLabsWord[]
): TranscriptResult["lines"] {
  if (!words || words.length === 0) return lines;
  
  const normalizeArabic = (text: string) => 
    text.replace(/[\u064B-\u0652\u0670]/g, '')
        .replace(/[^\u0600-\u06FF]/g, '')
        .trim();
  
  let wordIndex = 0;
  
  return lines.map(line => {
    const lineWords = line.arabic.split(/\s+/).filter(Boolean);
    if (lineWords.length === 0) return line;
    
    let startMs: number | undefined;
    let endMs: number | undefined;
    
    const startSearchIndex = wordIndex;
    let matchedFirst = false;
    
    for (let i = 0; i < lineWords.length; i++) {
      const lineWord = normalizeArabic(lineWords[i]);
      if (!lineWord) continue;
      
      for (let j = matchedFirst ? wordIndex : startSearchIndex; j < words.length; j++) {
        const elevenWord = normalizeArabic(words[j].text);
        if (elevenWord === lineWord || elevenWord.includes(lineWord) || lineWord.includes(elevenWord)) {
          if (!matchedFirst) {
            startMs = Math.round(words[j].start * 1000);
            matchedFirst = true;
          }
          endMs = Math.round(words[j].end * 1000);
          wordIndex = j + 1;
          break;
        }
      }
    }
    
    if (startMs !== undefined && endMs !== undefined) {
      return { ...line, startMs, endMs };
    }
    
    return line;
  });
}

/**
 * Filter ElevenLabs words to only those within a time range
 */
function filterWordsByTimeRange(
  words: ElevenLabsWord[],
  startSec: number,
  endSec: number
): ElevenLabsWord[] {
  return words.filter(w => w.start >= startSec && w.end <= endSec);
}

/**
 * Filter raw transcript text by keeping only words within time range
 */
function filterTranscriptByTimeRange(
  text: string,
  words: ElevenLabsWord[],
  startSec: number,
  endSec: number
): string {
  const filteredWords = filterWordsByTimeRange(words, startSec, endSec);
  if (filteredWords.length === 0) return text; // fallback to full text
  return filteredWords.map(w => w.text).join(" ");
}

const MAX_DURATION = 180; // 3 minutes

const Transcribe = () => {
  const { user, isAuthenticated } = useAuth();
  const addUserVocabulary = useAddUserVocabulary();
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());
  const [vocabSectionWords, setVocabSectionWords] = useState<Set<string>>(new Set());
  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [progress, setProgress] = useState(0);
  const [transcriptResult, setTranscriptResult] = useState<TranscriptResult | null>(null);
  const [debugTrace, setDebugTrace] = useState<{
    phase: string;
    at: string;
    message?: string;
    details?: unknown;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // URL import state
  const [urlInput, setUrlInput] = useState("");
  const [isLoadingUrl, setIsLoadingUrl] = useState(false);
  const [remoteAudioUrl, setRemoteAudioUrl] = useState<string | null>(null);

  // Duration & time range state
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const [timeRange, setTimeRange] = useState<[number, number]>([0, MAX_DURATION]);

  // Derived state
  const transcript = transcriptResult?.rawTranscriptArabic ?? "";
  const vocabulary = transcriptResult?.vocabulary ?? [];
  const grammarPoints = transcriptResult?.grammarPoints ?? [];
  const culturalContext = transcriptResult?.culturalContext;
  const lines = transcriptResult?.lines ?? [];

  const debugEnabled = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).has("debug");
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (!debugTrace) return;
    try {
      sessionStorage.setItem("__transcribe_debug_trace", JSON.stringify(debugTrace));
    } catch { /* ignore */ }
  }, [debugTrace]);

  useEffect(() => {
    try {
      const storedTrace = sessionStorage.getItem("__transcribe_debug_trace");
      const unloadAt = sessionStorage.getItem("__transcribe_unload_at");
      const unloadPhase = sessionStorage.getItem("__transcribe_unload_phase");
      const unloadActive = sessionStorage.getItem("__transcribe_unload_active");

      if (storedTrace && !debugTrace) {
        setDebugTrace(JSON.parse(storedTrace));
      }

      if (unloadAt && unloadActive === "1") {
        toast.error("تمت إعادة تحميل الصفحة أثناء الرفع", {
          description: unloadPhase ? `آخر مرحلة: ${unloadPhase}` : "تم اكتشاف إعادة تحميل غير متوقعة.",
        });
        sessionStorage.removeItem("__transcribe_unload_at");
        sessionStorage.removeItem("__transcribe_unload_phase");
        sessionStorage.removeItem("__transcribe_unload_active");
      } else if (unloadAt) {
        sessionStorage.removeItem("__transcribe_unload_at");
        sessionStorage.removeItem("__transcribe_unload_phase");
        sessionStorage.removeItem("__transcribe_unload_active");
      }
    } catch (err) {
      console.error("Failed to restore transcribe debug state:", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onBeforeUnload = () => {
      try {
        if (!isProcessing && !isAnalyzing) return;
        sessionStorage.setItem("__transcribe_unload_at", new Date().toISOString());
        sessionStorage.setItem("__transcribe_unload_phase", debugTrace?.phase ?? "unknown");
        sessionStorage.setItem("__transcribe_unload_active", "1");
      } catch { /* ignore */ }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [debugTrace?.phase, isAnalyzing, isProcessing]);

  // Detect duration from uploaded file
  const detectFileDuration = useCallback((selectedFile: File) => {
    const mediaEl = selectedFile.type.startsWith("video/")
      ? document.createElement("video")
      : document.createElement("audio");
    
    mediaEl.preload = "metadata";
    const objectUrl = URL.createObjectURL(selectedFile);
    mediaEl.src = objectUrl;
    
    mediaEl.onloadedmetadata = () => {
      const dur = Math.ceil(mediaEl.duration);
      setMediaDuration(dur);
      setTimeRange([0, Math.min(dur, MAX_DURATION)]);
      URL.revokeObjectURL(objectUrl);
    };

    mediaEl.onerror = () => {
      console.warn("Could not detect media duration");
      URL.revokeObjectURL(objectUrl);
    };
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const selectedFile = e.target.files?.[0];
      if (selectedFile) {
        const validTypes = [
          "audio/mpeg", "audio/mp3", "audio/wav", "audio/m4a", "audio/ogg",
          "video/mp4", "video/webm", "video/quicktime", "audio/mp4",
        ];

        if (
          !validTypes.includes(selectedFile.type) &&
          !selectedFile.name.match(/\.(mp3|wav|m4a|ogg|mp4|webm|mov)$/i)
        ) {
          toast.error("نوع الملف غير مدعوم", { description: "يرجى تحميل ملف صوتي أو فيديو" });
          return;
        }

        setFile(selectedFile);
        setTranscriptResult(null);
        setRemoteAudioUrl(null);
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioUrl(URL.createObjectURL(selectedFile));
        detectFileDuration(selectedFile);
      }
    } catch (err) {
      console.error("handleFileSelect error:", err);
      setDebugTrace({ phase: "fileSelectError", at: new Date().toISOString(), message: err instanceof Error ? err.message : String(err) });
      toast.error("تعذر اختيار الملف");
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    try {
      e.preventDefault();
      const droppedFile = e.dataTransfer.files?.[0];
      if (droppedFile) {
        setFile(droppedFile);
        setTranscriptResult(null);
        setRemoteAudioUrl(null);
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioUrl(URL.createObjectURL(droppedFile));
        detectFileDuration(droppedFile);
      }
    } catch (err) {
      console.error("handleDrop error:", err);
      toast.error("تعذر تحميل الملف");
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const clearFile = () => {
    setFile(null);
    setTranscriptResult(null);
    setMediaDuration(null);
    setTimeRange([0, MAX_DURATION]);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const clearUrl = () => {
    setUrlInput("");
    setRemoteAudioUrl(null);
    setMediaDuration(null);
    setTimeRange([0, MAX_DURATION]);
    setTranscriptResult(null);
  };

  // URL processing
  const processUrl = async () => {
    let trimmed = urlInput.trim();
    if (!trimmed) return;

    // Auto-prepend https:// if missing
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      trimmed = `https://${trimmed}`;
    }

    // Basic URL validation
    try {
      const parsed = new URL(trimmed);
      if (!parsed.hostname.includes('.')) {
        toast.error("رابط غير صالح", { description: "يرجى إدخال رابط صحيح (مثلاً https://youtube.com/watch?v=...)" });
        return;
      }
    } catch {
      toast.error("رابط غير صالح", { description: "يرجى إدخال رابط صحيح" });
      return;
    }

    setIsLoadingUrl(true);
    try {
      const { data, error } = await supabase.functions.invoke("download-media", {
        body: { url: trimmed },
      });

      if (error) throw new Error(error.message);
      if (!data?.audioUrl) throw new Error("لم يتم العثور على رابط صوتي");

      setRemoteAudioUrl(data.audioUrl);
      setFile(null);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);

      // Try to detect duration from the remote audio
      const audioEl = document.createElement("audio");
      audioEl.preload = "metadata";
      audioEl.crossOrigin = "anonymous";
      audioEl.src = data.audioUrl;
      audioEl.onloadedmetadata = () => {
        const dur = Math.ceil(audioEl.duration);
        setMediaDuration(dur);
        setTimeRange([0, Math.min(dur, MAX_DURATION)]);
      };
      audioEl.onerror = () => {
        // If we can't detect, default to max
        setMediaDuration(MAX_DURATION);
        setTimeRange([0, MAX_DURATION]);
      };

      toast.success("تم استخراج الصوت!", { description: data.filename || "جاهز للتحويل" });
    } catch (err) {
      console.error("URL processing error:", err);
      toast.error("فشل معالجة الرابط", {
        description: err instanceof Error ? err.message : "حدث خطأ غير متوقع",
      });
    } finally {
      setIsLoadingUrl(false);
    }
  };

  const analyzeTranscript = async (
    rawText: string,
  ): Promise<{
    vocabulary: VocabItem[];
    grammarPoints: GrammarPoint[];
    culturalContext?: string;
    lines?: TranscriptResult["lines"];
  } | null> => {
    setIsAnalyzing(true);
    try {
      setDebugTrace({ phase: "request:analyze", at: new Date().toISOString() });

      const { data, error } = await supabase.functions.invoke<{
        success: boolean;
        result?: TranscriptResult;
        error?: string;
        details?: unknown;
      }>("analyze-gulf-arabic", {
        body: { transcript: rawText },
      });

      if (error) throw new Error(error.message || "فشل التحليل");
      if (!data?.success || !data.result) throw new Error(data?.error || "فشل التحليل");

      const normalized = normalizeTranscriptResult(data.result);

      toast.success("تم التحليل بنجاح!", {
        description: `تم استخراج ${normalized.vocabulary.length} كلمات و ${normalized.lines.length} جمل`,
      });

      setDebugTrace({
        phase: "response:analyze",
        at: new Date().toISOString(),
        details: { lines: normalized.lines.length, vocab: normalized.vocabulary.length },
      });

      return {
        vocabulary: normalized.vocabulary,
        grammarPoints: normalized.grammarPoints,
        culturalContext: normalized.culturalContext,
        lines: normalized.lines,
      };
    } catch (error) {
      console.error("Analysis error:", error);
      setDebugTrace({ phase: "error:analyze", at: new Date().toISOString(), message: error instanceof Error ? error.message : String(error) });
      toast.error("فشل التحليل", { description: error instanceof Error ? error.message : "حدث خطأ غير متوقع" });
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  };

  const transcribeFile = async () => {
    if (!file && !remoteAudioUrl) return;

    setDebugTrace({ phase: "start", at: new Date().toISOString() });
    setIsProcessing(true);
    setProgress(0);
    let progressInterval: ReturnType<typeof setInterval> | null = null;

    try {
      progressInterval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 90) { if (progressInterval) clearInterval(progressInterval); return 90; }
          return prev + Math.random() * 10;
        });
      }, 500);

      let data: ElevenLabsTranscriptionResult;
      let error: Error | null = null;

      if (remoteAudioUrl) {
        // URL-based transcription
        setDebugTrace({ phase: "request:transcribe-url", at: new Date().toISOString(), details: { url: remoteAudioUrl.substring(0, 80) } });
        
        const result = await supabase.functions.invoke<ElevenLabsTranscriptionResult>(
          "elevenlabs-transcribe",
          { body: { audioUrl: remoteAudioUrl } }
        );
        data = result.data!;
        if (result.error) error = new Error(result.error.message);
      } else {
        // File-based transcription
        const formData = new FormData();
        formData.append("audio", file!);
        setDebugTrace({ phase: "request:transcribe", at: new Date().toISOString(), details: { name: file!.name, size: file!.size, type: file!.type } });
        
        const result = await supabase.functions.invoke<ElevenLabsTranscriptionResult>(
          "elevenlabs-transcribe",
          { body: formData }
        );
        data = result.data!;
        if (result.error) error = new Error(result.error.message);
      }

      if (progressInterval) clearInterval(progressInterval);

      if (error) throw error;
      if (!data?.text) throw new Error("فشل التحويل: لا يوجد نص في الاستجابة");

      const elevenLabsWords = data.words || [];
      
      // Apply time range filtering if duration is known and range is set
      let filteredText = data.text;
      let filteredWords = elevenLabsWords;
      
      if (mediaDuration && mediaDuration > MAX_DURATION && elevenLabsWords.length > 0) {
        filteredText = filterTranscriptByTimeRange(data.text, elevenLabsWords, timeRange[0], timeRange[1]);
        filteredWords = filterWordsByTimeRange(elevenLabsWords, timeRange[0], timeRange[1]);
        console.log(`Time range filter: ${timeRange[0]}s-${timeRange[1]}s, words: ${elevenLabsWords.length} → ${filteredWords.length}`);
      }

      setProgress(100);
      
      const initialResult: TranscriptResult = {
        rawTranscriptArabic: filteredText,
        lines: [],
        vocabulary: [],
        grammarPoints: [],
      };
      setTranscriptResult(initialResult);

      toast.success("تم التحويل بنجاح!", { description: "جاري التحليل..." });
      
      const analysisData = await analyzeTranscript(filteredText);
      if (analysisData) {
        const linesWithTimestamps = mapTimestampsToLines(analysisData.lines || [], filteredWords);
        console.log('Mapped timestamps:', linesWithTimestamps.filter(l => l.startMs !== undefined).length, '/', linesWithTimestamps.length);
        
        setTranscriptResult(prev => prev ? {
          ...prev,
          vocabulary: analysisData.vocabulary,
          grammarPoints: analysisData.grammarPoints,
          culturalContext: analysisData.culturalContext,
          lines: linesWithTimestamps,
        } : null);
      }
    } catch (error) {
      console.error("Transcription error:", error);
      setDebugTrace({ phase: "error", at: new Date().toISOString(), message: error instanceof Error ? error.message : String(error) });
      toast.error("فشل التحويل", { description: error instanceof Error ? error.message : "حدث خطأ غير متوقع" });
    } finally {
      if (progressInterval) clearInterval(progressInterval);
      setIsProcessing(false);
      setProgress(0);
      setDebugTrace(prev => prev?.phase === "error" ? prev : { phase: "done", at: new Date().toISOString() });
    }
  };

  const exportTranscript = () => {
    if (!transcript) return;
    const blob = new Blob([transcript], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transcript-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("تم التصدير بنجاح!");
  };

  const handleSaveClick = () => {
    if (!isAuthenticated) {
      toast.error("يرجى تسجيل الدخول أولاً", { description: "تحتاج إلى حساب لحفظ النصوص المحولة" });
      return;
    }
    const defaultTitle = file?.name?.replace(/\.[^/.]+$/, "") || `تحويل ${new Date().toLocaleDateString('ar-SA')}`;
    setSaveTitle(defaultTitle);
    setShowSaveDialog(true);
  };

  const saveTranscription = async () => {
    if (!transcriptResult || !user) return;
    setIsSaving(true);
    try {
      const { error } = await supabase.from("saved_transcriptions").insert({
        user_id: user.id,
        title: saveTitle.trim() || `تحويل ${new Date().toLocaleDateString('ar-SA')}`,
        raw_transcript_arabic: transcriptResult.rawTranscriptArabic,
        lines: JSON.parse(JSON.stringify(transcriptResult.lines)),
        vocabulary: JSON.parse(JSON.stringify(transcriptResult.vocabulary)),
        grammar_points: JSON.parse(JSON.stringify(transcriptResult.grammarPoints)),
        cultural_context: transcriptResult.culturalContext || null,
        audio_url: audioUrl || null,
      });
      if (error) throw error;
      setIsSaved(true);
      setShowSaveDialog(false);
      toast.success("تم حفظ النص بنجاح!");
    } catch (error) {
      console.error("Save error:", error);
      toast.error("فشل الحفظ", { description: error instanceof Error ? error.message : "حدث خطأ غير متوقع" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddToVocabSection = (word: VocabItem) => {
    if (!transcriptResult) return;
    if (vocabSectionWords.has(word.arabic)) {
      toast.info("الكلمة موجودة بالفعل في قسم المفردات");
      return;
    }
    setTranscriptResult(prev => {
      if (!prev) return prev;
      const exists = prev.vocabulary.some(v => v.arabic === word.arabic);
      if (exists) return prev;
      return { ...prev, vocabulary: [...prev.vocabulary, word] };
    });
    setVocabSectionWords(prev => new Set(prev).add(word.arabic));
    toast.success("تمت إضافة الكلمة إلى قسم المفردات");
  };
  
  const handleSaveToMyWords = async (word: VocabItem) => {
    if (!isAuthenticated) {
      toast.error("يرجى تسجيل الدخول أولاً", { description: "تحتاج إلى حساب لحفظ الكلمات" });
      return;
    }
    if (savedWords.has(word.arabic)) { toast.info("الكلمة محفوظة بالفعل"); return; }
    try {
      await addUserVocabulary.mutateAsync({
        word_arabic: word.arabic,
        word_english: word.english,
        root: word.root,
        source: "transcription",
      });
      setSavedWords(prev => new Set(prev).add(word.arabic));
      toast.success("تم حفظ الكلمة في كلماتي");
    } catch (error: unknown) {
      if (error instanceof Error && error.message?.includes("duplicate")) {
        setSavedWords(prev => new Set(prev).add(word.arabic));
        toast.info("الكلمة محفوظة بالفعل");
      } else {
        toast.error("فشل حفظ الكلمة");
      }
    }
  };

  useEffect(() => {
    if (transcriptResult) {
      setIsSaved(false);
      const existingVocab = new Set(transcriptResult.vocabulary.map(v => v.arabic));
      setVocabSectionWords(existingVocab);
    }
  }, [transcriptResult?.rawTranscriptArabic]);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const hasInput = Boolean(file) || Boolean(remoteAudioUrl);
  const showTimeRange = mediaDuration !== null && mediaDuration > MAX_DURATION;

  return (
    <ErrorBoundary name="Transcribe">
    <div className="min-h-screen bg-background p-4 md:p-8" dir="rtl">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <HomeButton />
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-foreground">
              تحويل الصوت إلى نص
            </h1>
            <p className="text-muted-foreground">
              ارفع ملف صوتي/فيديو أو الصق رابط من يوتيوب أو وسائل التواصل
            </p>
          </div>
        </div>

        {/* Input Area with Tabs */}
        <Card>
          <CardHeader>
            <CardTitle>مصدر المحتوى</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="upload" dir="rtl">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="upload" className="gap-2">
                  <Upload className="h-4 w-4" />
                  رفع ملف
                </TabsTrigger>
                <TabsTrigger value="url" className="gap-2">
                  <Link2 className="h-4 w-4" />
                  رابط
                </TabsTrigger>
              </TabsList>

              {/* Upload Tab */}
              <TabsContent value="upload">
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  className={`
                    border-2 border-dashed rounded-lg p-8 text-center transition-colors
                    ${file ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"}
                  `}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*,video/*,.mp3,.wav,.m4a,.ogg,.mp4,.webm,.mov"
                    onChange={handleFileSelect}
                    className="hidden"
                    id="file-upload"
                  />
                  
                  {file ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-center gap-3">
                        <FileAudio className="h-8 w-8 text-primary" />
                        <div className="text-right">
                          <p className="font-medium text-foreground">{file.name}</p>
                          <p className="text-sm text-muted-foreground">{formatFileSize(file.size)}</p>
                        </div>
                        <Button variant="ghost" size="icon" onClick={clearFile} disabled={isProcessing}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <label htmlFor="file-upload" className="cursor-pointer">
                      <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <p className="text-foreground font-medium">انقر أو اسحب الملف هنا</p>
                      <p className="text-sm text-muted-foreground mt-1">MP3, WAV, M4A, OGG, MP4, WebM, MOV</p>
                    </label>
                  )}
                </div>
              </TabsContent>

              {/* URL Tab */}
              <TabsContent value="url">
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <Input
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      placeholder="الصق رابط يوتيوب، تيك توك، إنستغرام، أو أي رابط فيديو..."
                      dir="ltr"
                      className="font-mono text-sm"
                      disabled={isLoadingUrl || isProcessing}
                    />
                    <Button
                      onClick={processUrl}
                      disabled={!urlInput.trim() || isLoadingUrl || isProcessing}
                      variant="secondary"
                    >
                      {isLoadingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : "استخراج"}
                    </Button>
                  </div>
                  
                  <p className="text-xs text-muted-foreground">
                    يدعم روابط مباشرة وصفحات تحتوي على فيديو/صوت مضمّن
                  </p>

                  {remoteAudioUrl && (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
                      <FileAudio className="h-6 w-6 text-primary" />
                      <span className="text-sm text-foreground flex-1">تم استخراج الصوت بنجاح</span>
                      <Button variant="ghost" size="icon" onClick={clearUrl} disabled={isProcessing}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>

            {/* Time Range Selector */}
            {showTimeRange && hasInput && (
              <div className="mt-4 p-4 rounded-lg border bg-muted/30">
                <TimeRangeSelector
                  duration={mediaDuration!}
                  maxRange={MAX_DURATION}
                  value={timeRange}
                  onChange={setTimeRange}
                />
              </div>
            )}

            {/* Duration info */}
            {mediaDuration !== null && hasInput && !showTimeRange && (
              <p className="mt-3 text-xs text-muted-foreground text-center">
                مدة المقطع: {Math.floor(mediaDuration / 60)}:{(mediaDuration % 60).toString().padStart(2, "0")}
              </p>
            )}

            {/* Process Button */}
            {hasInput && (
              <Button
                onClick={() => {
                  try { void transcribeFile(); } catch (err) {
                    console.error("transcribeFile handler error:", err);
                    toast.error("حدث خطأ غير متوقع");
                  }
                }}
                disabled={isProcessing}
                className="w-full mt-4"
              >
                {isProcessing ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />جاري التحويل...</>
                ) : "بدء التحويل"}
              </Button>
            )}

            {/* Progress Bar */}
            {isProcessing && (
              <div className="mt-4 space-y-2">
                <Progress value={progress} className="h-2" />
                <p className="text-sm text-muted-foreground text-center">
                  {Math.round(progress)}% - جاري معالجة الملف...
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Save Dialog */}
        <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
          <DialogContent dir="rtl">
            <DialogHeader>
              <DialogTitle>حفظ النص المحوّل</DialogTitle>
              <DialogDescription>أدخل عنواناً للنص المحوّل لحفظه في حسابك</DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Input value={saveTitle} onChange={(e) => setSaveTitle(e.target.value)} placeholder="عنوان النص..." dir="rtl" />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setShowSaveDialog(false)}>إلغاء</Button>
              <Button onClick={saveTranscription} disabled={isSaving}>
                {isSaving ? (<><Loader2 className="ml-2 h-4 w-4 animate-spin" />جاري الحفظ...</>) : (<><Save className="ml-2 h-4 w-4" />حفظ</>)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Transcript Display */}
        {lines.length > 0 ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>النص المحوّل</CardTitle>
                <CardDescription>{lines.length} جملة</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSaveClick} variant={isSaved ? "secondary" : "default"} disabled={isSaved}>
                  {isSaved ? (<><Check className="ml-2 h-4 w-4" />تم الحفظ</>) : (<><Save className="ml-2 h-4 w-4" />حفظ</>)}
                </Button>
                <Button onClick={exportTranscript} variant="outline">
                  <Download className="ml-2 h-4 w-4" />تصدير
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <LineByLineTranscript 
                lines={lines} 
                audioUrl={audioUrl || undefined}
                onAddToVocabSection={handleAddToVocabSection}
                onSaveToMyWords={handleSaveToMyWords}
                savedWords={savedWords}
                vocabSectionWords={vocabSectionWords}
              />
            </CardContent>
          </Card>
        ) : transcript ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>النص المحوّل</CardTitle>
                <CardDescription>{transcript.length} حرف</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSaveClick} variant={isSaved ? "secondary" : "default"} disabled={isSaved}>
                  {isSaved ? (<><Check className="ml-2 h-4 w-4" />تم الحفظ</>) : (<><Save className="ml-2 h-4 w-4" />حفظ</>)}
                </Button>
                <Button onClick={exportTranscript} variant="outline">
                  <Download className="ml-2 h-4 w-4" />تصدير
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-right text-lg leading-relaxed text-foreground" dir="rtl" style={{ fontFamily: "'Cairo', 'Traditional Arabic', sans-serif" }}>
                {transcript}
              </p>
            </CardContent>
          </Card>
        ) : null}

        {/* Analysis Loading */}
        {isAnalyzing && (
          <Card>
            <CardContent className="py-8">
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-muted-foreground">جاري تحليل المفردات والقواعد...</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Vocabulary Section */}
        {vocabulary.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-primary" />المفردات الرئيسية
              </CardTitle>
              <CardDescription>
                {vocabulary.length} كلمات مستخرجة من النص
                {isAuthenticated && " - اضغط + لإضافة كلمة إلى قائمتك"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                {vocabulary.map((item, index) => {
                  const wordKey = item.arabic;
                  const isSavedWord = savedWords.has(wordKey);
                  
                  const handleAddWord = async () => {
                    if (!isAuthenticated) { toast.error("يرجى تسجيل الدخول أولاً"); return; }
                    try {
                      await addUserVocabulary.mutateAsync({ word_arabic: item.arabic, word_english: item.english, root: item.root, source: "transcription" });
                      setSavedWords(prev => new Set(prev).add(wordKey));
                      toast.success("تمت إضافة الكلمة!", { description: `"${item.arabic}" أُضيفت إلى كلماتي` });
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "فشل إضافة الكلمة");
                    }
                  };
                  
                  return (
                    <div key={index} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}>{item.arabic}</span>
                        {item.root && <Badge variant="outline" className="font-mono text-xs">{item.root}</Badge>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{item.english}</span>
                        {isAuthenticated && (
                          <Button variant={isSavedWord ? "secondary" : "ghost"} size="icon" className="h-8 w-8" onClick={handleAddWord} disabled={isSavedWord || addUserVocabulary.isPending}>
                            {isSavedWord ? <Check className="h-4 w-4 text-primary" /> : <Plus className="h-4 w-4" />}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Grammar Section */}
        {grammarPoints.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Languages className="h-5 w-5 text-primary" />نقاط القواعد</CardTitle>
              <CardDescription>قواعد اللهجة الخليجية المستخدمة في النص</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {grammarPoints.map((item, index) => (
                  <div key={index} className="p-4 rounded-lg bg-muted/50 border">
                    <h4 className="font-semibold text-foreground mb-2">{item.title}</h4>
                    <p className="text-muted-foreground text-sm">{item.explanation}</p>
                    {item.examples && item.examples.length > 0 && (
                      <ul className="mt-2 text-sm text-muted-foreground list-disc list-inside">
                        {item.examples.map((ex, i) => <li key={i}>{ex}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Cultural Context */}
        {culturalContext && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" />السياق الثقافي</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground leading-relaxed">{culturalContext}</p>
            </CardContent>
          </Card>
        )}

        {debugEnabled && (
          <Card>
            <CardHeader>
              <CardTitle>Debug</CardTitle>
              <CardDescription>حالة الصفحة (أضف <span className="font-mono">?debug</span> للرابط)</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="text-xs whitespace-pre-wrap rounded-md bg-muted p-3 border">
                {JSON.stringify({
                  debugTrace,
                  state: {
                    hasFile: Boolean(file),
                    hasRemoteUrl: Boolean(remoteAudioUrl),
                    isProcessing,
                    isAnalyzing,
                    progress,
                    mediaDuration,
                    timeRange,
                    hasAudioUrl: Boolean(audioUrl),
                    transcriptChars: transcript.length,
                    lines: lines.length,
                  },
                }, null, 2)}
              </pre>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
    </ErrorBoundary>
  );
};

export default Transcribe;
