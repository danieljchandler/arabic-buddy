import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useBibleAccess } from "@/hooks/useBibleAccess";
import { supabase } from "@/integrations/supabase/client";
import { useReviewStats } from "@/hooks/useReview";
import { useUserVocabularyDueCount } from "@/hooks/useUserVocabulary";
import { useSRSStats } from "@/hooks/useSRSStats";
import { useDiscoverVideos } from "@/hooks/useDiscoverVideos";
import { Button } from "@/components/design-system";
import { Settings, Brain, LogIn, LogOut, Mic, BookOpen, Sparkles, GraduationCap, Laugh, Play, ChevronRight, Twitter, MessageCircleQuestion, Compass, MessageSquare, MessageCircle, Globe2, Headphones, Trophy, FileText, Flame, BarChart3, PenTool, Gamepad2, Users, Swords, Newspaper, BookMarked, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { XPDisplay, StreakDisplay, WeeklyGoalCard, AchievementsGrid } from "@/components/gamification";
import lahjaLogo from "@/assets/lahja-logo.png";
import { useState } from "react";
import { NotificationBell } from "@/components/NotificationBell";
import { useDialect, DialectModule } from "@/contexts/DialectContext";
import { PhraseOfTheDay } from "@/components/PhraseOfTheDay";
import { useHomeLayout } from "@/hooks/useHomeLayout";
import { HomeSectionId, isSectionVisible } from "@/lib/homeLayout";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { DiscoverPreviewCard } from "@/components/discover/DiscoverPreviewCard";
import { InfoHint } from "@/components/InfoHint";
import { useAlphabetProgress } from "@/hooks/useAlphabetProgress";
import { ARABIC_LETTERS } from "@/data/arabicAlphabet";
import { DailyLetterGoalRing } from "@/components/alphabet/DailyLetterGoalRing";

const TILE_HINTS: Record<string, { title: string; body: string }> = {
  "today": { title: "Start today", body: "Your daily learning queue — reviews, a challenge, listening and reading, all picked for today. The fastest way to grow your streak." },
  "review": { title: "Smart review", body: "Spaced repetition surfaces only the words you're about to forget. Quick taps now mean rock-solid long-term memory." },
  "my-words": { title: "My Words", body: "Every word you've saved — with native audio, images, and SRS scheduling. Your personal vocabulary deck, on autopilot." },
  "new-words": { title: "Learn new words", body: "Pick up fresh vocabulary at your level with audio, images, and quick example sentences." },
  "discover": { title: "Discover videos", body: "Real native videos with synced subtitles. Tap any word to learn it, then save it to review later." },
  "tutor-upload": { title: "Tutor Upload", body: "Drop in audio from your tutor and we'll auto-extract the new words and turn them into flashcards." },
  "pronunciation": { title: "Pronunciation Practice", body: "Record yourself and get instant AI scoring on each syllable — like a patient native speaker in your pocket." },
  "conversation": { title: "Conversation Simulator", body: "Free-form chat with realistic native voices. Practice ordering coffee, small talk, anything — judgment-free." },
  "set-phrases": { title: "Set Phrases", body: "Greetings, weddings, Eid wishes, condolences — the expressions natives use on autopilot. Voice-quiz yourself." },
  "stories": { title: "Interactive Stories", body: "Choose-your-adventure tales in Arabic. Comprehension-building that actually feels like a game." },
  "grammar": { title: "Grammar Drills", body: "AI-generated drills for conjugation, pronouns, and tricky structures — bite-sized and personalized." },
  "vocab-games": { title: "Vocabulary Games", body: "Word matching, memory cards, fill-in-the-blanks — sneak in extra practice without it feeling like work." },
  "listening": { title: "Listening Practice", body: "Dictation, comprehension drills, and speed-listening — train your ear on real dialect audio." },
  "reading": { title: "Reading Practice", body: "Short passages with tap-to-translate. Build comprehension without ever reaching for a dictionary." },
  "picture-scenes": { title: "Picture Scenes", body: "Themed images with tappable hotspots. Learn whole rooms-worth of vocabulary in a single scene." },
  "bible": { title: "Bible Reading", body: "Read Scripture in Arabic with tap-to-translate, dialect audio, and built-in vocabulary tools." },
  "souq-news": { title: "Souq News", body: "Today's headlines retold like a friend gossiping in dialect. Casual Arabic + current events." },
  "dialect-compare": { title: "Dialect Compare", body: "See the same word across Gulf, Egyptian and more — perfect for travelers and curious linguists." },
  "meme": { title: "Meme Analyzer", body: "Paste an Arabic meme and we'll break it down: the text, the joke, the slang, the cultural reference." },
  "learn-from-x": { title: "Learn from X", body: "Drop an X (Twitter) post link and we'll turn it into a mini lesson — vocab, grammar, the works." },
  "how-do-i-say": { title: "How do I say…?", body: "Type any phrase in English and get a natural, dialect-accurate translation with audio." },
  "culture": { title: "Culture Guide", body: "Ask 'what do I do?' for any social situation and get culturally-appropriate Gulf or Egyptian advice." },
  "transcribe": { title: "Transcribe Audio", body: "Upload Arabic audio or video and get an editable, word-accurate transcript with translations." },
  "my-transcriptions": { title: "My Transcriptions", body: "Every transcript you've saved, ready to revisit and turn into flashcards." },
  "daily-challenge": { title: "Daily Challenge", body: "A fresh bite-sized mission every day. Finish it for bonus XP and your streak multiplier." },
  "leaderboard": { title: "Leaderboard", body: "See where you stack up against other learners this week. Friendly competition, real motivation." },
  "battles": { title: "Vocab Battles", body: "Live head-to-head vocabulary duels. Fast, fun, and the best way to test if you actually know your words." },
  "friends": { title: "Friends", body: "Add friends, share progress, and cheer each other's streaks." },
  "analytics": { title: "Learning Analytics", body: "Beautiful charts of your progress: words learned, retention rate, time spent, dialect coverage." },
  "my-path": { title: "My Path", body: "An adaptive curriculum built around your CEFR level and goals. Always knows what to teach you next." },
  "placement": { title: "Placement Quiz", body: "20 adaptive questions to pin down your exact CEFR level so every lesson lands in your sweet spot." },
};

const DIALECT_MODULES: { id: DialectModule; label: string; flag: string }[] = [
  { id: 'Gulf', label: 'Gulf Arabic', flag: '🌊' },
  { id: 'Egyptian', label: 'Egyptian Arabic', flag: '🇪🇬' },
  { id: 'Yemeni', label: 'Yemeni Arabic', flag: '🇾🇪' },
];

const Index = () => {
  const navigate = useNavigate();
  const { activeDialect, setDialect } = useDialect();
  const {
    user,
    isAuthenticated,
    signOut,
    loading: authLoading
  } = useAuth();
  const { data: myWordsStats } = useUserVocabularyDueCount();
  const { data: stats } = useReviewStats();
  const { data: srsStats } = useSRSStats();
  const { data: discoverVideos } = useDiscoverVideos({ dialect: activeDialect });
  const { hasAccess: hasBibleAccess } = useBibleAccess();

  const { state: homeLayout } = useHomeLayout();
  const { progress: alphabetProgress, masteredCount: alphabetMastered, isUnlocked: alphabetUnlocked } = useAlphabetProgress();
  const currentLetter = isAuthenticated
    ? ARABIC_LETTERS.find((l) => alphabetUnlocked(l.order_index) && !alphabetProgress[l.code]?.mastered_at) ?? ARABIC_LETTERS[0]
    : null;
  const { isAdmin } = useAdminAuth();
  const [previewIndex, setPreviewIndex] = useState(0);
  const [placementLevel, setPlacementLevel] = useState<string | null>(null);
  const previewVideos = discoverVideos?.slice(0, 5) ?? [];
  const previewVideo = previewVideos[previewIndex];

  // Check onboarding + placement status for authenticated users (per active dialect)
  useEffect(() => {
    if (!isAuthenticated || authLoading || !user) return;
    const checkProfile = async () => {
      const { data } = await supabase
        .from('profiles' as any)
        .select('onboarding_completed, placement_level, placement_level_gulf, placement_level_egyptian, placement_level_yemeni')
        .eq('user_id', user.id)
        .maybeSingle();
      if (data && !(data as any).onboarding_completed) {
        navigate('/onboarding');
      }
      if (data) {
        const d = activeDialect.toLowerCase();
        const perDialect = (data as any)[`placement_level_${d}`];
        const fallback = activeDialect === 'Gulf' ? (data as any).placement_level : null;
        setPlacementLevel(perDialect || fallback || null);
      }
    };
    checkProfile();
  }, [isAuthenticated, authLoading, user, navigate, activeDialect]);
  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <AppShell>

      {/* Top bar with logo and auth */}
      <div className="flex items-center justify-between mb-4">
        <img src={lahjaLogo} alt="Lahja" className="h-20" />
        
        <div className="flex items-center gap-3">
          {!authLoading && (isAuthenticated ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground hidden sm:inline">
                {user?.email?.split("@")[0]}
              </span>
              <Button variant="ghost" size="icon" onClick={handleSignOut} className="text-muted-foreground hover:text-foreground" title="Sign out">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => navigate("/auth")} className="text-muted-foreground hover:text-foreground">
              <LogIn className="h-4 w-4 mr-1.5" />
              Login
            </Button>
          ))}

          {isAuthenticated && (
            <>
              <NotificationBell />
              <Button variant="ghost" size="icon" onClick={() => navigate("/settings")} className="text-muted-foreground hover:text-foreground" title="Settings">
                <Settings className="h-4 w-4" />
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin")} className="text-muted-foreground/50 hover:text-muted-foreground" title="Admin">
            <GraduationCap className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Dialect Module Switcher */}
      <div className="flex gap-2 mb-4">
        {DIALECT_MODULES.map((mod) => (
          <button
            key={mod.id}
            onClick={() => setDialect(mod.id)}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border-2 transition-all duration-200 font-medium text-sm",
              activeDialect === mod.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:border-primary/30"
            )}
          >
            <span className="text-lg">{mod.flag}</span>
            <span>{mod.label}</span>
          </button>
        ))}
      </div>

      {(() => {
        const sections: Partial<Record<HomeSectionId, React.ReactNode>> = {
          "phrase-of-the-day": <PhraseOfTheDay key="phrase-of-the-day" />,

          "placement-banner":
            isAuthenticated && !placementLevel ? (
              <button
                key="placement-banner"
                onClick={() => navigate("/placement")}
                className={cn(
                  "w-full p-5 rounded-2xl",
                  "bg-gradient-to-br from-primary/15 via-accent/10 to-primary/5",
                  "border-2 border-primary/30",
                  "flex items-start gap-4 text-left",
                  "transition-all duration-200",
                  "hover:border-primary/50 hover:shadow-lg active:scale-[0.99]",
                  "relative overflow-hidden"
                )}
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/2" />
                <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
                  <GraduationCap className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0 relative z-10">
                  <p className="font-bold text-foreground text-base mb-1 flex items-center gap-1.5">Take the Placement Quiz<InfoHint title={TILE_HINTS.placement.title} body={TILE_HINTS.placement.body} /></p>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Answer 20 adaptive questions so we can tailor lessons, vocabulary, and exercises to your exact level.
                  </p>
                  <div className="flex items-center gap-2 mt-2.5">
                    <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">~5 minutes</Badge>
                    <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">CEFR A1–C2</Badge>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-primary shrink-0 mt-1" />
              </button>
            ) : null,

          "gamification": isAuthenticated ? (
            <div key="gamification" className="space-y-3">
              <button
                onClick={() => navigate("/today")}
                className="w-full p-4 rounded-2xl bg-gradient-to-br from-primary/15 via-primary/10 to-transparent border-2 border-primary/30 flex items-center gap-3 transition-all hover:border-primary/50 hover:shadow-md active:scale-[0.99] text-left"
              >
                <div className="h-12 w-12 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-foreground flex items-center gap-1.5" style={{ fontFamily: "'Montserrat', sans-serif" }}>Start today<InfoHint title={TILE_HINTS.today.title} body={TILE_HINTS.today.body} /></p>
                  <p className="text-xs text-muted-foreground mt-0.5">Your daily learning queue</p>
                </div>
                <ChevronRight className="h-5 w-5 text-primary shrink-0" />
              </button>
              {currentLetter && (
                <button
                  onClick={() => navigate(alphabetMastered === 0 ? "/alphabet" : `/alphabet/${currentLetter.code}`)}
                  className="w-full p-4 rounded-2xl bg-gradient-to-br from-[#F5E6CC] via-[#EFE0C2] to-[#E2C892]/60 border-2 border-[#CFA44E]/50 flex items-center gap-3 transition-all hover:border-[#CFA44E] hover:shadow-md active:scale-[0.99] text-left relative overflow-hidden"
                >
                  <div className="h-12 w-12 rounded-full bg-[#FBF6EC] border-2 border-[#5C3A46] flex items-center justify-center shrink-0 shadow-sm">
                    <span
                      className="text-2xl text-[#5C3A46]"
                      style={{ fontFamily: "'Noto Sans Arabic', serif", lineHeight: 1 }}
                    >
                      {currentLetter.isolated}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-[#5C3A46]" style={{ fontFamily: "'Montserrat', sans-serif" }}>
                      {alphabetMastered === 0 ? "Start the Alphabet Journey" : "Continue Alphabet Journey"}
                    </p>
                    <p className="text-xs text-[#5C3A46]/70 mt-0.5">
                      {alphabetMastered === 0
                        ? "Stop 1 of 28 — Alif"
                        : `Stop ${currentLetter.order_index + 1} of 28 — ${currentLetter.name_translit} • ${alphabetMastered} mastered`}
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-[#5C3A46] shrink-0" />
                </button>
              )}
              {srsStats && srsStats.totalDueNow > 0 && (
                <button
                  onClick={() => navigate(srsStats.myWordsDue >= srsStats.curriculumDue ? "/review/my-words" : "/review")}
                  className="w-full p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <Brain className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-medium text-foreground">
                      {srsStats.totalDueNow} {srsStats.totalDueNow === 1 ? "card" : "cards"} due for review
                    </span>
                  </div>
                  <span className="text-xs text-amber-600 font-semibold">Review now →</span>
                </button>
              )}
              <div className="flex gap-3">
                <XPDisplay compact className="flex-1" />
                <StreakDisplay compact />
              </div>
              <WeeklyGoalCard />
              <AchievementsGrid />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button onClick={() => navigate("/daily-challenge")} className={cn("p-3 rounded-xl bg-gradient-to-b from-orange-500/10 to-red-500/10 border border-orange-500/20 flex flex-col items-center gap-1.5 transition-all duration-200 hover:border-orange-500/40 active:scale-[0.98]")}>
                  <Flame className="h-5 w-5 text-orange-500" />
                  <p className="font-semibold text-foreground text-xs">Challenge</p>
                </button>
                <button onClick={() => navigate("/leaderboard")} className={cn("p-3 rounded-xl bg-gradient-to-b from-yellow-500/10 to-orange-500/10 border border-yellow-500/20 flex flex-col items-center gap-1.5 transition-all duration-200 hover:border-yellow-500/40 active:scale-[0.98]")}>
                  <Trophy className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                  <p className="font-semibold text-foreground text-xs">Leaderboard</p>
                </button>
                <button onClick={() => navigate("/battles")} className={cn("p-3 rounded-xl bg-gradient-to-b from-red-500/10 to-pink-500/10 border border-red-500/20 flex flex-col items-center gap-1.5 transition-all duration-200 hover:border-red-500/40 active:scale-[0.98]")}>
                  <Swords className="h-5 w-5 text-red-500" />
                  <p className="font-semibold text-foreground text-xs">Battles</p>
                </button>
                <button onClick={() => navigate("/friends")} className={cn("p-3 rounded-xl bg-gradient-to-b from-primary/10 to-primary/5 border border-primary/20 flex flex-col items-center gap-1.5 transition-all duration-200 hover:border-primary/40 active:scale-[0.98]")}>
                  <Users className="h-5 w-5 text-primary" />
                  <p className="font-semibold text-foreground text-xs">Friends</p>
                </button>
                <button onClick={() => navigate("/analytics")} className={cn("p-3 rounded-xl bg-gradient-to-b from-blue-500/10 to-indigo-500/10 border border-blue-500/20 flex flex-col items-center gap-1.5 transition-all duration-200 hover:border-blue-500/40 active:scale-[0.98]")}>
                  <BarChart3 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  <p className="font-semibold text-foreground text-xs">Analytics</p>
                </button>
                <button onClick={() => navigate("/my-path")} className={cn("p-3 rounded-xl bg-gradient-to-b from-emerald-500/10 to-teal-500/10 border border-emerald-500/20 flex flex-col items-center gap-1.5 transition-all duration-200 hover:border-emerald-500/40 active:scale-[0.98]")}>
                  <Compass className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  <p className="font-semibold text-foreground text-xs">My Path</p>
                </button>
              </div>
            </div>
          ) : null,

          "discover": (
            <div key="discover">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-bold text-foreground flex items-center gap-1.5" style={{ fontFamily: "'Montserrat', sans-serif" }}>Discover Videos<InfoHint title={TILE_HINTS.discover.title} body={TILE_HINTS.discover.body} /></h2>
                <button onClick={() => navigate("/discover")} className="text-sm font-medium text-primary hover:underline flex items-center gap-0.5">
                  See all <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
              {previewVideo ? (
                <div>
                  <DiscoverPreviewCard video={previewVideo} onClick={() => navigate(`/discover/${previewVideo.id}`)} />
                  {previewVideos.length > 1 && (
                    <div className="flex justify-center gap-2 mt-3">
                      {previewVideos.map((v, i) => (
                        <button key={v.id} onClick={() => setPreviewIndex(i)} className={cn("w-2.5 h-2.5 rounded-full transition-all duration-200", i === previewIndex ? "bg-primary scale-125" : "bg-primary/30 hover:bg-primary/50")} aria-label={`Video ${i + 1}`} />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className={cn("w-full p-8 rounded-2xl bg-muted/50 border-2 border-dashed border-primary/20 flex flex-col items-center gap-3 text-center")}>
                  <Play className="h-10 w-10 text-muted-foreground/40" />
                  <p className="text-lg font-bold text-foreground">Coming Soon</p>
                  <p className="text-sm text-muted-foreground">
                    {activeDialect === 'Egyptian' ? 'Egyptian Arabic' : activeDialect === 'Yemeni' ? 'Yemeni Arabic' : activeDialect} videos are on the way!
                  </p>
                </div>
              )}
            </div>
          ),

          "new-words": (
            <button key="new-words" onClick={() => navigate("/learn")} className={cn("w-full p-4 rounded-xl bg-primary text-primary-foreground flex items-center gap-3 transition-all duration-200 hover:opacity-90 active:scale-[0.98] shadow-md")}>
              <div className="w-10 h-10 rounded-lg bg-primary-foreground/20 flex items-center justify-center shrink-0">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="text-left">
                <p className="font-bold flex items-center gap-1.5">New Words<InfoHint title={TILE_HINTS["new-words"].title} body={TILE_HINTS["new-words"].body} /></p>
                <p className="text-xs opacity-80">{stats ? `${stats.newCount} words to discover` : "Start learning vocabulary"}</p>
              </div>
            </button>
          ),

          "review":
            isAuthenticated && stats && stats.dueCount > 0 ? (
              <button key="review" onClick={() => navigate("/review")} className={cn("w-full p-4 rounded-xl bg-card border border-primary/20 flex items-center justify-between transition-all duration-200 hover:border-primary/40")}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Brain className="h-5 w-5 text-primary" />
                  </div>
                  <div className="text-left">
                    <p className="font-semibold text-foreground flex items-center gap-1.5">Review<InfoHint title={TILE_HINTS.review.title} body={TILE_HINTS.review.body} /></p>
                    <p className="text-xs text-muted-foreground">{stats.dueCount} {stats.dueCount === 1 ? "word" : "words"} due</p>
                  </div>
                </div>
                <div className="px-2.5 py-1 bg-primary/10 rounded-full">
                  <span className="text-sm font-semibold text-primary">{stats.dueCount}</span>
                </div>
              </button>
            ) : isAuthenticated && stats && stats.dueCount === 0 && stats.learnedCount > 0 ? (
              <button key="review" onClick={() => navigate("/review")} className={cn("w-full p-4 rounded-xl bg-card border border-border flex items-center gap-3 transition-all duration-200 hover:border-primary/20")}>
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <Brain className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-foreground">All caught up</p>
                  <p className="text-xs text-muted-foreground">{stats.learnedCount} learned · {stats.masteredCount} mastered</p>
                </div>
              </button>
            ) : null,

          "my-words": isAuthenticated ? (
            <button key="my-words" onClick={() => navigate("/my-words")} className={cn("w-full p-4 rounded-xl bg-card border border-border flex items-center justify-between transition-all duration-200 hover:border-primary/20")}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <BookOpen className="h-5 w-5 text-primary" />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-foreground flex items-center gap-1.5">My Words<InfoHint title={TILE_HINTS["my-words"].title} body={TILE_HINTS["my-words"].body} /></p>
                  <p className="text-xs text-muted-foreground">{myWordsStats?.dueCount ? `${myWordsStats.dueCount} due for review` : "Saved vocabulary"}</p>
                </div>
              </div>
              {myWordsStats && myWordsStats.dueCount > 0 && (
                <div className="px-2.5 py-1 bg-primary/10 rounded-full">
                  <span className="text-sm font-semibold text-primary">{myWordsStats.dueCount}</span>
                </div>
              )}
            </button>
          ) : null,

          "tutor-upload": isAuthenticated ? (
            <button key="tutor-upload" onClick={() => navigate("/tutor-upload")} className={cn("w-full p-4 rounded-xl bg-card border border-border flex items-center gap-3 transition-all duration-200 hover:border-primary/20")}>
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <GraduationCap className="h-5 w-5 text-primary" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-foreground flex items-center gap-1.5">Tutor Upload<InfoHint title={TILE_HINTS["tutor-upload"].title} body={TILE_HINTS["tutor-upload"].body} /></p>
                <p className="text-xs text-muted-foreground">Extract flashcards from tutor audio</p>
              </div>
            </button>
          ) : null,

          "speaking": (
            <div key="speaking">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">Speaking Practice</p>
              <button onClick={() => navigate("/pronunciation")} className={cn("w-full p-4 rounded-xl mb-2 bg-gradient-to-r from-primary to-primary/80 text-primary-foreground flex items-center gap-3 transition-all duration-200 hover:opacity-90 active:scale-[0.98] shadow-md")}>
                <div className="w-10 h-10 rounded-lg bg-primary-foreground/20 flex items-center justify-center shrink-0">
                  <Mic className="h-5 w-5" />
                </div>
                <div className="text-left">
                  <p className="font-bold flex items-center gap-1.5">Pronunciation Practice<InfoHint title={TILE_HINTS.pronunciation.title} body={TILE_HINTS.pronunciation.body} /></p>
                  <p className="text-xs opacity-80">Record yourself & get AI feedback</p>
                </div>
              </button>
              <button onClick={() => navigate("/conversation")} className={cn("w-full p-4 rounded-xl mb-2 bg-card border border-primary/20 flex items-center gap-3 transition-all duration-200 hover:border-primary/40")}>
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <MessageSquare className="h-5 w-5 text-primary" />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-foreground flex items-center gap-1.5">Conversation Simulator<InfoHint title={TILE_HINTS.conversation.title} body={TILE_HINTS.conversation.body} /></p>
                  <p className="text-xs text-muted-foreground">Practice real-world Arabic scenarios</p>
                </div>
              </button>
              <button onClick={() => navigate("/set-phrases")} className={cn("w-full p-4 rounded-xl mb-2 bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/20 flex items-center gap-3 transition-all duration-200 hover:border-emerald-500/40 active:scale-[0.98]")}>
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                  <MessageCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-foreground flex items-center gap-1.5">Set Phrases<InfoHint title={TILE_HINTS["set-phrases"].title} body={TILE_HINTS["set-phrases"].body} /></p>
                  <p className="text-xs text-muted-foreground">Greetings, weddings, Eid & more — voice quiz</p>
                </div>
              </button>
              <button onClick={() => navigate("/stories")} className={cn("w-full p-4 rounded-xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20 flex items-center gap-3 transition-all duration-200 hover:border-amber-500/40 active:scale-[0.98]")}>
                <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                  <BookOpen className="h-5 w-5 text-amber-600" />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-foreground flex items-center gap-1.5">Interactive Stories<InfoHint title={TILE_HINTS.stories.title} body={TILE_HINTS.stories.body} /></p>
                  <p className="text-xs text-muted-foreground">Choose-your-adventure in Arabic</p>
                </div>
              </button>
            </div>
          ),

          "grammar": (
            <div key="grammar">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">Grammar</p>
              <button onClick={() => navigate("/grammar")} className={cn("w-full p-4 rounded-xl bg-gradient-to-r from-violet-500/10 to-purple-500/10 border border-violet-500/20 flex items-center gap-3 transition-all duration-200 hover:border-violet-500/40 active:scale-[0.98]")}>
                <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                  <PenTool className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-foreground flex items-center gap-1.5">Grammar Drills<InfoHint title={TILE_HINTS.grammar.title} body={TILE_HINTS.grammar.body} /></p>
                  <p className="text-xs text-muted-foreground">AI-powered conjugation, pronouns & more</p>
                </div>
              </button>
            </div>
          ),

          "games": (
            <div key="games">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">Games</p>
              <button onClick={() => navigate("/vocab-games")} className={cn("w-full p-4 rounded-xl bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/20 flex items-center gap-3 transition-all duration-200 hover:border-primary/40 active:scale-[0.98]")}>
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Gamepad2 className="h-5 w-5 text-primary" />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-foreground flex items-center gap-1.5">Vocabulary Games<InfoHint title={TILE_HINTS["vocab-games"].title} body={TILE_HINTS["vocab-games"].body} /></p>
                  <p className="text-xs text-muted-foreground">Word matching, memory cards & fill-in-the-blank</p>
                </div>
              </button>
            </div>
          ),

          "comprehension": (
            <div key="comprehension">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">Comprehension</p>
              <button onClick={() => navigate("/alphabet")} className={cn("w-full p-4 rounded-xl mb-2 bg-gradient-to-r from-amber-500/15 to-orange-500/10 border-2 border-amber-500/30 flex items-center gap-3 transition-all duration-200 hover:border-amber-500/50 active:scale-[0.98]")}>
                <div className="w-10 h-10 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0 text-2xl">🐪</div>
                <div className="text-left flex-1">
                  <p className="font-semibold text-foreground flex items-center gap-1.5">Alphabet Journey<InfoHint title="Alphabet Journey" body="A 28-stop caravan through the Arabic alphabet. Each stop: meet the letter, hear it, trace it, see its 4 shapes, then 2 quick games." /></p>
                  <p className="text-xs text-muted-foreground">Learn all 28 letters — trace, hear & play</p>
                </div>
              </button>
              <button onClick={() => navigate("/listening")} className={cn("w-full p-4 rounded-xl mb-2 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 flex items-center gap-3 transition-all duration-200 hover:border-cyan-500/40 active:scale-[0.98]")}>
                <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
                  <Headphones className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-foreground flex items-center gap-1.5">Listening Practice<InfoHint title={TILE_HINTS.listening.title} body={TILE_HINTS.listening.body} /></p>
                  <p className="text-xs text-muted-foreground">Dictation, comprehension & speed drills</p>
                </div>
              </button>
              <button onClick={() => navigate("/reading")} className={cn("w-full p-4 rounded-xl mb-2 bg-gradient-to-r from-indigo-500/10 to-violet-500/10 border border-indigo-500/20 flex items-center gap-3 transition-all duration-200 hover:border-indigo-500/40 active:scale-[0.98]")}>
                <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
                  <FileText className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-foreground flex items-center gap-1.5">Reading Practice<InfoHint title={TILE_HINTS.reading.title} body={TILE_HINTS.reading.body} /></p>
                  <p className="text-xs text-muted-foreground">Passages with tap-to-translate & comprehension quiz</p>
                </div>
              </button>
              <button onClick={() => navigate("/picture-scenes")} className={cn("w-full p-4 rounded-xl bg-gradient-to-r from-rose-500/10 to-pink-500/10 border border-rose-500/20 flex items-center gap-3 transition-all duration-200 hover:border-rose-500/40 active:scale-[0.98]")}>
                <div className="w-10 h-10 rounded-lg bg-rose-500/10 flex items-center justify-center shrink-0">
                  <ImageIcon className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-foreground flex items-center gap-1.5">Picture Scenes<InfoHint title={TILE_HINTS["picture-scenes"].title} body={TILE_HINTS["picture-scenes"].body} /></p>
                  <p className="text-xs text-muted-foreground">Tap objects in a scene to learn new words</p>
                </div>
              </button>
            </div>
          ),

          "bible": hasBibleAccess ? (
            <div key="bible">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">Scripture</p>
              <button onClick={() => navigate("/bible")} className={cn("w-full p-4 rounded-xl bg-gradient-to-r from-amber-500/10 to-yellow-500/10 border border-amber-500/20 flex items-center gap-3 transition-all duration-200 hover:border-amber-500/40 active:scale-[0.98]")}>
                <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                  <BookMarked className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-foreground flex items-center gap-1.5">Bible Reading<InfoHint title={TILE_HINTS.bible.title} body={TILE_HINTS.bible.body} /></p>
                  <p className="text-xs text-muted-foreground">Read Scripture in Arabic with vocabulary tools</p>
                </div>
              </button>
            </div>
          ) : null,

          "souq-news": (
            <div key="souq-news">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">Current Events</p>
              <button onClick={() => navigate("/souq-news")} className={cn("w-full p-4 rounded-xl bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/20 flex items-center gap-3 transition-all duration-200 hover:border-emerald-500/40 active:scale-[0.98]")}>
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                  <Newspaper className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-foreground flex items-center gap-1.5">أخبار السوق · Souq News<InfoHint title={TILE_HINTS["souq-news"].title} body={TILE_HINTS["souq-news"].body} /></p>
                  <p className="text-xs text-muted-foreground">
                    {activeDialect === 'Egyptian' ? "Egyptian gossip about today's headlines" : activeDialect === 'Yemeni' ? "Yemeni take on today's headlines" : "Gulf gossip about today's headlines"}
                  </p>
                </div>
              </button>
            </div>
          ),

          "dialect-compare": (
            <button key="dialect-compare" onClick={() => navigate("/dialect-compare")} className={cn("w-full p-4 rounded-xl bg-gradient-to-r from-emerald-500/10 to-sky-500/10 border border-emerald-500/20 flex items-center gap-3 transition-all duration-200 hover:border-emerald-500/40 active:scale-[0.98]")}>
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                <Globe2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-foreground flex items-center gap-1.5">Dialect Compare<InfoHint title={TILE_HINTS["dialect-compare"].title} body={TILE_HINTS["dialect-compare"].body} /></p>
                <p className="text-xs text-muted-foreground">See how words differ across Gulf, Egyptian & Levantine</p>
              </div>
            </button>
          ),

          "meme": (
            <button key="meme" onClick={() => navigate("/meme")} className={cn("w-full p-4 rounded-xl bg-card border border-border flex items-center gap-3 transition-all duration-200 hover:border-primary/20")}>
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Laugh className="h-5 w-5 text-primary" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-foreground flex items-center gap-1.5">Meme Analyzer<InfoHint title={TILE_HINTS.meme.title} body={TILE_HINTS.meme.body} /></p>
                <p className="text-xs text-muted-foreground">Break down Arabic memes</p>
              </div>
            </button>
          ),

          "learn-from-x": (
            <button key="learn-from-x" onClick={() => navigate("/learn-from-x")} className={cn("w-full p-4 rounded-xl bg-card border border-border flex items-center gap-3 transition-all duration-200 hover:border-primary/20")}>
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Twitter className="h-5 w-5 text-primary" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-foreground flex items-center gap-1.5">Learn from X Post<InfoHint title={TILE_HINTS["learn-from-x"].title} body={TILE_HINTS["learn-from-x"].body} /></p>
                <p className="text-xs text-muted-foreground">Analyze Arabic posts from X</p>
              </div>
            </button>
          ),

          "how-do-i-say": (
            <button key="how-do-i-say" onClick={() => navigate("/how-do-i-say")} className={cn("w-full p-4 rounded-xl bg-card border border-border flex items-center gap-3 transition-all duration-200 hover:border-primary/20")}>
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <MessageCircleQuestion className="h-5 w-5 text-primary" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-foreground flex items-center gap-1.5">How do I say…?<InfoHint title={TILE_HINTS["how-do-i-say"].title} body={TILE_HINTS["how-do-i-say"].body} /></p>
                <p className="text-xs text-muted-foreground">
                  Translate phrases into {activeDialect === 'Egyptian' ? 'Egyptian Arabic' : activeDialect === 'Yemeni' ? 'Yemeni Arabic' : 'Gulf Arabic'}
                </p>
              </div>
            </button>
          ),

          "culture": (
            <button key="culture" onClick={() => navigate("/culture-guide")} className={cn("w-full p-4 rounded-xl bg-card border border-border flex items-center gap-3 transition-all duration-200 hover:border-primary/20")}>
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Compass className="h-5 w-5 text-primary" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-foreground flex items-center gap-1.5">What should I do?<InfoHint title={TILE_HINTS.culture.title} body={TILE_HINTS.culture.body} /></p>
                <p className="text-xs text-muted-foreground">Get culturally appropriate {activeDialect === 'Egyptian' ? 'Egyptian' : 'Gulf'} advice</p>
              </div>
            </button>
          ),

          "transcribe": (
            <button key="transcribe" onClick={() => navigate("/transcribe")} className={cn("w-full p-4 rounded-xl bg-card border border-border flex items-center gap-3 transition-all duration-200 hover:border-primary/20")}>
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Mic className="h-5 w-5 text-primary" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-foreground flex items-center gap-1.5">Transcribe Audio<InfoHint title={TILE_HINTS.transcribe.title} body={TILE_HINTS.transcribe.body} /></p>
                <p className="text-xs text-muted-foreground">Convert Arabic audio to text</p>
              </div>
            </button>
          ),

          "my-transcriptions": isAuthenticated ? (
            <button key="my-transcriptions" onClick={() => navigate("/my-transcriptions")} className={cn("w-full p-4 rounded-xl bg-card border border-border flex items-center gap-3 transition-all duration-200 hover:border-primary/20")}>
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-foreground flex items-center gap-1.5">My Transcriptions<InfoHint title={TILE_HINTS["my-transcriptions"].title} body={TILE_HINTS["my-transcriptions"].body} /></p>
                <p className="text-xs text-muted-foreground">View transcripts you've saved</p>
              </div>
            </button>
          ) : null,
        };

        return (
          <div className="space-y-3">
            {homeLayout.order.map((id) => {
              if (!isSectionVisible(id, homeLayout)) return null;
              const node = sections[id];
              if (!node) return null;
              return <div key={id}>{node}</div>;
            })}
          </div>
        );
      })()}

    </AppShell>
  );
};

export default Index;
