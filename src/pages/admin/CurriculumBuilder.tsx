import { useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { useCurriculumChat } from '@/hooks/useCurriculumChat';
import { useCurriculumApproval } from '@/hooks/useCurriculumApproval';
import { ChatSidebar } from '@/components/admin/curriculum-builder/ChatSidebar';
import { ChatWindow } from '@/components/admin/curriculum-builder/ChatWindow';
import { ChatInput, type ChatMode } from '@/components/admin/curriculum-builder/ChatInput';
import { DialectSelector, type GulfDialect } from '@/components/admin/curriculum-builder/DialectSelector';
import { ModelSelector, type LLMModelId } from '@/components/admin/curriculum-builder/ModelSelector';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useStages } from '@/hooks/useStages';

const CurriculumBuilder = () => {
  const navigate = useNavigate();
  const { sessionId: routeSessionId } = useParams<{ sessionId?: string }>();

  const {
    sessions,
    messages,
    activeSessionId,
    setActiveSessionId,
    isGenerating,
    createSession,
    sendMessage,
    archiveSession,
    updateModel,
  } = useCurriculumChat();

  const {
    approveLesson,
    approveVocabulary,
    approveGrammarExercises,
    approveListeningExercises,
    approveReadingPassage,
    approveDailyChallenge,
    approveConversationScenario,
    approveGameSet,
  } = useCurriculumApproval();
  const { data: stages } = useStages();

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newDialect, setNewDialect] = useState<GulfDialect>('Gulf');
  const [newModel, setNewModel] = useState<LLMModelId>('google/gemini-3-flash-preview');
  const [newStageId, setNewStageId] = useState<string>('');
  const [newCefr, setNewCefr] = useState<string>('');

  useEffect(() => {
    if (routeSessionId && routeSessionId !== activeSessionId) {
      setActiveSessionId(routeSessionId);
    }
  }, [routeSessionId, activeSessionId, setActiveSessionId]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const handleNewSession = useCallback(() => {
    setShowNewDialog(true);
  }, []);

  const handleCreateSession = useCallback(() => {
    createSession.mutate(
      {
        dialect: newDialect,
        model: newModel,
        stageId: newStageId && newStageId !== 'any' ? newStageId : undefined,
        cefr: newCefr && newCefr !== 'any' ? newCefr : undefined,
      },
      {
        onSuccess: () => setShowNewDialog(false),
      },
    );
  }, [createSession, newDialect, newModel, newStageId, newCefr]);

  const handleSend = useCallback(
    (content: string, mode?: ChatMode) => {
      sendMessage(content, mode as string, activeSession);
    },
    [sendMessage, activeSession],
  );

  const handleApproveLesson = useCallback(
    (messageId: string, data: Record<string, unknown>, stageId: string) => {
      if (!activeSessionId) return;
      const lesson = data.lesson as Record<string, unknown>;
      approveLesson.mutate({
        messageId,
        sessionId: activeSessionId,
        stageId,
        lessonData: {
          title: lesson.title as string,
          title_arabic: lesson.title_arabic as string | undefined,
          description: lesson.description as string | undefined,
          duration_minutes: lesson.duration_minutes as number | undefined,
          cefr_target: lesson.cefr_target as string | undefined,
          approach: lesson.approach as string | undefined,
          icon: lesson.icon as string | undefined,
          vocabulary: lesson.vocabulary as Array<{
            word_arabic: string;
            word_english: string;
            transliteration?: string;
            category?: string;
            teaching_note?: string;
            image_scene_description?: string;
          }>,
        },
      });
    },
    [activeSessionId, approveLesson],
  );

  const handleApproveVocab = useCallback(
    (messageId: string, data: Record<string, unknown>, lessonId: string, selectedIndices: number[]) => {
      if (!activeSessionId) return;
      const vocabulary = (data.vocabulary as Array<{
        word_arabic: string;
        word_english: string;
        transliteration?: string;
        category?: string;
        teaching_note?: string;
      }>) ?? [];
      const selectedWords = selectedIndices.map((i) => vocabulary[i]).filter(Boolean);
      approveVocabulary.mutate({
        messageId,
        sessionId: activeSessionId,
        lessonId,
        words: selectedWords,
      });
    },
    [activeSessionId, approveVocabulary],
  );

  const handleApproveContent = useCallback(
    (messageId: string, outputType: string, data: Record<string, unknown>) => {
      if (!activeSessionId) return;

      const params = { messageId, sessionId: activeSessionId, data };

      switch (outputType) {
        case 'grammar_preview':
          approveGrammarExercises.mutate(params);
          break;
        case 'listening_preview':
          approveListeningExercises.mutate(params);
          break;
        case 'reading_preview':
          approveReadingPassage.mutate(params);
          break;
        case 'daily_challenge_preview':
          approveDailyChallenge.mutate(params);
          break;
        case 'conversation_preview':
          approveConversationScenario.mutate(params);
          break;
        case 'game_set_preview':
          approveGameSet.mutate(params);
          break;
      }
    },
    [activeSessionId, approveGrammarExercises, approveListeningExercises, approveReadingPassage, approveDailyChallenge, approveConversationScenario, approveGameSet],
  );

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      <header className="border-b bg-card px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/admin')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <Sparkles className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold">Curriculum Builder</h1>
          {activeSession && (
            <span className="text-sm text-muted-foreground">
              — {activeSession.title}
            </span>
          )}
        </div>

        {activeSession && (
          <div className="flex items-center gap-3">
            <DialectSelector
              value={activeSession.target_dialect as GulfDialect}
              onChange={() => {}}
              className="w-[180px] h-9"
            />
            <ModelSelector
              value={activeSession.llm_model as LLMModelId}
              onChange={updateModel}
              className="w-[200px] h-9"
            />
          </div>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        <ChatSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={setActiveSessionId}
          onNewSession={handleNewSession}
          onArchiveSession={(id) => archiveSession.mutate(id)}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          <ChatWindow
            messages={messages}
            isGenerating={isGenerating}
            sessionId={activeSessionId}
            onApproveLesson={handleApproveLesson}
            onApproveVocab={handleApproveVocab}
            onApproveContent={handleApproveContent}
          />

          <ChatInput
            onSend={handleSend}
            disabled={!activeSession}
            isGenerating={isGenerating}
          />
        </div>
      </div>

      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Curriculum Building Session</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Target Dialect</Label>
              <DialectSelector
                value={newDialect}
                onChange={setNewDialect}
                className="w-full"
              />
            </div>

            <div className="space-y-2">
              <Label>AI Model</Label>
              <ModelSelector
                value={newModel}
                onChange={setNewModel}
                className="w-full"
              />
            </div>

            <div className="space-y-2">
              <Label>Target Stage (optional)</Label>
              <Select value={newStageId} onValueChange={setNewStageId}>
                <SelectTrigger>
                  <SelectValue placeholder="Any stage" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any stage</SelectItem>
                  {stages
                    ?.filter((s) => s.stage_number > 0)
                    .map((stage) => (
                      <SelectItem key={stage.id} value={stage.id}>
                        Stage {stage.stage_number}: {stage.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>CEFR Level (optional)</Label>
              <Select value={newCefr} onValueChange={setNewCefr}>
                <SelectTrigger>
                  <SelectValue placeholder="Any level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any level</SelectItem>
                  <SelectItem value="Pre-A1">Pre-A1</SelectItem>
                  <SelectItem value="A1">A1</SelectItem>
                  <SelectItem value="A2">A2</SelectItem>
                  <SelectItem value="B1">B1</SelectItem>
                  <SelectItem value="B2">B2</SelectItem>
                  <SelectItem value="C1">C1</SelectItem>
                  <SelectItem value="C2">C2</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateSession} disabled={createSession.isPending}>
              {createSession.isPending ? 'Creating...' : 'Start Session'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CurriculumBuilder;
