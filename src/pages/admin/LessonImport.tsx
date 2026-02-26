import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useStages } from '@/hooks/useStages';
import { useLessonImport } from '@/hooks/useLessonImport';
import { parseLessonXlsx, ParsedLessonPlan } from '@/lib/parseLessonXlsx';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, Upload, FileSpreadsheet, Check, BookOpen, Plus } from 'lucide-react';

const LessonImport = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: stages, isLoading: stagesLoading } = useStages();
  const importMutation = useLessonImport();

  const queryClient = useQueryClient();

  const [parsed, setParsed] = useState<ParsedLessonPlan | null>(null);
  const [fileName, setFileName] = useState('');
  const [selectedStageId, setSelectedStageId] = useState('');
  const [autoDetectedStage, setAutoDetectedStage] = useState<string | null>(null);
  const [isCreatingStage, setIsCreatingStage] = useState(false);
  const [newStageName, setNewStageName] = useState('');
  const [newStageNumber, setNewStageNumber] = useState('');
  const [newStageCefr, setNewStageCefr] = useState('');
  const [creatingStage, setCreatingStage] = useState(false);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const result = parseLessonXlsx(buffer);
      setParsed(result);

      // Try to auto-detect stage from the overview
      if (result.overview.stageLabel && stages) {
        const stageMatch = result.overview.stageLabel.match(/Stage\s+(\d+)/);
        if (stageMatch) {
          const stageNum = parseInt(stageMatch[1], 10);
          const matchedStage = stages.find(s => s.stage_number === stageNum);
          if (matchedStage) {
            setSelectedStageId(matchedStage.id);
            setAutoDetectedStage(matchedStage.name);
          }
        }
      }

      toast({ title: 'File parsed successfully', description: `Found ${result.vocabulary.length} vocabulary words.` });
    } catch (err: any) {
      console.error('Parse error:', err);
      toast({ variant: 'destructive', title: 'Failed to parse file', description: err.message });
      setParsed(null);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleImport = async () => {
    if (!parsed || !selectedStageId) return;

    try {
      const lesson = await importMutation.mutateAsync({
        stageId: selectedStageId,
        lessonNumber: parsed.overview.lessonNumber,
        title: parsed.overview.title || `Lesson ${parsed.overview.lessonNumber}`,
        titleArabic: undefined,
        description: parsed.overview.approach,
        durationMinutes: parsed.overview.durationMinutes,
        cefrTarget: parsed.overview.cefrTarget,
        approach: parsed.overview.approach,
        unlockCondition: parsed.overview.unlockCondition,
        vocabulary: parsed.vocabulary,
        lessonSequence: parsed.lessonSequence,
        imageScenes: parsed.imageScenes,
        flashcardSpec: parsed.flashcardSpec,
        realWorldPrompts: parsed.realWorldPrompts,
        designRationale: parsed.designRationale,
        soundSpotlight: parsed.soundSpotlight,
      });

      toast({ title: 'Lesson imported!', description: `"${parsed.overview.title}" with ${parsed.vocabulary.length} words.` });
      navigate('/admin');
    } catch (err: any) {
      console.error('Import error:', err);
      toast({ variant: 'destructive', title: 'Import failed', description: err.message });
    }
  };

  const handleCreateStage = async () => {
    if (!newStageName.trim() || !newStageNumber.trim()) return;

    const stageNum = parseInt(newStageNumber, 10);
    if (isNaN(stageNum) || stageNum < 0) {
      toast({ variant: 'destructive', title: 'Invalid stage number', description: 'Please enter a valid number (0 or above).' });
      return;
    }

    setCreatingStage(true);
    try {
      const maxDisplayOrder = stages?.reduce((max, s) => Math.max(max, s.display_order), -1) ?? -1;

      const { data: newStage, error } = await supabase
        .from('curriculum_stages')
        .insert({
          name: newStageName.trim(),
          stage_number: stageNum,
          cefr_level: newStageCefr.trim() || null,
          display_order: maxDisplayOrder + 1,
        } as any)
        .select()
        .single();

      if (error) throw error;

      await queryClient.invalidateQueries({ queryKey: ['curriculum-stages'] });
      setSelectedStageId(newStage.id);
      setIsCreatingStage(false);
      setNewStageName('');
      setNewStageNumber('');
      setNewStageCefr('');
      toast({ title: 'Stage created', description: `Stage ${stageNum}: ${newStageName.trim()}` });
    } catch (err: any) {
      console.error('Create stage error:', err);
      toast({ variant: 'destructive', title: 'Failed to create stage', description: err.message });
    } finally {
      setCreatingStage(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/admin')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold">Import Lesson Plan</h1>
            <p className="text-sm text-muted-foreground">Upload an xlsx lesson plan to auto-create a lesson with vocabulary</p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-3xl space-y-6">
        {/* Step 1: Upload */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Step 1: Upload Lesson Plan
            </CardTitle>
            <CardDescription>
              Upload an xlsx file with sheets for Lesson Overview, Vocabulary, Lesson Sequence, Image Scenes, Flashcard Spec, and Real-World Prompts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileSelect}
              className="hidden"
            />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="w-full py-8 border-dashed border-2">
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <span>{fileName || 'Click to select xlsx file'}</span>
              </div>
            </Button>
          </CardContent>
        </Card>

        {/* Step 2: Preview parsed data */}
        {parsed && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Step 2: Review Parsed Data
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Overview */}
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <h3 className="font-semibold text-lg">{parsed.overview.title || 'Untitled'}</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground">Stage:</span> {parsed.overview.stageLabel}</div>
                  <div><span className="text-muted-foreground">Lesson:</span> {parsed.overview.lessonLabel}</div>
                  <div><span className="text-muted-foreground">Duration:</span> {parsed.overview.duration}</div>
                  <div><span className="text-muted-foreground">CEFR:</span> {parsed.overview.cefrTarget}</div>
                  <div className="col-span-2"><span className="text-muted-foreground">Approach:</span> {parsed.overview.approach}</div>
                  <div className="col-span-2"><span className="text-muted-foreground">Unlock:</span> {parsed.overview.unlockCondition}</div>
                </div>
              </div>

              {/* Vocabulary preview */}
              <div>
                <h4 className="font-semibold mb-2">Vocabulary ({parsed.vocabulary.length} words)</h4>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-left">#</th>
                        <th className="px-3 py-2 text-right">Arabic</th>
                        <th className="px-3 py-2 text-left">Translit.</th>
                        <th className="px-3 py-2 text-left">English</th>
                        <th className="px-3 py-2 text-left">Category</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.vocabulary.map((v, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2">{v.number}</td>
                          <td className="px-3 py-2 text-right font-arabic text-base" dir="rtl">{v.arabic}</td>
                          <td className="px-3 py-2 text-muted-foreground">{v.transliteration}</td>
                          <td className="px-3 py-2">{v.english}</td>
                          <td className="px-3 py-2 text-muted-foreground">{v.category}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Other sheets summary */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-muted/30 rounded p-2">Lesson Sequence: {parsed.lessonSequence.length} steps</div>
                <div className="bg-muted/30 rounded p-2">Image Scenes: {parsed.imageScenes.length} specs</div>
                <div className="bg-muted/30 rounded p-2">Flashcard Spec: {parsed.flashcardSpec.length} cards</div>
                <div className="bg-muted/30 rounded p-2">Real-World Prompts: {parsed.realWorldPrompts.length} prompts</div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Select stage and import */}
        {parsed && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Check className="h-5 w-5" />
                Step 3: Select Stage & Import
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Curriculum Stage</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsCreatingStage(!isCreatingStage)}
                  >
                    {isCreatingStage ? (
                      'Select existing'
                    ) : (
                      <>
                        <Plus className="mr-1 h-4 w-4" />
                        Create new
                      </>
                    )}
                  </Button>
                </div>
                {autoDetectedStage && !isCreatingStage && (
                  <p className="text-sm text-primary">Auto-detected: {autoDetectedStage}</p>
                )}

                {isCreatingStage ? (
                  <div className="space-y-3 rounded-lg border p-3">
                    <div className="space-y-1">
                      <Label className="text-sm">Stage Number</Label>
                      <Input
                        type="number"
                        min={0}
                        placeholder="e.g. 7"
                        value={newStageNumber}
                        onChange={e => setNewStageNumber(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-sm">Name</Label>
                      <Input
                        placeholder="e.g. Advanced Conversation"
                        value={newStageName}
                        onChange={e => setNewStageName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-sm">CEFR Level (optional)</Label>
                      <Input
                        placeholder="e.g. B2 → C1"
                        value={newStageCefr}
                        onChange={e => setNewStageCefr(e.target.value)}
                      />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="w-full"
                      disabled={!newStageName.trim() || !newStageNumber.trim() || creatingStage}
                      onClick={handleCreateStage}
                    >
                      {creatingStage ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        <>
                          <Plus className="mr-2 h-4 w-4" />
                          Create Stage
                        </>
                      )}
                    </Button>
                  </div>
                ) : (
                  <Select value={selectedStageId} onValueChange={setSelectedStageId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a stage..." />
                    </SelectTrigger>
                    <SelectContent>
                      {stagesLoading ? (
                        <SelectItem value="loading" disabled>Loading stages...</SelectItem>
                      ) : stages && stages.length > 0 ? (
                        stages.map(stage => (
                          <SelectItem key={stage.id} value={stage.id}>
                            Stage {stage.stage_number}: {stage.name}
                            {stage.cefr_level && ` (${stage.cefr_level})`}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="empty" disabled>No stages yet — create one above</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <Button
                className="w-full"
                size="lg"
                disabled={!selectedStageId || importMutation.isPending}
                onClick={handleImport}
              >
                {importMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Import Lesson ({parsed.vocabulary.length} words)
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
};

export default LessonImport;
