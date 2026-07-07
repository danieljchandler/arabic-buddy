import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Loader2, Play, CheckCircle, Volume2, Globe, Film } from 'lucide-react';
import { toast } from 'sonner';
import type { Database } from '@/integrations/supabase/types';

type AuthenticStoryLine = Database['public']['Tables']['authentic_story_lines']['Row'];
type StoryVideoSegment = {
  url: string;
  audio_url?: string;
  narration_arabic?: string;
  prompt?: string;
  index?: number;
};

const AdminReadingLibraryForm = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const isEditing = Boolean(id);

  const [title, setTitle] = useState(searchParams.get('title') || '');
  const [titleArabic, setTitleArabic] = useState(searchParams.get('title_arabic') || '');
  const [author, setAuthor] = useState('');
  const [authorArabic, setAuthorArabic] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceName, setSourceName] = useState(searchParams.get('source_type')?.replace('_', ' ') || '');
  const [license, setLicense] = useState('public_domain');
  const [bodyArabic, setBodyArabic] = useState('');
  const [dialect, setDialect] = useState(searchParams.get('dialect') || 'Gulf');
  const [difficulty, setDifficulty] = useState(searchParams.get('difficulty') || 'intermediate');
  const [importing, setImporting] = useState(false);
  const [generatingPreview, setGeneratingPreview] = useState(false);
  const [generatingFull, setGeneratingFull] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [approvingVideo, setApprovingVideo] = useState(false);
  const [generatingFullVideo, setGeneratingFullVideo] = useState(false);
  const [fullVideoIdx, setFullVideoIdx] = useState(0);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const fullVideoRef = useRef<HTMLVideoElement | null>(null);
  const fullAudioRef = useRef<HTMLAudioElement | null>(null);

  // Load existing story when editing
  const { data: story, isLoading: loadingStory } = useQuery({
    queryKey: ['authentic-story', id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('authentic_stories')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: isEditing,
    refetchInterval: (q) => {
      const s = q.state.data as { story_video_status?: string; story_video_full_status?: string } | null;
      if (s?.story_video_status === 'generating' || s?.story_video_full_status === 'generating') return 15000;
      return false;
    },
  });



  // Load story lines when editing
  const { data: lines } = useQuery({
    queryKey: ['authentic-story-lines', id],
    queryFn: async () => {
      if (!id) return [];
      const { data, error } = await supabase
        .from('authentic_story_lines')
        .select('*')
        .eq('story_id', id)
        .order('line_index', { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: isEditing,
  });

  // Populate form fields when story loads
  useEffect(() => {
    if (story) {
      setTitle(story.title || '');
      setTitleArabic(story.title_arabic || '');
      setAuthor(story.author || '');
      setAuthorArabic(story.author_arabic || '');
      setSourceUrl(story.source_url || '');
      setSourceName(story.source_name || '');
      setLicense(story.license || 'public_domain');
      setBodyArabic(story.body_fusha || '');
      setDialect(story.dialect || 'Gulf');
      setDifficulty(story.difficulty || 'intermediate');
    }
  }, [story]);

  const handleImport = async () => {
    if (!title || !titleArabic || !bodyArabic) {
      toast.error('Please fill title, Arabic title, and Arabic body text');
      return;
    }
    setImporting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await supabase.functions.invoke('import-authentic-story', {
        body: {
          title, title_arabic: titleArabic, author, author_arabic: authorArabic,
          source_url: sourceUrl, source_name: sourceName, license,
          body_arabic: bodyArabic, dialect, difficulty,
        },
      });
      if (resp.error) throw new Error(resp.error.message);
      toast.success('Story imported successfully!');
      queryClient.invalidateQueries({ queryKey: ['authentic-stories'] });
      navigate(`/admin/reading-library/${resp.data.story.id}/edit`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const handleApprove = async () => {
    if (!id) return;
    const { error } = await supabase
      .from('authentic_stories')
      .update({ status: 'content_approved' })
      .eq('id', id);
    if (error) {
      toast.error('Failed to approve');
    } else {
      toast.success('Content approved!');
      queryClient.invalidateQueries({ queryKey: ['authentic-story', id] });
    }
  };

  const handleTranslateDialect = async () => {
    if (!id) return;
    setTranslating(true);
    try {
      const resp = await supabase.functions.invoke('translate-story-dialect', {
        body: { story_id: id, dialect: story?.dialect || dialect },
      });
      if (resp.error) throw new Error(resp.error.message);
      toast.success(`Translated to ${story?.dialect || dialect} dialect`);
      queryClient.invalidateQueries({ queryKey: ['authentic-story-lines', id] });
      queryClient.invalidateQueries({ queryKey: ['authentic-story', id] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Translation failed');
    } finally {
      setTranslating(false);
    }
  };

  const handleGeneratePreview = async () => {
    if (!id) return;
    setGeneratingPreview(true);
    try {
      const resp = await supabase.functions.invoke('generate-story-preview-audio', {
        body: { story_id: id },
      });
      if (resp.error) throw new Error(resp.error.message);
      toast.success(`Preview generated (${resp.data.preview_lines} lines)`);
      queryClient.invalidateQueries({ queryKey: ['authentic-story', id] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Preview generation failed');
    } finally {
      setGeneratingPreview(false);
    }
  };

  const handleGenerateFull = async () => {
    if (!id) return;
    setGeneratingFull(true);
    try {
      const resp = await supabase.functions.invoke('generate-story-full-audio', {
        body: { story_id: id },
      });
      if (resp.error) throw new Error(resp.error.message);
      toast.success(`Full audio generated (${resp.data.total_duration}s)`);
      queryClient.invalidateQueries({ queryKey: ['authentic-story', id] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Full audio generation failed');
    } finally {
      setGeneratingFull(false);
    }
  };

  const handleGenerateVideo = async () => {
    if (!id) return;
    setGeneratingVideo(true);
    try {
      const resp = await supabase.functions.invoke('generate-story-video', {
        body: { story_id: id },
      });
      if (resp.error) throw new Error(resp.error.message);
      if (resp.data?.status === 'audio_ready_video_quota_exhausted') {
        toast.warning(resp.data.detail || 'Arabic preview audio is ready, but preview video quota is exhausted.');
      } else {
        toast.success('Video generation started — this takes 2–6 minutes');
      }
      queryClient.invalidateQueries({ queryKey: ['authentic-story', id] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Video generation failed');
    } finally {
      setGeneratingVideo(false);
    }
  };

  const handleApproveVideo = async () => {
    if (!id) return;
    setApprovingVideo(true);
    try {
      const { error } = await supabase
        .from('authentic_stories')
        .update({ story_video_approved: true })
        .eq('id', id);
      if (error) throw error;
      toast.success('Preview approved. You can now generate the full video.');
      queryClient.invalidateQueries({ queryKey: ['authentic-story', id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Approval failed');
    } finally {
      setApprovingVideo(false);
    }
  };

  const handleGenerateFullVideo = async () => {
    if (!id) return;
    setGeneratingFullVideo(true);
    try {
      const resp = await supabase.functions.invoke('generate-story-video-full', {
        body: { story_id: id },
      });
      if (resp.error) throw new Error(resp.error.message);
      toast.success('Full video generation started — this takes 8–15 minutes');
      queryClient.invalidateQueries({ queryKey: ['authentic-story', id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Full video generation failed');
    } finally {
      setGeneratingFullVideo(false);
    }
  };

  const syncAudioToVideo = (video: HTMLVideoElement | null, audio: HTMLAudioElement | null) => {
    if (!video || !audio) return;
    const audioDuration = Number.isFinite(audio.duration) ? audio.duration : video.currentTime;
    audio.currentTime = Math.max(0, Math.min(video.currentTime, audioDuration));
  };

  const playSyncedAudio = async (video: HTMLVideoElement | null, audio: HTMLAudioElement | null) => {
    if (!video || !audio) return;
    syncAudioToVideo(video, audio);
    try {
      await audio.play();
    } catch {
      // Browser autoplay policy may block audio until the admin taps play again.
    }
  };

  const pauseSyncedAudio = (audio: HTMLAudioElement | null) => {
    audio?.pause();
  };

  const handlePublish = async () => {
    if (!id) return;
    const { error } = await supabase
      .from('authentic_stories')
      .update({ status: 'published' })
      .eq('id', id);
    if (error) {
      toast.error('Failed to publish');
    } else {
      toast.success('Story published!');
      queryClient.invalidateQueries({ queryKey: ['authentic-story', id] });
      queryClient.invalidateQueries({ queryKey: ['authentic-stories'] });
    }
  };

  if (isEditing && loadingStory) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/admin/reading-library')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold font-heading">
            {isEditing ? 'Edit Authentic Story' : 'Import Authentic Story'}
          </h1>
          {story && (
            <Badge variant="secondary" className="ml-auto">{story.status}</Badge>
          )}
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
        {/* Metadata Form */}
        <Card>
          <CardHeader>
            <CardTitle>Story Metadata</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Title (English)</Label>
                <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="The Fox and the Grapes" />
              </div>
              <div>
                <Label>Title (Arabic)</Label>
                <Input value={titleArabic} onChange={e => setTitleArabic(e.target.value)} dir="rtl" placeholder="الثعلب والعنب" />
              </div>
              <div>
                <Label>Author (English)</Label>
                <Input value={author} onChange={e => setAuthor(e.target.value)} placeholder="Ibn al-Muqaffa" />
              </div>
              <div>
                <Label>Author (Arabic)</Label>
                <Input value={authorArabic} onChange={e => setAuthorArabic(e.target.value)} dir="rtl" placeholder="ابن المقفع" />
              </div>
              <div>
                <Label>Source URL</Label>
                <Input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://hindawi.org/..." />
              </div>
              <div>
                <Label>Source Name</Label>
                <Input value={sourceName} onChange={e => setSourceName(e.target.value)} placeholder="Hindawi Foundation" />
              </div>
              <div>
                <Label>License</Label>
                <Select value={license} onValueChange={setLicense}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public_domain">Public Domain</SelectItem>
                    <SelectItem value="CC-BY">CC-BY</SelectItem>
                    <SelectItem value="CC-BY-SA">CC-BY-SA</SelectItem>
                    <SelectItem value="CC0">CC0</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Difficulty</Label>
                <Select value={difficulty} onValueChange={setDifficulty}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="beginner">Beginner</SelectItem>
                    <SelectItem value="intermediate">Intermediate</SelectItem>
                    <SelectItem value="advanced">Advanced</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Target Dialect</Label>
                <Select value={dialect} onValueChange={setDialect}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Gulf">Gulf</SelectItem>
                    <SelectItem value="Egyptian">Egyptian</SelectItem>
                    <SelectItem value="Yemeni">Yemeni</SelectItem>
                    <SelectItem value="Levantine">Levantine</SelectItem>
                    <SelectItem value="MSA">MSA (Fusha)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Arabic Text Input (new story only) */}
        {!isEditing && (
          <Card>
            <CardHeader>
              <CardTitle>Arabic Text</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Paste Arabic text (will be segmented and processed by AI)</Label>
                <Textarea
                  value={bodyArabic}
                  onChange={e => setBodyArabic(e.target.value)}
                  dir="rtl"
                  className="min-h-[200px] font-arabic text-lg"
                  placeholder="الصق النص العربي هنا..."
                />
              </div>
              <Button onClick={handleImport} disabled={importing}>
                {importing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Import & Process
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Workflow Actions (edit mode) */}
        {isEditing && story && (
          <Card>
            <CardHeader>
              <CardTitle>Workflow Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3">
                {story.status === 'draft' && (
                  <Button onClick={handleApprove} variant="default">
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Approve Content
                  </Button>
                )}

                <Button onClick={handleTranslateDialect} disabled={translating} variant="outline">
                  {translating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Globe className="h-4 w-4 mr-2" />}
                  Translate to Dialect
                </Button>

                <Button onClick={handleGeneratePreview} disabled={generatingPreview} variant="outline">
                  {generatingPreview ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                  Generate Preview Audio
                </Button>

                <Button onClick={handleGenerateFull} disabled={generatingFull} variant="outline">
                  {generatingFull ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Volume2 className="h-4 w-4 mr-2" />}
                  Generate Full Audio
                </Button>



                <Button
                  onClick={handleGenerateVideo}
                  disabled={generatingVideo || story.story_video_status === 'generating'}
                  variant="outline"
                >
                  {generatingVideo || story.story_video_status === 'generating' ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Film className="h-4 w-4 mr-2" />
                  )}
                  {story.story_video_status === 'generating'
                    ? 'Generating Preview…'
                    : story.story_video_url
                      ? 'Regenerate Preview'
                      : 'Generate Preview Video'}
                </Button>

                {story.story_video_url && !story.story_video_approved && (
                  <Button onClick={handleApproveVideo} disabled={approvingVideo} variant="default">
                    {approvingVideo ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                    Approve Preview
                  </Button>
                )}

                {story.story_video_approved && (
                  <Button
                    onClick={handleGenerateFullVideo}
                    disabled={generatingFullVideo || story.story_video_full_status === 'generating'}
                    variant="outline"
                  >
                    {generatingFullVideo || story.story_video_full_status === 'generating' ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Film className="h-4 w-4 mr-2" />
                    )}
                    {story.story_video_full_status === 'generating'
                      ? 'Generating Full Video…'
                      : (story.story_video_segments as unknown[])?.length
                        ? 'Regenerate Full Video'
                        : 'Generate Full Video'}
                  </Button>
                )}

                {story.video_status === 'ready' && story.status !== 'published' && (
                  <Button onClick={handlePublish} variant="default">
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Publish
                  </Button>
                )}
              </div>

              {/* Audio Preview */}
              {story.video_preview_url && (
                <div className="mt-4">
                  <Label>Preview Audio</Label>
                  <audio controls src={story.video_preview_url} className="w-full mt-1" />
                </div>
              )}

              {/* Preview Video (single 8-second clip) */}
              {story.story_video_url && (
                <div className="mt-4">
                  <Label>Preview Video with Exact Arabic Narration (for approval)</Label>
                  <video
                    ref={previewVideoRef}
                    controls
                    playsInline
                    src={story.story_video_url}
                    onPlay={() => playSyncedAudio(previewVideoRef.current, previewAudioRef.current)}
                    onPause={() => pauseSyncedAudio(previewAudioRef.current)}
                    onSeeked={() => syncAudioToVideo(previewVideoRef.current, previewAudioRef.current)}
                    onEnded={() => {
                      pauseSyncedAudio(previewAudioRef.current);
                      if (previewAudioRef.current) previewAudioRef.current.currentTime = 0;
                    }}
                    className="w-full mt-1 rounded-lg max-h-96 bg-black"
                  />
                  {story.video_preview_url && (
                    <audio ref={previewAudioRef} src={story.video_preview_url} preload="auto" />
                  )}
                  {story.story_video_approved && (
                    <p className="text-xs text-green-600 mt-1">✓ Approved</p>
                  )}
                </div>
              )}
              {story.story_video_status === 'failed' && story.story_video_error && (
                <p className="text-sm text-destructive mt-2">Preview error: {story.story_video_error}</p>
              )}

              {/* Full Video (sequential playback of scene segments) */}
              {(() => {
                const segs = (story.story_video_segments ?? []) as unknown as StoryVideoSegment[];
                if (segs.length === 0) return null;
                const activeSegment = segs[fullVideoIdx];
                return (
                  <div className="mt-4">
                    <Label>
                      Full Video with Exact Arabic Narration — Scene {fullVideoIdx + 1} of {segs.length}
                      {story.story_video_full_status === 'generating' && ' (more scenes generating…)'}
                    </Label>
                    <video
                      ref={fullVideoRef}
                      key={activeSegment?.url}
                      controls
                      autoPlay
                      playsInline
                      src={activeSegment?.url}
                      onPlay={() => playSyncedAudio(fullVideoRef.current, fullAudioRef.current)}
                      onPause={() => pauseSyncedAudio(fullAudioRef.current)}
                      onSeeked={() => syncAudioToVideo(fullVideoRef.current, fullAudioRef.current)}
                      onEnded={() => {
                        pauseSyncedAudio(fullAudioRef.current);
                        if (fullVideoIdx + 1 < segs.length) setFullVideoIdx(fullVideoIdx + 1);
                      }}
                      className="w-full mt-1 rounded-lg max-h-96 bg-black"
                    />
                    {activeSegment?.audio_url && (
                      <audio key={activeSegment.audio_url} ref={fullAudioRef} src={activeSegment.audio_url} preload="auto" />
                    )}
                    {activeSegment?.narration_arabic && (
                      <p className="mt-2 text-sm font-arabic" dir="rtl">{activeSegment.narration_arabic}</p>
                    )}
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {segs.map((_, i) => (
                        <Button
                          key={i}
                          size="sm"
                          variant={i === fullVideoIdx ? 'default' : 'outline'}
                          onClick={() => setFullVideoIdx(i)}
                        >
                          Scene {i + 1}
                        </Button>
                      ))}
                    </div>
                  </div>
                );
              })()}
              {story.story_video_full_status === 'failed' && story.story_video_full_error && (
                <p className="text-sm text-destructive mt-2">Full video error: {story.story_video_full_error}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Story Lines (edit mode) */}
        {isEditing && lines && lines.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Story Lines ({lines.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 max-h-[500px] overflow-y-auto">
                {lines.map((line: AuthenticStoryLine) => (
                  <div key={line.id} className="border rounded-lg p-3 space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">#{line.line_index}</Badge>
                      {line.audio_url && <Badge variant="secondary" className="text-xs">🔊</Badge>}
                    </div>
                    <p className="text-base font-arabic" dir="rtl">{line.arabic_vocalized || line.arabic}</p>
                    {line.dialect_vocalized && (
                      <p className="text-sm font-arabic text-blue-600" dir="rtl">{line.dialect_vocalized}</p>
                    )}
                    <p className="text-sm text-muted-foreground">{line.english}</p>
                    {line.audio_url && (
                      <audio controls src={line.audio_url} className="w-full h-8" />
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
};

export default AdminReadingLibraryForm;
