import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Brain, Music, RefreshCw, AlertTriangle, X, Play } from "lucide-react";
import { createPlayableJingleAudio } from "@/lib/jingleAudio";

interface LeechHelperPanelProps {
  /** "word" or "phrase" — controls table + jingle function. */
  kind: "word" | "phrase";
  rowId: string;
  /** Arabic text to memorize. */
  arabic: string;
  /** English meaning. */
  english: string;
  transliteration?: string | null;
  dialect: string;
  mnemonic: string | null;
  jingleAudioUrl: string | null;
  /** Invalidate which query keys after save. */
  invalidateKeys?: string[][];
  /** Callback so the parent can play audio through its own ref. */
  onPlayAudio?: (url: string, options?: { repairJingle?: boolean }) => void;
}

const TABLE_BY_KIND: Record<"word" | "phrase", "user_vocabulary" | "user_phrases"> = {
  word: "user_vocabulary",
  phrase: "user_phrases",
};

const JINGLE_FN_BY_KIND: Record<"word" | "phrase", string> = {
  word: "generate-word-jingle",
  phrase: "generate-phrase-jingle",
};

export function LeechHelperPanel({
  kind,
  rowId,
  arabic,
  english,
  transliteration,
  dialect,
  mnemonic: initialMnemonic,
  jingleAudioUrl: initialJingleUrl,
  invalidateKeys = [],
  onPlayAudio,
}: LeechHelperPanelProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [mnemonic, setMnemonic] = useState<string | null>(initialMnemonic);
  const [jingleUrl, setJingleUrl] = useState<string | null>(initialJingleUrl);
  const [mnLoading, setMnLoading] = useState(false);
  const [jgLoading, setJgLoading] = useState(false);

  useEffect(() => {
    setMnemonic(initialMnemonic);
    setJingleUrl(initialJingleUrl);
  }, [rowId, initialMnemonic, initialJingleUrl]);

  const invalidate = () => {
    invalidateKeys.forEach((key) =>
      queryClient.invalidateQueries({ queryKey: key }),
    );
  };

  const playAudio = (url: string) => {
    if (onPlayAudio) onPlayAudio(url, { repairJingle: true });
    else new Audio(url).play().catch(() => {});
  };

  const generateMnemonic = async () => {
    setMnLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-mnemonic", {
        body: { arabic, english, transliteration, dialect, kind },
      });
      if (error) throw new Error(error.message || "Failed");
      const text = (data as { mnemonic?: string })?.mnemonic;
      if (!text) throw new Error("Empty mnemonic");
      setMnemonic(text);
      await (supabase.from(TABLE_BY_KIND[kind]) as any)
        .update({ mnemonic: text })
        .eq("id", rowId);
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

  const generateJingle = async () => {
    if (!user) return;
    setJgLoading(true);
    try {
      const body = kind === "word"
        ? { word_arabic: arabic, word_english: english, dialect }
        : { phrase_arabic: arabic, phrase_english: english, dialect };
      const response = await supabase.functions.invoke(JINGLE_FN_BY_KIND[kind], {
        body,
      });
      if (response.error) throw new Error(response.error.message || "Failed");
      const audioFile = await createPlayableJingleAudio(response.data);
      const fileName = `jingles/${user.id}/${kind}-${rowId}-${Date.now()}.${audioFile.extension}`;
      const { error: uploadError } = await supabase.storage
        .from("flashcard-audio")
        .upload(fileName, audioFile.blob, { contentType: audioFile.mimeType, upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("flashcard-audio").getPublicUrl(fileName);
      const url = urlData.publicUrl;
      setJingleUrl(url);
      await (supabase.from(TABLE_BY_KIND[kind]) as any)
        .update({ jingle_audio_url: url })
        .eq("id", rowId);
      invalidate();
      toast.success("🎵 Memory jingle ready — tap Play to listen.");
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.includes("429")) toast.error("Rate limited — try again shortly");
      else if (msg.includes("402")) toast.error("AI credits exhausted");
      else toast.error("Failed to generate jingle");
    } finally {
      setJgLoading(false);
    }
  };

  const dismissLeech = async () => {
    try {
      await (supabase.from(TABLE_BY_KIND[kind]) as any)
        .update({ is_leech: false, lapses: 0, ...(kind === "word" ? { production_lapses: 0 } : {}) })
        .eq("id", rowId);
      invalidate();
      toast.success("Cleared — we'll stop flagging this card.");
    } catch {
      toast.error("Couldn't clear leech status");
    }
  };

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

      {/* Jingle */}
      {jingleUrl ? (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5"
            onClick={() => playAudio(jingleUrl)}
          >
            <Play className="h-4 w-4" /> Play memory jingle
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={generateJingle}
            disabled={jgLoading}
            title="Regenerate jingle"
          >
            {jgLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-1.5"
          onClick={generateJingle}
          disabled={jgLoading}
        >
          {jgLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Music className="h-4 w-4" />}
          {jgLoading ? "Composing jingle..." : "Generate memory jingle"}
        </Button>
      )}
    </div>
  );
}
