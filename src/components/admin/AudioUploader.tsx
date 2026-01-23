import { useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Loader2, Upload, X, Volume2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface AudioUploaderProps {
  currentUrl?: string | null;
  onUpload: (url: string) => void;
  onRemove: () => void;
}

export const AudioUploader = ({ currentUrl, onUpload, onRemove }: AudioUploaderProps) => {
  const [uploading, setUploading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(currentUrl || null);
  const [playing, setPlaying] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const { toast } = useToast();

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('audio/')) {
      toast({
        variant: 'destructive',
        title: 'Invalid file',
        description: 'Please select an audio file.',
      });
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast({
        variant: 'destructive',
        title: 'File too large',
        description: 'Please select an audio file under 10MB.',
      });
      return;
    }

    setUploading(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${crypto.randomUUID()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('flashcard-audio')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('flashcard-audio')
        .getPublicUrl(fileName);

      setAudioUrl(publicUrl);
      onUpload(publicUrl);
      toast({ title: 'Audio uploaded!' });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Upload failed',
        description: error.message,
      });
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = () => {
    setAudioUrl(null);
    onRemove();
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const playAudio = () => {
    if (audioRef.current && audioUrl) {
      audioRef.current.play();
      setPlaying(true);
    }
  };

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        onChange={handleUpload}
        className="hidden"
        id="audio-upload"
      />

      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onEnded={() => setPlaying(false)}
          onError={() => setPlaying(false)}
        />
      )}

      {audioUrl ? (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-muted">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={playing ? 'animate-pulse' : ''}
            onClick={playAudio}
          >
            <Volume2 className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <p className="text-sm font-medium">Audio file uploaded</p>
            <p className="text-xs text-muted-foreground">Click speaker to preview</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleRemove}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <label
          htmlFor="audio-upload"
          className="flex items-center justify-center gap-3 p-6 rounded-xl border-2 border-dashed border-muted-foreground/25 bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
        >
          {uploading ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : (
            <>
              <Upload className="h-6 w-6 text-muted-foreground" />
              <div className="text-center">
                <span className="text-sm text-muted-foreground block">Click to upload audio</span>
                <span className="text-xs text-muted-foreground">MP3, WAV up to 10MB</span>
              </div>
            </>
          )}
        </label>
      )}
    </div>
  );
};
