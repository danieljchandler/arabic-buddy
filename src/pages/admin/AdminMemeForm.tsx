import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Upload, Loader2, ArrowLeft, Sparkles, X, Mic, MicOff, Music, Save, Eye, EyeOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { useDialect } from '@/contexts/DialectContext';
import { extractFramesWithTimestamps } from '@/lib/videoFrameExtractor';
import { classifyAudio, extractAudioWav, type AudioClassification } from '@/lib/audioSpeechDetector';

type Line = { id: string; arabic: string; translation: string; frameTimestamp?: number; startMs?: number; endMs?: number };
type VocabItem = { arabic: string; english: string; root?: string };

interface MemeAnalysis {
  memeExplanation: { casual: string; cultural: string };
  onScreenText: { lines: Line[]; vocabulary: VocabItem[]; grammarPoints: unknown[] };
  audioText: { lines: Line[]; vocabulary: VocabItem[]; grammarPoints: unknown[] } | null;
  thumbnailFrameIndex: number;
  hasSpeech: boolean;
  hasMusic: boolean;
  audioSkippedReason: string | null;
  autoTitle: string;
  autoTitleArabic: string;
}

const AdminMemeForm = () => {
  const navigate = useNavigate();
  const { memeId } = useParams<{ memeId: string }>();
  const { activeDialect } = useDialect();
  const isEdit = !!memeId && memeId !== 'new';

  const [file, setFile] = useState<File | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isVideo, setIsVideo] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');

  const [audioClass, setAudioClass] = useState<AudioClassification | null>(null);
  const [forceTranscribe, setForceTranscribe] = useState(false);

  const [analysis, setAnalysis] = useState<MemeAnalysis | null>(null);
  const [title, setTitle] = useState('');
  const [titleArabic, setTitleArabic] = useState('');
  const [explanationCasual, setExplanationCasual] = useState('');
  const [explanationCultural, setExplanationCultural] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [showTranslations, setShowTranslations] = useState(true);

  // Load existing
  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      const { data, error } = await supabase.from('meme_posts').select('*').eq('id', memeId).maybeSingle();
      if (error || !data) { toast.error('Could not load meme'); return; }
      setMediaUrl(data.media_url);
      setPreviewUrl(data.media_url);
      setIsVideo(data.media_type === 'video');
      setThumbnailUrl(data.thumbnail_url);
      setTitle(data.title);
      setTitleArabic(data.title_arabic);
      const exp = (data.meme_explanation ?? {}) as { casual?: string; cultural?: string };
      setExplanationCasual(exp.casual ?? '');
      setExplanationCultural(exp.cultural ?? '');
      setTagsInput((data.tags ?? []).join(', '));
      setAnalysis({
        memeExplanation: exp as { casual: string; cultural: string },
        onScreenText: {
          lines: (data.on_screen_text ?? []) as Line[],
          vocabulary: (data.vocabulary ?? []) as VocabItem[],
          grammarPoints: (data.grammar_points ?? []) as unknown[],
        },
        audioText: data.has_speech ? {
          lines: (data.audio_lines ?? []) as Line[],
          vocabulary: [],
          grammarPoints: [],
        } : null,
        thumbnailFrameIndex: 0,
        hasSpeech: data.has_speech,
        hasMusic: data.has_music,
        audioSkippedReason: data.audio_skipped_reason,
        autoTitle: data.title,
        autoTitleArabic: data.title_arabic,
      });
    })();
  }, [memeId, isEdit]);

  const handleFile = (f: File) => {
    if (!f.type.startsWith('image/') && !f.type.startsWith('video/')) {
      toast.error('Upload an image or video');
      return;
    }
    setFile(f);
    setIsVideo(f.type.startsWith('video/'));
    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(f));
    setAnalysis(null);
    setAudioClass(null);
  };

  const uploadMedia = async (f: File): Promise<string> => {
    const ext = f.name.split('.').pop() || (f.type.startsWith('video/') ? 'mp4' : 'jpg');
    const path = `admin/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from('meme-uploads').upload(path, f, { contentType: f.type });
    if (error) throw error;
    return supabase.storage.from('meme-uploads').getPublicUrl(path).data.publicUrl;
  };

  const captureThumbnail = async (videoFile: File, atSec: number): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.preload = 'auto';
      v.muted = true;
      v.src = URL.createObjectURL(videoFile);
      v.onloadedmetadata = () => {
        const t = Math.min(Math.max(atSec, 0.1), Math.max(v.duration - 0.1, 0.1));
        v.currentTime = t;
      };
      v.onseeked = () => {
        const c = document.createElement('canvas');
        const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
        c.width = Math.round(v.videoWidth * scale);
        c.height = Math.round(v.videoHeight * scale);
        c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
        c.toBlob((b) => b ? resolve(b) : reject(new Error('thumb fail')), 'image/jpeg', 0.85);
        URL.revokeObjectURL(v.src);
      };
      v.onerror = () => reject(new Error('video load fail'));
    });
  };

  const analyze = async () => {
    if (!file) return;
    setAnalyzing(true);
    setProgress(5);
    setStage('Uploading media...');
    try {
      const url = await uploadMedia(file);
      setMediaUrl(url);

      let frames: { dataUri: string; timestampSeconds: number }[] = [];
      let hasSpeech = false;
      let hasMusic = false;
      let audioSkipped: string | null = null;
      let transcript = '';

      if (isVideo) {
        setStage('Extracting frames for OCR...');
        setProgress(20);
        frames = await extractFramesWithTimestamps(file, 3, 10, 1024);

        setStage('Detecting speech vs music...');
        setProgress(40);
        let cls: AudioClassification | null = null;
        try {
          cls = await classifyAudio(file);
          setAudioClass(cls);
        } catch (e) {
          console.warn('Audio classify failed', e);
        }

        const shouldTranscribe = (cls?.hasSpeech ?? false) || forceTranscribe;
        if (cls && !shouldTranscribe) {
          audioSkipped = cls.reason; // 'silence' | 'music_only'
          hasSpeech = false;
          hasMusic = cls.hasMusic;
          toast.info(`Audio skipped: ${cls.reason.replace('_', ' ')}`);
        } else {
          setStage('Transcribing audio...');
          setProgress(55);
          try {
            const wav = await extractAudioWav(file);
            const fd = new FormData();
            fd.append('audio', wav, 'audio.wav');
            const { data, error } = await supabase.functions.invoke('deepgram-transcribe', { body: fd });
            if (!error && data?.text) {
              transcript = String(data.text);
              hasSpeech = transcript.trim().length > 4;
              hasMusic = cls?.hasMusic ?? false;
              if (!hasSpeech) audioSkipped = 'no_transcript';
            } else {
              audioSkipped = 'asr_failed';
            }
          } catch (e) {
            console.warn('ASR failed', e);
            audioSkipped = 'asr_failed';
          }
        }
      } else {
        // Image
        setStage('Reading image...');
        setProgress(30);
        const dataUri = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result as string);
          r.onerror = rej;
          r.readAsDataURL(file);
        });
        frames = [{ dataUri, timestampSeconds: 0 }];
      }

      setStage('Analyzing with AI...');
      setProgress(75);

      const { data, error } = await supabase.functions.invoke('analyze-meme-admin', {
        body: {
          frames,
          audioTranscript: transcript,
          hasSpeech,
          hasMusic,
          audioSkippedReason: audioSkipped,
          dialect: activeDialect,
        },
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Analysis failed');

      const result = data.result as MemeAnalysis;

      // Thumbnail: use chosen frame for video, original for image
      setStage('Capturing thumbnail...');
      setProgress(90);
      let thumbUrl: string | null = null;
      try {
        if (isVideo) {
          const frame = frames[result.thumbnailFrameIndex] ?? frames[0];
          const thumbBlob = await captureThumbnail(file, frame.timestampSeconds);
          const tpath = `admin/thumbs/${Date.now()}.jpg`;
          await supabase.storage.from('meme-uploads').upload(tpath, thumbBlob, { contentType: 'image/jpeg' });
          thumbUrl = supabase.storage.from('meme-uploads').getPublicUrl(tpath).data.publicUrl;
        } else {
          thumbUrl = url;
        }
      } catch (e) {
        console.warn('Thumb fail', e);
      }
      setThumbnailUrl(thumbUrl);

      setAnalysis(result);
      setTitle(result.autoTitle);
      setTitleArabic(result.autoTitleArabic);
      setExplanationCasual(result.memeExplanation?.casual ?? '');
      setExplanationCultural(result.memeExplanation?.cultural ?? '');
      setProgress(100);
      toast.success('Analyzed!');
    } catch (e) {
      console.error(e);
      toast.error('Analysis failed', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setAnalyzing(false);
      setStage('');
    }
  };

  const updateLine = (kind: 'on_screen_text' | 'audio_lines', idx: number, patch: Partial<Line>) => {
    setAnalysis((prev) => {
      if (!prev) return prev;
      if (kind === 'on_screen_text') {
        const lines = [...prev.onScreenText.lines];
        lines[idx] = { ...lines[idx], ...patch };
        return { ...prev, onScreenText: { ...prev.onScreenText, lines } };
      } else {
        if (!prev.audioText) return prev;
        const lines = [...prev.audioText.lines];
        lines[idx] = { ...lines[idx], ...patch };
        return { ...prev, audioText: { ...prev.audioText, lines } };
      }
    });
  };

  const removeLine = (kind: 'on_screen_text' | 'audio_lines', idx: number) => {
    setAnalysis((prev) => {
      if (!prev) return prev;
      if (kind === 'on_screen_text') {
        const lines = prev.onScreenText.lines.filter((_, i) => i !== idx);
        return { ...prev, onScreenText: { ...prev.onScreenText, lines } };
      }
      if (!prev.audioText) return prev;
      const lines = prev.audioText.lines.filter((_, i) => i !== idx);
      return { ...prev, audioText: { ...prev.audioText, lines } };
    });
  };

  const save = async (publish = false) => {
    if (!analysis) { toast.error('Nothing to save'); return; }
    if (!mediaUrl && !file) { toast.error('No media'); return; }
    setSaving(true);
    try {
      let finalMediaUrl = mediaUrl;
      if (!finalMediaUrl && file) finalMediaUrl = await uploadMedia(file);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const payload: Record<string, unknown> = {
        created_by: user.id,
        dialect: activeDialect,
        media_url: finalMediaUrl!,
        media_type: isVideo ? 'video' : 'image',
        thumbnail_url: thumbnailUrl,
        title,
        title_arabic: titleArabic,
        on_screen_text: analysis.onScreenText.lines,
        audio_lines: analysis.audioText?.lines ?? [],
        vocabulary: analysis.onScreenText.vocabulary,
        grammar_points: analysis.onScreenText.grammarPoints,
        meme_explanation: { casual: explanationCasual, cultural: explanationCultural },
        has_speech: analysis.hasSpeech,
        has_music: analysis.hasMusic,
        audio_skipped_reason: analysis.audioSkippedReason,
        tags: tagsInput.split(',').map((t) => t.trim()).filter(Boolean),
        status: publish ? 'published' : 'draft',
        published_at: publish ? new Date().toISOString() : null,
      };

      if (isEdit) {
        const { error } = await supabase.from('meme_posts').update(payload).eq('id', memeId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('meme_posts').insert(payload);
        if (error) throw error;
      }
      toast.success(publish ? 'Published!' : 'Saved as draft');
      navigate('/admin/memes');
    } catch (e) {
      toast.error('Save failed', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container mx-auto max-w-3xl p-4 space-y-6">
      <Button variant="ghost" onClick={() => navigate('/admin/memes')} className="gap-2">
        <ArrowLeft className="h-4 w-4" /> Back to Memes
      </Button>

      <div>
        <h1 className="text-2xl font-bold">{isEdit ? 'Edit Meme' : 'New Meme'}</h1>
        <p className="text-sm text-muted-foreground">Dialect: <Badge variant="outline">{activeDialect}</Badge></p>
      </div>

      {/* Upload */}
      {!previewUrl && (
        <Card
          className="border-2 border-dashed p-10 text-center cursor-pointer hover:border-primary/40"
          onClick={() => fileInput.current?.click()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
          onDragOver={(e) => e.preventDefault()}
        >
          <input ref={fileInput} type="file" accept="image/*,video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="font-medium">Drop a meme or click to upload</p>
          <p className="text-sm text-muted-foreground mt-1">Image or video</p>
        </Card>
      )}

      {/* Preview + analyze */}
      {previewUrl && !analysis && (
        <Card className="p-4 space-y-4">
          <div className="relative rounded-lg overflow-hidden bg-black">
            {isVideo
              ? <video src={previewUrl} controls className="w-full max-h-80 object-contain" />
              : <img src={previewUrl} alt="preview" className="w-full max-h-80 object-contain" />}
            {file && (
              <button onClick={() => { setFile(null); setPreviewUrl(null); }} className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {isVideo && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted">
              <div className="flex items-center gap-2 text-sm">
                <Mic className="h-4 w-4" />
                Force transcribe even if no speech detected
              </div>
              <Switch checked={forceTranscribe} onCheckedChange={setForceTranscribe} />
            </div>
          )}

          <Button onClick={analyze} disabled={analyzing || !file} size="lg" className="w-full gap-2">
            {analyzing ? <><Loader2 className="h-4 w-4 animate-spin" />{stage || 'Analyzing...'}</> : <><Sparkles className="h-4 w-4" /> Analyze Meme</>}
          </Button>
          {analyzing && <Progress value={progress} className="h-2" />}
        </Card>
      )}

      {/* Results */}
      {analysis && (
        <>
          {previewUrl && (
            <div className="rounded-lg overflow-hidden bg-black border">
              {isVideo
                ? <video src={previewUrl} controls className="w-full max-h-80 object-contain" />
                : <img src={previewUrl} alt="meme" className="w-full max-h-80 object-contain" />}
            </div>
          )}

          {/* Audio status */}
          <Card className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              {analysis.hasSpeech ? <Mic className="h-4 w-4 text-green-600" /> : <MicOff className="h-4 w-4 text-muted-foreground" />}
              <span>{analysis.hasSpeech ? 'Speech detected' : 'No speech'}</span>
              {analysis.hasMusic && <Badge variant="outline" className="gap-1"><Music className="h-3 w-3" /> music</Badge>}
              {analysis.audioSkippedReason && <Badge variant="outline">skip: {analysis.audioSkippedReason}</Badge>}
            </div>
            {audioClass && (
              <p className="text-xs text-muted-foreground">
                Heuristic: silence {(audioClass.silenceRatio * 100).toFixed(0)}% · voiced {(audioClass.voicedRatio * 100).toFixed(0)}% · confidence {(audioClass.confidence * 100).toFixed(0)}%
              </p>
            )}
          </Card>

          {/* Title */}
          <Card className="p-4 space-y-3">
            <div>
              <Label>Title (English)</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Label>Title (Arabic)</Label>
              <Input value={titleArabic} onChange={(e) => setTitleArabic(e.target.value)} dir="rtl" />
            </div>
            <div>
              <Label>Tags (comma separated)</Label>
              <Input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="ramadan, football, khaleeji-tv" />
            </div>
          </Card>

          {/* Explanation */}
          <Card className="p-4 space-y-3">
            <div>
              <Label>Why it's funny (casual)</Label>
              <Textarea rows={3} value={explanationCasual} onChange={(e) => setExplanationCasual(e.target.value)} />
            </div>
            <div>
              <Label>Cultural & linguistic context</Label>
              <Textarea rows={4} value={explanationCultural} onChange={(e) => setExplanationCultural(e.target.value)} />
            </div>
          </Card>

          {/* On-screen text */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">On-Screen Text ({analysis.onScreenText.lines.length})</h3>
              <Button size="sm" variant="ghost" onClick={() => setShowTranslations(!showTranslations)}>
                {showTranslations ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </Button>
            </div>
            {analysis.onScreenText.lines.length === 0 && <p className="text-sm text-muted-foreground">No on-screen text extracted.</p>}
            {analysis.onScreenText.lines.map((l, idx) => (
              <div key={l.id} className="space-y-2 p-3 border rounded-lg">
                <div className="flex items-center justify-between gap-2">
                  {typeof l.frameTimestamp === 'number' && <Badge variant="outline" className="text-xs">@ {l.frameTimestamp}s</Badge>}
                  <button onClick={() => removeLine('on_screen_text', idx)} className="text-muted-foreground hover:text-destructive ml-auto"><X className="h-4 w-4" /></button>
                </div>
                <Input value={l.arabic} dir="rtl" onChange={(e) => updateLine('on_screen_text', idx, { arabic: e.target.value })} />
                {showTranslations && <Input value={l.translation} onChange={(e) => updateLine('on_screen_text', idx, { translation: e.target.value })} placeholder="English" />}
              </div>
            ))}
          </Card>

          {/* Audio lines */}
          {analysis.audioText && analysis.audioText.lines.length > 0 && (
            <Card className="p-4 space-y-3">
              <h3 className="font-semibold">Audio Transcript ({analysis.audioText.lines.length})</h3>
              {analysis.audioText.lines.map((l, idx) => (
                <div key={l.id} className="space-y-2 p-3 border rounded-lg">
                  <div className="flex items-center justify-end">
                    <button onClick={() => removeLine('audio_lines', idx)} className="text-muted-foreground hover:text-destructive"><X className="h-4 w-4" /></button>
                  </div>
                  <Input value={l.arabic} dir="rtl" onChange={(e) => updateLine('audio_lines', idx, { arabic: e.target.value })} />
                  <Input value={l.translation} onChange={(e) => updateLine('audio_lines', idx, { translation: e.target.value })} placeholder="English" />
                </div>
              ))}
            </Card>
          )}

          {/* Vocabulary */}
          {analysis.onScreenText.vocabulary.length > 0 && (
            <Card className="p-4 space-y-2">
              <h3 className="font-semibold">Vocabulary ({analysis.onScreenText.vocabulary.length})</h3>
              <div className="flex flex-wrap gap-2">
                {analysis.onScreenText.vocabulary.map((v, idx) => (
                  <Badge key={idx} variant="secondary" className="text-sm">
                    <span dir="rtl">{v.arabic}</span> · {v.english}
                  </Badge>
                ))}
              </div>
            </Card>
          )}

          <Separator />

          <div className="flex gap-3 sticky bottom-4 bg-background/80 backdrop-blur p-3 rounded-lg border">
            <Button variant="outline" onClick={() => save(false)} disabled={saving} className="flex-1 gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Draft
            </Button>
            <Button onClick={() => save(true)} disabled={saving} className="flex-1 gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Publish
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

export default AdminMemeForm;
