import { useNavigate } from 'react-router-dom';
import { useStages } from '@/hooks/useStages';
import { useAllLessons } from '@/hooks/useLessons';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, ArrowLeft, Upload, ChevronRight } from 'lucide-react';

const Stages = () => {
  const navigate = useNavigate();
  const { isAdmin } = useAdminAuth();
  const { data: stages, isLoading: stagesLoading } = useStages();
  const { data: allLessons, isLoading: lessonsLoading } = useAllLessons();

  const isLoading = stagesLoading || lessonsLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Group lessons by stage
  const lessonsByStage = new Map<string, typeof allLessons>();
  allLessons?.forEach(lesson => {
    const existing = lessonsByStage.get('default') || [];
    existing.push(lesson);
    lessonsByStage.set('default', existing);
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/admin')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-bold">Curriculum</h1>
          </div>
          {isAdmin && (
            <Button onClick={() => navigate('/admin/lessons/import')}>
              <Upload className="h-4 w-4 mr-2" />
              Import Lesson Plan
            </Button>
          )}
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6">
        {stages?.map(stage => {
          const stageLessons = lessonsByStage.get(stage.id) || [];

          // Skip the legacy stage if it has no lessons
          if (stage.stage_number === 0 && stageLessons.length === 0) return null;

          return (
            <Card key={stage.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>
                      {stage.stage_number > 0 ? `Stage ${stage.stage_number}: ` : ''}
                      {stage.name}
                      {stage.name_arabic && (
                        <span className="text-muted-foreground font-arabic mr-2"> · {stage.name_arabic}</span>
                      )}
                    </CardTitle>
                    {stage.cefr_level && (
                      <CardDescription>{stage.cefr_level}</CardDescription>
                    )}
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {stageLessons.length} {stageLessons.length === 1 ? 'lesson' : 'lessons'}
                  </span>
                </div>
                {stage.description && (
                  <p className="text-sm text-muted-foreground mt-1">{stage.description}</p>
                )}
              </CardHeader>
              <CardContent>
                {stageLessons.length > 0 ? (
                  <div className="space-y-2">
                    {stageLessons.map(lesson => (
                      <button
                        key={lesson.id}
                        className="w-full flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors text-left"
                        onClick={() => navigate(`/admin/topics/${lesson.id}/words`)}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{lesson.icon}</span>
                          <div>
                            <p className="font-medium">
                              Lesson {lesson.display_order}: {lesson.name}
                            </p>
                            {lesson.name_arabic && (
                              <p className="text-sm text-muted-foreground font-arabic">{lesson.name_arabic}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">
                            {lesson.word_count || 0} words
                          </span>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No lessons yet. Import a lesson plan to get started.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </main>
    </div>
  );
};

export default Stages;
