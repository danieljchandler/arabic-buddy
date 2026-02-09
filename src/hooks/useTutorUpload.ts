import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { toast } from "sonner";
import { decodeAudioFile, clipToWav } from "@/lib/audioClipper";
import type { CandidateData } from "@/components/tutor/CandidateCard";

type Step = "upload" | "processing" | "review" | "confirm" | "creating";

interface ElevenLabsWord {
  text: string;
  start: number;
  end: number;
}

export function useTutorUpload() {
  const { user } = useAuth();
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateData[]>([]);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [uploadId] = useState(() => crypto.randomUUID());

  const updateCandidate = useCallback((id: string, updates: Partial<CandidateData>) => {
    setCandidates(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  }, []);

  const approveCandidate = useCallback((id: string) => {
    setCandidates(prev => prev.map(c => c.id === id ? { ...c, status: "approved" as const } : c));
  }, []);

  const rejectCandidate = useCallback((id: string) => {
    setCandidates(prev => prev.map(c => c.id === id ? { ...c, status: "rejected" as const } : c));
  }, []);

  const processFile = useCallback(async (selectedFile: File) => {
    if (!user) {
      toast.error("Please log in first");
      return;
    }

    setFile(selectedFile);
    setAudioUrl(URL.createObjectURL(selectedFile));
    setStep("processing");
    setProgress(0);

    try {
      // Step 1: Upload to storage for later clipping reference
      setProgressLabel("Uploading audio…");
      setProgress(5);

      const fileExt = selectedFile.name.split('.').pop() || 'mp3';
      const storagePath = `${user.id}/${uploadId}/source.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from("tutor-audio-clips")
        .upload(storagePath, selectedFile);

      if (uploadError) {
        console.error("Storage upload error:", uploadError);
        // Non-fatal — we can still proceed with local file
      }

      // Step 2: Transcribe with ElevenLabs (word-level timestamps)
      setProgressLabel("Transcribing audio…");
      setProgress(15);

      const formData = new FormData();
      formData.append("audio", selectedFile);

      const { data: transcribeData, error: transcribeError } = await supabase.functions.invoke(
        "elevenlabs-transcribe",
        { body: formData }
      );

      if (transcribeError || !transcribeData) {
        throw new Error(transcribeError?.message || "Transcription failed");
      }

      setProgress(50);
      const words: ElevenLabsWord[] = transcribeData.words || [];
      
      if (words.length === 0) {
        throw new Error("No words detected in audio. Please try a different file.");
      }

      // Step 3: Build segments from word-level timestamps
      // Group consecutive words into segments (split on pauses > 500ms)
      setProgressLabel("Segmenting transcript…");
      setProgress(55);

      const segments: { text: string; startMs: number; endMs: number }[] = [];
      let currentSegment: { words: string[]; startMs: number; endMs: number } | null = null;

      for (const word of words) {
        const startMs = Math.round(word.start * 1000);
        const endMs = Math.round(word.end * 1000);

        if (!currentSegment) {
          currentSegment = { words: [word.text], startMs, endMs };
        } else if (startMs - currentSegment.endMs > 500) {
          // Pause detected — flush segment
          segments.push({
            text: currentSegment.words.join(" "),
            startMs: currentSegment.startMs,
            endMs: currentSegment.endMs,
          });
          currentSegment = { words: [word.text], startMs, endMs };
        } else {
          currentSegment.words.push(word.text);
          currentSegment.endMs = endMs;
        }
      }
      if (currentSegment) {
        segments.push({
          text: currentSegment.words.join(" "),
          startMs: currentSegment.startMs,
          endMs: currentSegment.endMs,
        });
      }

      // Step 4: AI classification
      setProgressLabel("Classifying vocabulary…");
      setProgress(65);

      const { data: classifyData, error: classifyError } = await supabase.functions.invoke(
        "classify-tutor-segments",
        { body: { segments } }
      );

      if (classifyError || !classifyData?.success) {
        throw new Error(classifyError?.message || classifyData?.error || "Classification failed");
      }

      setProgress(90);

      // Step 5: Build candidate objects
      const rawCandidates = classifyData.candidates || [];
      const candidateObjects: CandidateData[] = rawCandidates.map((c: any, i: number) => ({
        id: crypto.randomUUID(),
        word_text: c.word_text,
        word_standard: c.word_standard,
        word_english: c.word_english,
        sentence_text: c.sentence_text,
        sentence_english: c.sentence_english,
        word_start_ms: c.word_start_ms,
        word_end_ms: c.word_end_ms,
        sentence_start_ms: c.sentence_start_ms,
        sentence_end_ms: c.sentence_end_ms,
        confidence: c.confidence,
        classification: c.classification,
        status: "pending" as const,
        // Auto-suggest image for CONCRETE and ACTION only
        image_enabled: c.classification === "CONCRETE" || c.classification === "ACTION",
      }));

      setCandidates(candidateObjects);
      setProgress(100);
      setStep("review");

      toast.success(`Found ${candidateObjects.length} vocabulary candidates`);
    } catch (err) {
      console.error("Processing error:", err);
      toast.error("Processing failed", {
        description: err instanceof Error ? err.message : "An unexpected error occurred",
      });
      setStep("upload");
    }
  }, [user, uploadId]);

  const createFlashcards = useCallback(async () => {
    if (!user || !file) return;

    const approved = candidates.filter(c => c.status === "approved");
    if (approved.length === 0) {
      toast.error("No approved candidates to create");
      return;
    }

    setStep("creating");
    setProgress(0);
    setProgressLabel("Preparing audio clips…");

    try {
      // Decode audio once
      const audioBuffer = await decodeAudioFile(file);
      setProgress(10);

      const totalSteps = approved.length;
      let completed = 0;

      for (const candidate of approved) {
        // Clip word audio
        setProgressLabel(`Clipping word: ${candidate.word_text}…`);
        const wordBlob = clipToWav(audioBuffer, candidate.word_start_ms, candidate.word_end_ms);
        const wordPath = `${user.id}/${uploadId}/word-${candidate.id}.wav`;
        
        const { error: wordUpErr } = await supabase.storage
          .from("tutor-audio-clips")
          .upload(wordPath, wordBlob, { contentType: "audio/wav" });
        
        if (wordUpErr) console.error("Word clip upload error:", wordUpErr);

        const { data: wordUrlData } = supabase.storage
          .from("tutor-audio-clips")
          .getPublicUrl(wordPath);

        // Clip sentence audio if available
        let sentenceAudioUrl: string | undefined;
        if (candidate.sentence_start_ms != null && candidate.sentence_end_ms != null && candidate.sentence_text) {
          const sentBlob = clipToWav(audioBuffer, candidate.sentence_start_ms, candidate.sentence_end_ms);
          const sentPath = `${user.id}/${uploadId}/sent-${candidate.id}.wav`;
          
          const { error: sentUpErr } = await supabase.storage
            .from("tutor-audio-clips")
            .upload(sentPath, sentBlob, { contentType: "audio/wav" });
          
          if (sentUpErr) console.error("Sentence clip upload error:", sentUpErr);

          const { data: sentUrlData } = supabase.storage
            .from("tutor-audio-clips")
            .getPublicUrl(sentPath);

          sentenceAudioUrl = sentUrlData.publicUrl;
        }

        // Generate image if enabled
        let imageUrl: string | undefined;
        if (candidate.image_enabled) {
          setProgressLabel(`Generating image: ${candidate.word_english}…`);
          try {
            const { data: imgData, error: imgError } = await supabase.functions.invoke(
              "generate-flashcard-image",
              { body: { word_arabic: candidate.word_text, word_english: candidate.word_english } }
            );

            if (!imgError && imgData?.imageBase64) {
              // Upload base64 image to storage
              const base64Data = imgData.imageBase64.replace(/^data:image\/\w+;base64,/, '');
              const imgBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
              const imgBlob = new Blob([imgBytes], { type: 'image/png' });
              const imgPath = `tutor/${user.id}/${candidate.id}.png`;

              const { error: imgUpErr } = await supabase.storage
                .from("flashcard-images")
                .upload(imgPath, imgBlob, { contentType: "image/png" });

              if (!imgUpErr) {
                const { data: imgUrlData } = supabase.storage
                  .from("flashcard-images")
                  .getPublicUrl(imgPath);
                imageUrl = imgUrlData.publicUrl;
              }
            }
          } catch (imgErr) {
            console.error("Image generation failed for:", candidate.word_english, imgErr);
            // Non-fatal, continue without image
          }
        }

        // Insert into user_vocabulary
        // Use type assertion since the new columns aren't in the generated types yet
        const insertData: any = {
          user_id: user.id,
          word_arabic: candidate.word_text,
          word_english: candidate.word_english,
          source: "tutor-upload",
          word_audio_url: wordUrlData.publicUrl,
          sentence_audio_url: sentenceAudioUrl || null,
          source_upload_id: uploadId,
        };

        const { error: insertError } = await supabase
          .from("user_vocabulary")
          .insert(insertData);

        if (insertError) {
          if (insertError.code === "23505") {
            console.warn("Duplicate word skipped:", candidate.word_text);
          } else {
            console.error("Insert error:", insertError);
          }
        }

        completed++;
        setProgress(10 + (completed / totalSteps) * 85);
      }

      setProgress(100);
      setProgressLabel("Done!");
      toast.success(`Created ${approved.length} flashcards!`);
      setStep("confirm");
    } catch (err) {
      console.error("Flashcard creation error:", err);
      toast.error("Failed to create flashcards", {
        description: err instanceof Error ? err.message : "An unexpected error occurred",
      });
      setStep("review");
    }
  }, [user, file, candidates, uploadId]);

  return {
    step,
    file,
    audioUrl,
    candidates,
    progress,
    progressLabel,
    processFile,
    updateCandidate,
    approveCandidate,
    rejectCandidate,
    createFlashcards,
    setStep,
  };
}
