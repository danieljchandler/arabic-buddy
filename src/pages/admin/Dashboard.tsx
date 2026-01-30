import { useNavigate } from 'react-router-dom';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { useTopics } from '@/hooks/useTopics';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, LogOut, BookOpen, Plus, Settings, Mic } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import lahjaIcon from '@/assets/lahja-icon.png';

const Dashboard = () => {
  const navigate = useNavigate();
  const { user, isAdmin, isRecorder, role, signOut, loading: authLoading } = useAdminAuth();
  const { data: topics, isLoading: topicsLoading } = useTopics();

  // Get word counts for each topic
  const { data: wordCounts } = useQuery({
    queryKey: ['word-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vocabulary_words')
        .select('topic_id');

      if (error) throw error;

      const counts: Record<string, number> = {};
      data?.forEach(word => {
        counts[word.topic_id] = (counts[word.topic_id] || 0) + 1;
      });
      return counts;
    },
  });

  const handleSignOut = async () => {
    await signOut();
    navigate('/admin/login');
  };

  if (authLoading || topicsLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const totalWords = wordCounts ? Object.values(wordCounts).reduce((a, b) => a + b, 0) : 0;
  const roleLabel = isAdmin ? 'Admin' : isRecorder ? 'Recorder' : '';

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <img src={lahjaIcon} alt="Lahja" className="h-10 w-10" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold">{roleLabel} Dashboard</h1>
                <span className={`text-xs px-2 py-0.5 rounded-full ${isAdmin ? 'bg-primary/20 text-primary' : 'bg-accent/20 text-accent-foreground'}`}>
                  {roleLabel}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate('/')}>
              <BookOpen className="h-4 w-4 mr-2" />
              View App
            </Button>
            <Button variant="outline" onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Topics</CardDescription>
              <CardTitle className="text-4xl">{topics?.length || 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Words</CardDescription>
              <CardTitle className="text-4xl">{totalWords}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Average Words/Topic</CardDescription>
              <CardTitle className="text-4xl">
                {topics?.length ? Math.round(totalWords / topics.length) : 0}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Quick Actions - Different for admin vs recorder */}
        <div className={`grid grid-cols-1 ${isAdmin ? 'md:grid-cols-2' : ''} gap-4 mb-8`}>
          {isAdmin && (
            <>
              <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => navigate('/admin/topics')}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-primary/10 rounded-full p-4">
                      <Settings className="h-8 w-8 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Manage Topics</h3>
                      <p className="text-muted-foreground">Add, edit, or remove vocabulary topics</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => navigate('/admin/topics/new')}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-accent/10 rounded-full p-4">
                      <Plus className="h-8 w-8 text-accent" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Add New Topic</h3>
                      <p className="text-muted-foreground">Create a new vocabulary category</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {isRecorder && !isAdmin && (
            <Card className="bg-accent/5 border-accent/20">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="bg-accent/10 rounded-full p-4">
                    <Mic className="h-8 w-8 text-accent" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Recorder Access</h3>
                    <p className="text-muted-foreground">
                      You can add new words and record audio. Click any topic below to add or edit words.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Topics List */}
        <Card>
          <CardHeader>
            <CardTitle>Topics Overview</CardTitle>
            <CardDescription>
              {isAdmin 
                ? 'Click a topic to manage its vocabulary words' 
                : 'Click a topic to add words or record audio'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {topics && topics.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {topics.map((topic) => (
                  <Card
                    key={topic.id}
                    className="cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => navigate(`/admin/topics/${topic.id}/words`)}
                  >
                    <CardContent className="pt-4">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl">{topic.icon}</span>
                        <div>
                          <h4 className="font-semibold">{topic.name}</h4>
                          <p className="text-sm text-muted-foreground font-arabic">{topic.name_arabic}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {wordCounts?.[topic.id] || 0} words
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                {isAdmin ? (
                  <>
                    <p>No topics yet. Create your first topic to get started.</p>
                    <Button className="mt-4" onClick={() => navigate('/admin/topics/new')}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Topic
                    </Button>
                  </>
                ) : (
                  <p>No topics available. Ask an admin to create topics first.</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default Dashboard;
