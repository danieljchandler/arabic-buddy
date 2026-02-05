 import { useState, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, FileAudio, Download, Loader2, X, BookOpen, Languages, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { HomeButton } from "@/components/HomeButton";
 import { Badge } from "@/components/ui/badge";
 import type { TranscriptResult, VocabItem, GrammarPoint } from "@/types/transcript";

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
 
 interface AnalysisApiResponse {
   vocabulary: Array<{ word: string; meaning: string; root: string }>;
   grammar: Array<{ point: string; explanation: string }>;
   culture: string;
 }

const Transcribe = () => {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
   const [transcriptResult, setTranscriptResult] = useState<TranscriptResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
 
   // Derived state for backwards compatibility
   const transcript = transcriptResult?.rawTranscriptArabic ?? "";
   const vocabulary = transcriptResult?.vocabulary ?? [];
   const grammarPoints = transcriptResult?.grammarPoints ?? [];
   const culturalContext = transcriptResult?.culturalContext;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      // Validate file type
      const validTypes = [
        'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/m4a', 'audio/ogg',
        'video/mp4', 'video/webm', 'video/quicktime', 'audio/mp4'
      ];
      
      if (!validTypes.includes(selectedFile.type) && !selectedFile.name.match(/\.(mp3|wav|m4a|ogg|mp4|webm|mov)$/i)) {
        toast.error("نوع الملف غير مدعوم", {
          description: "يرجى تحميل ملف صوتي أو فيديو"
        });
        return;
      }
      
      setFile(selectedFile);
       setTranscriptResult(null);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      setFile(droppedFile);
       setTranscriptResult(null);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const clearFile = () => {
    setFile(null);
     setTranscriptResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

   const analyzeTranscript = async (rawText: string): Promise<{ vocabulary: VocabItem[]; grammarPoints: GrammarPoint[]; culturalContext?: string } | null> => {
    setIsAnalyzing(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-gulf-arabic`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
           body: JSON.stringify({ transcript: rawText }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "فشل التحليل");
      }

       const result: { success: boolean; analysis?: AnalysisApiResponse } = await response.json();
      if (result.success && result.analysis) {
         // Transform API response to our types
         const transformedVocab: VocabItem[] = result.analysis.vocabulary.map(v => ({
           arabic: v.word,
           english: v.meaning,
           root: v.root,
         }));
         
         const transformedGrammar: GrammarPoint[] = result.analysis.grammar.map(g => ({
           title: g.point,
           explanation: g.explanation,
         }));
 
        toast.success("تم التحليل بنجاح!", {
           description: `تم استخراج ${transformedVocab.length} كلمات`
        });
 
         return {
           vocabulary: transformedVocab,
           grammarPoints: transformedGrammar,
           culturalContext: result.analysis.culture,
         };
      }
       return null;
    } catch (error) {
      console.error("Analysis error:", error);
      toast.error("فشل التحليل", {
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع"
      });
       return null;
    } finally {
      setIsAnalyzing(false);
    }
  };

  const transcribeFile = async () => {
    if (!file) return;

    setIsProcessing(true);
    setProgress(0);

    // Simulate progress while waiting for API response
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + Math.random() * 10;
      });
    }, 500);

    try {
      const formData = new FormData();
      formData.append("audio", file);

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-transcribe`,
        {
          method: "POST",
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: formData,
        }
      );

      clearInterval(progressInterval);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "فشل التحويل");
      }

       const result: ElevenLabsTranscriptionResult = await response.json();
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
         } : null);
       }
    } catch (error) {
      console.error("Transcription error:", error);
      toast.error("فشل التحويل", {
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع"
      });
    } finally {
      clearInterval(progressInterval);
      setIsProcessing(false);
      setProgress(0);
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
                    onClick={transcribeFile}
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
        {transcript && (
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
              <Textarea
                value={transcript}
                readOnly
                className="min-h-[200px] text-right font-arabic text-lg leading-relaxed"
                dir="rtl"
                style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
              />
            </CardContent>
          </Card>
        )}

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
      </div>
    </div>
  );
};

export default Transcribe;
