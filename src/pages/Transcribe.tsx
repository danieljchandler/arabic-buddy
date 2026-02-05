 import { useEffect, useMemo, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, FileAudio, Download, Loader2, X, BookOpen, Languages, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { HomeButton } from "@/components/HomeButton";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { supabase } from "@/integrations/supabase/client";
 import { Badge } from "@/components/ui/badge";
 import type { TranscriptResult, VocabItem, GrammarPoint } from "@/types/transcript";
  import { LineByLineTranscript } from "@/components/transcript/LineByLineTranscript";

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

 interface ElevenLabsTranscriptionResult {
   text: string;
   words?: Array<{
     text: string;
     start: number;
     end: number;
     speaker?: string;
   }>;
   audio_events?: Array<{
     type: string;
     start: number;
     end: number;
   }>;
 }
 

const Transcribe = () => {
  const [file, setFile] = useState<File | null>(null);
   const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
   const [transcriptResult, setTranscriptResult] = useState<TranscriptResult | null>(null);
   const [debugTrace, setDebugTrace] = useState<{
     phase: string;
     at: string;
     message?: string;
     details?: unknown;
   } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
 
   // Derived state for backwards compatibility
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

   // Persist debugTrace across reloads so we can tell if this is a page reload vs a React render crash.
   useEffect(() => {
     if (!debugTrace) return;
     try {
       sessionStorage.setItem("__transcribe_debug_trace", JSON.stringify(debugTrace));
     } catch {
       // ignore
     }
   }, [debugTrace]);

   useEffect(() => {
     try {
       const storedTrace = sessionStorage.getItem("__transcribe_debug_trace");
       const unloadAt = sessionStorage.getItem("__transcribe_unload_at");
       const unloadPhase = sessionStorage.getItem("__transcribe_unload_phase");

       if (storedTrace && !debugTrace) {
         setDebugTrace(JSON.parse(storedTrace));
       }

       if (unloadAt) {
         // Show a toast after a reload so it's visible even if the UI flashes white.
         toast.error("تمت إعادة تحميل الصفحة أثناء الرفع", {
           description: unloadPhase
             ? `آخر مرحلة: ${unloadPhase}`
             : "تم اكتشاف إعادة تحميل غير متوقعة.",
         });
         sessionStorage.removeItem("__transcribe_unload_at");
         sessionStorage.removeItem("__transcribe_unload_phase");
       }
     } catch (err) {
       console.error("Failed to restore transcribe debug state:", err);
     }
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, []);

   useEffect(() => {
     const onBeforeUnload = () => {
       try {
         sessionStorage.setItem("__transcribe_unload_at", new Date().toISOString());
         sessionStorage.setItem("__transcribe_unload_phase", debugTrace?.phase ?? "unknown");
       } catch {
         // ignore
       }
     };
     window.addEventListener("beforeunload", onBeforeUnload);
     return () => window.removeEventListener("beforeunload", onBeforeUnload);
   }, [debugTrace?.phase]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
     try {
       const selectedFile = e.target.files?.[0];
       if (selectedFile) {
         // Validate file type
         const validTypes = [
           "audio/mpeg",
           "audio/mp3",
           "audio/wav",
           "audio/m4a",
           "audio/ogg",
           "video/mp4",
           "video/webm",
           "video/quicktime",
           "audio/mp4",
         ];

         if (
           !validTypes.includes(selectedFile.type) &&
           !selectedFile.name.match(/\.(mp3|wav|m4a|ogg|mp4|webm|mov)$/i)
         ) {
           toast.error("نوع الملف غير مدعوم", {
             description: "يرجى تحميل ملف صوتي أو فيديو",
           });
           return;
         }

         setFile(selectedFile);
         setTranscriptResult(null);
         // Create blob URL for audio playback
         if (audioUrl) {
           URL.revokeObjectURL(audioUrl);
         }
         setAudioUrl(URL.createObjectURL(selectedFile));
       }
     } catch (err) {
       console.error("handleFileSelect error:", err);
       setDebugTrace({
         phase: "fileSelectError",
         at: new Date().toISOString(),
         message: err instanceof Error ? err.message : String(err),
       });
       toast.error("تعذر اختيار الملف", {
         description: "حدث خطأ غير متوقع أثناء اختيار الملف.",
       });
     }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
     try {
       e.preventDefault();
       const droppedFile = e.dataTransfer.files?.[0];
       if (droppedFile) {
         setFile(droppedFile);
         setTranscriptResult(null);
         // Create blob URL for audio playback
         if (audioUrl) {
           URL.revokeObjectURL(audioUrl);
         }
         setAudioUrl(URL.createObjectURL(droppedFile));
       }
     } catch (err) {
       console.error("handleDrop error:", err);
       setDebugTrace({
         phase: "dropError",
         at: new Date().toISOString(),
         message: err instanceof Error ? err.message : String(err),
       });
       toast.error("تعذر تحميل الملف", {
         description: "حدث خطأ غير متوقع أثناء السحب والإفلات.",
       });
     }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const clearFile = () => {
    setFile(null);
     setTranscriptResult(null);
     // Clean up blob URL
     if (audioUrl) {
       URL.revokeObjectURL(audioUrl);
       setAudioUrl(null);
     }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
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

       if (error) {
         throw new Error(error.message || "فشل التحليل");
       }

       if (!data?.success || !data.result) {
         throw new Error(data?.error || "فشل التحليل");
       }

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
       setDebugTrace({
         phase: "error:analyze",
         at: new Date().toISOString(),
         message: error instanceof Error ? error.message : String(error),
       });
       toast.error("فشل التحليل", {
         description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
       });
       return null;
     } finally {
       setIsAnalyzing(false);
     }
   };

  const transcribeFile = async () => {
    if (!file) return;

     setDebugTrace({ phase: "start", at: new Date().toISOString() });
    setIsProcessing(true);
    setProgress(0);
    let progressInterval: ReturnType<typeof setInterval> | null = null;

    try {
       setDebugTrace({ phase: "progressTimer", at: new Date().toISOString() });
      // Simulate progress while waiting for API response
      progressInterval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 90) {
            if (progressInterval) clearInterval(progressInterval);
            return 90;
          }
          return prev + Math.random() * 10;
        });
      }, 500);

      const formData = new FormData();
      formData.append("audio", file);

       setDebugTrace({
         phase: "request:transcribe",
         at: new Date().toISOString(),
         details: { name: file.name, size: file.size, type: file.type },
       });

      const { data, error } = await supabase.functions.invoke<ElevenLabsTranscriptionResult>(
        "elevenlabs-transcribe",
        {
          body: formData,
        },
      );

      if (progressInterval) clearInterval(progressInterval);

      if (error) {
        throw new Error(error.message || "فشل التحويل");
      }

      if (!data?.text) {
        throw new Error("فشل التحويل: لا يوجد نص في الاستجابة");
      }

      const result = data;
      setProgress(100);
       
       // Initialize TranscriptResult with raw transcript
       const initialResult: TranscriptResult = {
         rawTranscriptArabic: result.text,
         lines: [], // Will be populated by future sentence parsing
         vocabulary: [],
         grammarPoints: [],
       };
       setTranscriptResult(initialResult);
 
      toast.success("تم التحويل بنجاح!", {
        description: `تم تحويل ${file.name}، جاري التحليل...`
      });
      
      // Automatically analyze the transcript
       const analysisData = await analyzeTranscript(result.text);
       if (analysisData) {
         setTranscriptResult(prev => prev ? {
           ...prev,
           vocabulary: analysisData.vocabulary,
           grammarPoints: analysisData.grammarPoints,
           culturalContext: analysisData.culturalContext,
           lines: analysisData.lines || [],
         } : null);
       }
    } catch (error) {
      console.error("Transcription error:", error);
       setDebugTrace({
         phase: "error",
         at: new Date().toISOString(),
         message: error instanceof Error ? error.message : String(error),
       });
      toast.error("فشل التحويل", {
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع"
      });
    } finally {
      if (progressInterval) clearInterval(progressInterval);
      setIsProcessing(false);
      setProgress(0);
       setDebugTrace((prev) =>
         prev?.phase === "error"
           ? prev
           : { phase: "done", at: new Date().toISOString() }
       );
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

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

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
              ارفع ملف صوتي أو فيديو لتحويله إلى نص عربي
            </p>
          </div>
        </div>

        {/* Upload Area */}
        <Card>
          <CardHeader>
            <CardTitle>رفع الملف</CardTitle>
            <CardDescription>
              اسحب وأفلت أو اختر ملف صوتي/فيديو
            </CardDescription>
          </CardHeader>
          <CardContent>
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
                      <p className="text-sm text-muted-foreground">
                        {formatFileSize(file.size)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={clearFile}
                      disabled={isProcessing}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  
                  <Button
                    onClick={() => {
                      try {
                        void transcribeFile();
                      } catch (err) {
                        console.error("transcribeFile handler error:", err);
                        setDebugTrace({
                          phase: "clickHandlerError",
                          at: new Date().toISOString(),
                          message: err instanceof Error ? err.message : String(err),
                        });
                        toast.error("حدث خطأ غير متوقع", {
                          description: "حاول مرة أخرى.",
                        });
                      }
                    }}
                    disabled={isProcessing}
                    className="w-full"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        جاري التحويل...
                      </>
                    ) : (
                      "بدء التحويل"
                    )}
                  </Button>
                </div>
              ) : (
                <label htmlFor="file-upload" className="cursor-pointer">
                  <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-foreground font-medium">
                    انقر أو اسحب الملف هنا
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    MP3, WAV, M4A, OGG, MP4, WebM, MOV
                  </p>
                </label>
              )}
            </div>

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

        {/* Transcript Display */}
         {lines.length > 0 ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>النص المحوّل</CardTitle>
                <CardDescription>
                   {lines.length} جملة
                </CardDescription>
              </div>
              <Button onClick={exportTranscript} variant="outline">
                <Download className="ml-2 h-4 w-4" />
                تصدير
              </Button>
            </CardHeader>
            <CardContent>
               <LineByLineTranscript lines={lines} audioUrl={audioUrl || undefined} />
            </CardContent>
          </Card>
         ) : transcript ? (
           <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>النص المحوّل</CardTitle>
                  <CardDescription>
                    {transcript.length} حرف
                  </CardDescription>
                </div>
                <Button onClick={exportTranscript} variant="outline">
                  <Download className="ml-2 h-4 w-4" />
                  تصدير
                </Button>
              </CardHeader>
              <CardContent>
                <p
                  className="text-right text-lg leading-relaxed text-foreground"
                  dir="rtl"
                  style={{ fontFamily: "'Cairo', 'Traditional Arabic', sans-serif" }}
                >
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
                <BookOpen className="h-5 w-5 text-primary" />
                المفردات الرئيسية
              </CardTitle>
              <CardDescription>
                 {vocabulary.length} كلمات مستخرجة من النص
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                 {vocabulary.map((item, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="text-2xl font-bold text-foreground"
                        style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
                      >
                         {item.arabic}
                      </span>
                       {item.root && (
                         <Badge variant="outline" className="font-mono text-xs">
                           {item.root}
                         </Badge>
                       )}
                    </div>
                     <span className="text-muted-foreground">{item.english}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Grammar Section */}
         {grammarPoints.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Languages className="h-5 w-5 text-primary" />
                نقاط القواعد
              </CardTitle>
              <CardDescription>
                قواعد اللهجة الخليجية المستخدمة في النص
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                 {grammarPoints.map((item, index) => (
                  <div key={index} className="p-4 rounded-lg bg-muted/50 border">
                     <h4 className="font-semibold text-foreground mb-2">{item.title}</h4>
                    <p className="text-muted-foreground text-sm">{item.explanation}</p>
                     {item.examples && item.examples.length > 0 && (
                       <ul className="mt-2 text-sm text-muted-foreground list-disc list-inside">
                         {item.examples.map((ex, i) => (
                           <li key={i}>{ex}</li>
                         ))}
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
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                السياق الثقافي
              </CardTitle>
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
              <CardDescription>
                حالة الصفحة (أضف <span className="font-mono">?debug</span> للرابط)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="text-xs whitespace-pre-wrap rounded-md bg-muted p-3 border">
                {JSON.stringify(
                  {
                    debugTrace,
                    state: {
                      hasFile: Boolean(file),
                      isProcessing,
                      isAnalyzing,
                      progress,
                      hasAudioUrl: Boolean(audioUrl),
                      transcriptChars: transcript.length,
                      lines: lines.length,
                    },
                  },
                  null,
                  2
                )}
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
