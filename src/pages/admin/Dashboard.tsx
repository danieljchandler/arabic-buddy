import { useNavigate } from 'react-router-dom';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { useTopics } from '@/hooks/useTopics';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, LogOut, BookOpen, Plus, Settings, Mic, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';

const Dashboard = () => {
  const navigate = useNavigate();
  const { user, isAdmin, isRecorder, signOut, loading: authLoading } = useAdminAuth();
  const { data: topics, isLoading: topicsLoading } = useTopics();

  // Get word counts for each topic
  const { data: wordCounts, isError: wordCountsError } = useQuery({
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
    staleTime: 30000, // Cache for 30 seconds
  });

  // Memoize expensive calculations
  const stats = useMemo(() => {
    const totalWords = wordCounts ? Object.values(wordCounts).reduce((a, b) => a + b, 0) : 0;
    const avgWords = topics?.length ? Math.round(totalWords / topics.length) : 0;
    return { totalWords, avgWords };
  }, [wordCounts, topics]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/admin/login');
  };

  const handleCardClick = (path: string) => {
    navigate(path);
  };

  const handleCardKeyDown = (e: React.KeyboardEvent, path: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigate(path);
    }
  };

  if (authLoading || topicsLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  const roleLabel = isAdmin ? 'Admin' : isRecorder ? 'Recorder' : 'User';
  const roleIcon = isAdmin ? '📚' : isRecorder ? '🎙️' : '👤';

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl" role="img" aria-label={roleLabel}>
              {roleIcon}
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold">{roleLabel} Dashboard</h1>
                <span 
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    isAdmin 
                      ? 'bg-primary/20 text-primary' 
                      : 'bg-accent/20 text-accent-foreground'
                  }`}
                >
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
        {/* Error Alert */}
        {wordCountsError && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load word counts. Some statistics may be incorrect.
            </AlertDescription>
          </Alert>
        )}

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
              <CardTitle className="text-4xl">{stats.totalWords}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Average Words/Topic</CardDescription>
              <CardTitle className="text-4xl">{stats.avgWords}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Quick Actions - Different for admin vs recorder */}
        <div className={`grid grid-cols-1 ${isAdmin ? 'md:grid-cols-2' : ''} gap-4 mb-8`}>
          {isAdmin && (
            <>
              <Card 
                className="cursor-pointer hover:shadow-lg transition-shadow focus-within:ring-2 focus-within:ring-primary" 
                onClick={() => handleCardClick('/admin/topics')}
                onKeyDown={(e) => handleCardKeyDown(e, '/admin/topics')}
                tabIndex={0}
                role="button"
                aria-label="Manage Topics"
              >
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-primary/10 rounded-full p-4">
                      <Settings className="h-8 w-8 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Manage Topics</h3>
                      <p className="text-sm text-muted-foreground">Add, edit, or remove vocabulary topics</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card 
                className="cursor-pointer hover:shadow-lg transition-shadow focus-within:ring-2 focus-within:ring-accent" 
                onClick={() => handleCardClick('/admin/topics/new')}
                onKeyDown={(e) => handleCardKeyDown(e, '/admin/topics/new')}
                tabIndex={0}
                role="button"
                aria-label="Add New Topic"
              >
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-accent/10 rounded-full p-4">
                      <Plus className="h-8 w-8 text-accent" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Add New Topic</h3>
                      <p className="text-sm text-muted-foreground">Create a new vocabulary category</p>
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
                    <p className="text-sm text-muted-foreground">
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
                    className="cursor-pointer hover:shadow-md transition-shadow focus-within:ring-2 focus-within:ring-primary"
                    onClick={() => handleCardClick(`/admin/topics/${topic.id}/words`)}
                    onKeyDown={(e) => handleCardKeyDown(e, `/admin/topics/${topic.id}/words`)}
                    tabIndex={0}
                    role="button"
                    aria-label={`View ${topic.name} topic with ${wordCounts?.[topic.id] || 0} words`}
                  >
                    <CardContent className="pt-4">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl" role="img" aria-label={topic.name}>
                          {topic.icon}
                        </span>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold truncate">{topic.name}</h4>
                          <p className="text-sm text-muted-foreground truncate">{topic.name_arabic}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {wordCounts?.[topic.id] || 0} word{wordCounts?.[topic.id] !== 1 ? 's' : ''}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                {isAdmin ? (
                  <>
                    <p className="mb-2">No topics yet. Create your first topic to get started!</p>
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
