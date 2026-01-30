import { useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, Plus, Trash2, Mic, Check, X, Play, Pause, Upload, FileSpreadsheet, ClipboardPaste } from 'lucide-react';
import { InlineAudioRecorder } from '@/components/admin/InlineAudioRecorder';

interface WordEntry {
  id: string;
  wordArabic: string;
  wordEnglish: string;
  audioUrl: string | null;
  audioFile: File | null;
  isRecording: boolean;
}

const createEmptyEntry = (): WordEntry => ({
  id: crypto.randomUUID(),
  wordArabic: '',
  wordEnglish: '',
  audioUrl: null,
  audioFile: null,
  isRecording: false,
});

const BulkWordImport = () => {
  const navigate = useNavigate();
  const { topicId } = useParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const [entries, setEntries] = useState<WordEntry[]>([
    createEmptyEntry(),
    createEmptyEntry(),
    createEmptyEntry(),
  ]);
  const [pasteText, setPasteText] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  // Fetch topic info
  const { data: topic } = useQuery({
    queryKey: ['topic-info', topicId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('topics')
        .select('name, name_arabic, icon, gradient')
        .eq('id', topicId)
        .single();

      if (error) throw error;
      return data;
    },
  });

  // Upload audio file helper
  const uploadAudioFile = async (file: File): Promise<string> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${crypto.randomUUID()}.${fileExt}`;
    const filePath = `${topicId}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('flashcard-audio')
      .upload(filePath, file);

    if (uploadError) throw uploadError;

    const { data } = supabase.storage
      .from('flashcard-audio')
      .getPublicUrl(filePath);

    return data.publicUrl;
  };

  const mutation = useMutation({
    mutationFn: async () => {
      setIsUploading(true);
      
      // Filter valid entries
      const validEntries = entries.filter(
        (e) => e.wordArabic.trim() && e.wordEnglish.trim()
      );

      if (validEntries.length === 0) {
        throw new Error('No valid entries to save');
      }

      // Upload any audio files first
      const entriesWithAudio = await Promise.all(
        validEntries.map(async (entry) => {
          if (entry.audioFile && !entry.audioUrl) {
            const url = await uploadAudioFile(entry.audioFile);
            return { ...entry, audioUrl: url };
          }
          return entry;
        })
      );

      // Get current max display_order
      const { data: maxOrder } = await supabase
        .from('vocabulary_words')
        .select('display_order')
        .eq('topic_id', topicId)
        .order('display_order', { ascending: false })
        .limit(1)
        .single();

      let nextOrder = (maxOrder?.display_order ?? -1) + 1;

      // Insert all entries
      const wordsToInsert = entriesWithAudio.map((entry) => ({
        topic_id: topicId,
        word_arabic: entry.wordArabic.trim(),
        word_english: entry.wordEnglish.trim(),
        audio_url: entry.audioUrl,
        image_url: null,
        display_order: nextOrder++,
      }));

      const { error } = await supabase
        .from('vocabulary_words')
        .insert(wordsToInsert);

      if (error) throw error;

      return validEntries.length;
    },
    onSuccess: (count) => {
      setIsUploading(false);
      queryClient.invalidateQueries({ queryKey: ['topic', topicId] });
      toast({ title: `${count} words added successfully!` });
      navigate(`/admin/topics/${topicId}/words`);
    },
    onError: (error: any) => {
      setIsUploading(false);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message,
      });
    },
  });

  const updateEntry = (id: string, field: keyof WordEntry, value: any) => {
    setEntries((prev) =>
      prev.map((entry) =>
        entry.id === id ? { ...entry, [field]: value } : entry
      )
    );
  };

  const removeEntry = (id: string) => {
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
  };

  const addEntry = () => {
    setEntries((prev) => [...prev, createEmptyEntry()]);
  };

  const addMultipleEntries = (count: number) => {
    const newEntries = Array.from({ length: count }, () => createEmptyEntry());
    setEntries((prev) => [...prev, ...newEntries]);
  };

  // Parse pasted text (supports tab-separated and comma-separated)
  const parsePastedText = () => {
    if (!pasteText.trim()) return;

    const lines = pasteText.trim().split('\n');
    const newEntries: WordEntry[] = [];

    for (const line of lines) {
      // Try tab first, then comma
      let parts = line.split('\t');
      if (parts.length < 2) {
        parts = line.split(',');
      }

      if (parts.length >= 2) {
        const arabic = parts[0].trim();
        const english = parts[1].trim();
        
        if (arabic && english) {
          newEntries.push({
            id: crypto.randomUUID(),
            wordArabic: arabic,
            wordEnglish: english,
            audioUrl: null,
            audioFile: null,
            isRecording: false,
          });
        }
      }
    }

    if (newEntries.length > 0) {
      setEntries((prev) => {
        // Remove empty entries at the end, then add new ones
        const filtered = prev.filter(e => e.wordArabic.trim() || e.wordEnglish.trim());
        return [...filtered, ...newEntries];
      });
      setPasteText('');
      toast({ title: `${newEntries.length} words imported from paste` });
    } else {
      toast({
        variant: 'destructive',
        title: 'No valid data found',
        description: 'Make sure each line has Arabic and English separated by tab or comma',
      });
    }
  };

  // Handle CSV/Excel file upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const lines = text.trim().split('\n');
    const newEntries: WordEntry[] = [];

    // Skip header row if it looks like one
    const startIndex = lines[0]?.toLowerCase().includes('arabic') || 
                       lines[0]?.toLowerCase().includes('english') ? 1 : 0;

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      // Handle CSV with potential quotes
      let parts: string[] = [];
      
      if (line.includes('"')) {
        // CSV with quotes - simple parsing
        const regex = /(?:^|,)("(?:[^"]*(?:""[^"]*)*)"|[^,]*)/g;
        let match;
        while ((match = regex.exec(line)) !== null) {
          let value = match[1] || '';
          if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1).replace(/""/g, '"');
          }
          parts.push(value.trim());
        }
      } else {
        // Tab or comma separated
        parts = line.includes('\t') ? line.split('\t') : line.split(',');
      }

      if (parts.length >= 2) {
        const arabic = parts[0].trim();
        const english = parts[1].trim();
        
        if (arabic && english) {
          newEntries.push({
            id: crypto.randomUUID(),
            wordArabic: arabic,
            wordEnglish: english,
            audioUrl: null,
            audioFile: null,
            isRecording: false,
          });
        }
      }
    }

    if (newEntries.length > 0) {
      setEntries((prev) => {
        const filtered = prev.filter(e => e.wordArabic.trim() || e.wordEnglish.trim());
        return [...filtered, ...newEntries];
      });
      toast({ title: `${newEntries.length} words imported from file` });
    } else {
      toast({
        variant: 'destructive',
        title: 'No valid data found',
        description: 'Make sure your file has Arabic in column 1 and English in column 2',
      });
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Handle bulk audio file upload
  const handleAudioFilesUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const audioMap = new Map<string, File>();
    
    // Create a map of filename (without extension) -> file
    for (const file of Array.from(files)) {
      const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '').toLowerCase();
      audioMap.set(nameWithoutExt, file);
    }

    // Match audio files to entries by Arabic or English word
    let matchCount = 0;
    setEntries((prev) =>
      prev.map((entry) => {
        const arabicKey = entry.wordArabic.trim().toLowerCase();
        const englishKey = entry.wordEnglish.trim().toLowerCase();
        
        const matchedFile = audioMap.get(arabicKey) || audioMap.get(englishKey);
        
        if (matchedFile && !entry.audioUrl && !entry.audioFile) {
          matchCount++;
          return { ...entry, audioFile: matchedFile };
        }
        return entry;
      })
    );

    toast({
      title: matchCount > 0 
        ? `${matchCount} audio files matched to words`
        : 'No matches found',
      description: matchCount === 0 
        ? 'Name audio files with the Arabic or English word (e.g., "apple.mp3" or "تفاحة.mp3")'
        : undefined,
    });

    if (audioInputRef.current) {
      audioInputRef.current.value = '';
    }
  };

  const validCount = entries.filter(
    (e) => e.wordArabic.trim() && e.wordEnglish.trim()
  ).length;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(`/admin/topics/${topicId}/words`)}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-2xl">{topic?.icon}</span>
              <div>
                <h1 className="text-xl font-bold">Bulk Import</h1>
                <p className="text-sm text-muted-foreground">{topic?.name}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {validCount} valid {validCount === 1 ? 'word' : 'words'}
            </span>
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || validCount === 0 || isUploading}
            >
              {mutation.isPending || isUploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isUploading ? 'Uploading...' : 'Saving...'}
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Save All ({validCount})
                </>
              )}
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-4xl">
        {/* Import Options */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Import Words</CardTitle>
            <CardDescription>
              Add words manually, paste from spreadsheet, or upload a CSV/Excel file
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="manual" className="w-full">
              <TabsList className="grid w-full grid-cols-3 mb-4">
                <TabsTrigger value="manual">Manual Entry</TabsTrigger>
                <TabsTrigger value="paste">Paste Data</TabsTrigger>
                <TabsTrigger value="file">Upload File</TabsTrigger>
              </TabsList>

              <TabsContent value="manual" className="space-y-3">
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" size="sm" onClick={addEntry}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add 1 Row
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => addMultipleEntries(5)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add 5 Rows
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => addMultipleEntries(10)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add 10 Rows
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="paste" className="space-y-3">
                <div className="text-sm text-muted-foreground mb-2">
                  Paste data from Excel or Google Sheets. Each row should have Arabic and English separated by tab or comma.
                </div>
                <Textarea
                  placeholder="أحمر	Red
أزرق	Blue
أخضر	Green"
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  rows={6}
                  className="font-mono"
                  dir="auto"
                />
                <Button onClick={parsePastedText} disabled={!pasteText.trim()}>
                  <ClipboardPaste className="mr-2 h-4 w-4" />
                  Import Pasted Data
                </Button>
              </TabsContent>

              <TabsContent value="file" className="space-y-4">
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium mb-2">Word List (CSV/TXT)</p>
                    <p className="text-sm text-muted-foreground mb-2">
                      Upload a CSV file with Arabic in column 1 and English in column 2
                    </p>
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept=".csv,.txt,.tsv"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                      <FileSpreadsheet className="mr-2 h-4 w-4" />
                      Upload Word List
                    </Button>
                  </div>

                  <div className="border-t pt-3">
                    <p className="text-sm font-medium mb-2">Audio Files (Optional)</p>
                    <p className="text-sm text-muted-foreground mb-2">
                      Upload audio files named after the words (e.g., "apple.mp3" or "تفاحة.mp3")
                    </p>
                    <input
                      type="file"
                      ref={audioInputRef}
                      accept="audio/*"
                      multiple
                      onChange={handleAudioFilesUpload}
                      className="hidden"
                    />
                    <Button 
                      variant="outline" 
                      onClick={() => audioInputRef.current?.click()}
                      disabled={entries.filter(e => e.wordArabic.trim()).length === 0}
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      Upload Audio Files
                    </Button>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Word entries */}
        <div className="space-y-3">
          {entries.map((entry, index) => (
            <Card
              key={entry.id}
              className={`transition-opacity ${
                entry.wordArabic.trim() && entry.wordEnglish.trim()
                  ? 'border-primary/30'
                  : 'opacity-80'
              }`}
            >
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <span className="text-sm text-muted-foreground font-mono w-8 pt-2.5">
                    {index + 1}.
                  </span>

                  <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Input
                      placeholder="Arabic word (e.g., أحمر)"
                      value={entry.wordArabic}
                      onChange={(e) =>
                        updateEntry(entry.id, 'wordArabic', e.target.value)
                      }
                      dir="rtl"
                      className="text-lg"
                    />
                    <Input
                      placeholder="English word (e.g., Red)"
                      value={entry.wordEnglish}
                      onChange={(e) =>
                        updateEntry(entry.id, 'wordEnglish', e.target.value)
                      }
                      className="text-lg"
                    />
                  </div>

                  {/* Audio section */}
                  <div className="flex items-center gap-2">
                    {entry.isRecording ? (
                      <InlineAudioRecorder
                        onSave={(url) => {
                          updateEntry(entry.id, 'audioUrl', url);
                          updateEntry(entry.id, 'isRecording', false);
                        }}
                        onCancel={() => updateEntry(entry.id, 'isRecording', false)}
                      />
                    ) : entry.audioUrl ? (
                      <div className="flex items-center gap-1">
                        <AudioPreview url={entry.audioUrl} />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => updateEntry(entry.id, 'audioUrl', null)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : entry.audioFile ? (
                      <div className="flex items-center gap-1">
                        <AudioFilePreview file={entry.audioFile} />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => updateEntry(entry.id, 'audioFile', null)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-9 w-9"
                        onClick={() => updateEntry(entry.id, 'isRecording', true)}
                        title="Record audio"
                      >
                        <Mic className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  {/* Delete */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground hover:text-destructive"
                    onClick={() => removeEntry(entry.id)}
                    disabled={entries.length <= 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Bottom actions */}
        <div className="mt-6 flex justify-between">
          <Button variant="outline" onClick={() => addMultipleEntries(5)}>
            <Plus className="mr-2 h-4 w-4" />
            Add More Rows
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || validCount === 0 || isUploading}
            size="lg"
          >
            {mutation.isPending || isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isUploading ? 'Uploading...' : 'Saving...'}
              </>
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" />
                Save All ({validCount})
              </>
            )}
          </Button>
        </div>
      </main>
    </div>
  );
};

// Audio preview for uploaded URL
const AudioPreview = ({ url }: { url: string }) => {
  const [isPlaying, setIsPlaying] = useState(false);

  const togglePlay = () => {
    const audio = new Audio(url);
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      audio.play();
      audio.onended = () => setIsPlaying(false);
      setIsPlaying(true);
    }
  };

  return (
    <Button
      variant="outline"
      size="icon"
      className="h-9 w-9 text-success"
      onClick={togglePlay}
      title="Play recording"
    >
      {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
    </Button>
  );
};

// Audio preview for local file
const AudioFilePreview = ({ file }: { file: File }) => {
  const [isPlaying, setIsPlaying] = useState(false);

  const togglePlay = () => {
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      audio.play();
      audio.onended = () => {
        setIsPlaying(false);
        URL.revokeObjectURL(url);
      };
      setIsPlaying(true);
    }
  };

  return (
    <Button
      variant="outline"
      size="icon"
      className="h-9 w-9 text-primary"
      onClick={togglePlay}
      title={`Play ${file.name}`}
    >
      {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
    </Button>
  );
};

export default BulkWordImport;
