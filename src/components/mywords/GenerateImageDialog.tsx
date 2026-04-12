import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface GenerateImageWord {
  id: string;
  word_arabic: string;
  word_english: string;
  image_url?: string | null;
}

interface GenerateImageDialogProps {
  word: GenerateImageWord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImageSaved?: (wordId: string, imageUrl: string) => void;
}

export const GenerateImageDialog = ({ word, open, onOpenChange, onImageSaved }: GenerateImageDialogProps) => {
  const [customInstructions, setCustomInstructions] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!word) return;
    setIsGenerating(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("generate-flashcard-image", {
        body: {
          word_arabic: word.word_arabic,
          word_english: word.word_english,
          custom_instructions: customInstructions || undefined,
        },
      });

      if (error) throw error;
      if (!data?.imageUrl) throw new Error("No image returned");

      const urlWithCacheBust = `${data.imageUrl}?t=${Date.now()}`;

      if (onImageSaved) {
        onImageSaved(word.id, urlWithCacheBust);
      }

      setPreviewUrl(urlWithCacheBust);
      toast.success("Image generated!");
    } catch (err: any) {
      console.error("Image generation failed:", err);
      toast.error(err.message || "Failed to generate image");
    } finally {
      setIsGenerating(false);
    }
  };

  const currentImage = previewUrl || word?.image_url;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setPreviewUrl(null); setCustomInstructions(""); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Generate Flashcard Image
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <p className="text-lg font-bold" dir="rtl" style={{ fontFamily: "'Amiri', serif" }}>
              {word?.word_arabic}
            </p>
            <p className="text-sm text-muted-foreground">{word?.word_english}</p>
          </div>

          {currentImage && (
            <div className="flex justify-center">
              <img
                src={currentImage}
                alt={word?.word_english || ""}
                className="w-48 h-48 object-cover rounded-xl border border-border"
              />
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">
              Describe the picture you want (optional)
            </label>
            <Textarea
              placeholder="e.g. a red apple on a wooden table, close-up..."
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              rows={3}
              disabled={isGenerating}
            />
          </div>

          <Button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="w-full gap-2"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : currentImage ? (
              <>
                <RefreshCw className="h-4 w-4" />
                Regenerate Image
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate Image
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
