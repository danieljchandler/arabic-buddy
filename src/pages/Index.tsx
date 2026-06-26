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
import { Settings, Brain, LogIn, LogOut, Mic, BookOpen, Sparkles, GraduationCap, Laugh, Play, ChevronRight, Twitter, MessageCircleQuestion, Compass, MessageSquare, MessageCircle, Globe2, Headphones, Trophy, FileText, Flame, BarChart3, PenTool, Gamepad2, Users, Swords, Newspaper, BookMarked, Image as ImageIcon, Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { XPDisplay, StreakDisplay, WeeklyGoalCard, AchievementsGrid } from "@/components/gamification";
import hakiyaLogoAsset from "@/assets/hakiya-logo.png.asset.json";
const lahjaLogo = hakiyaLogoAsset.url;
import { useState } from "react";
import { NotificationBell } from "@/components/NotificationBell";
import { useDialect, DialectModule } from "@/contexts/DialectContext";
import { DialectRitualSwitcher } from "@/components/DialectRitualSwitcher";
import { MajlisWelcome } from "@/components/MajlisWelcome";
import { PhraseOfTheDay } from "@/components/PhraseOfTheDay";
import { useHomeLayout } from "@/hooks/useHomeLayout";
import { HomeSectionId, isSectionVisible } from "@/lib/homeLayout";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { DiscoverPreviewCard } from "@/components/discover/DiscoverPreviewCard";
import { InfoHint } from "@/components/InfoHint";
import { useAlphabetProgress } from "@/hooks/useAlphabetProgress";
import { ARABIC_LETTERS } from "@/data/arabicAlphabet";
import { DailyLetterGoalRing } from "@/components/alphabet/DailyLetterGoalRing";
import { ContinueCard } from "@/components/ContinueCard";
import { LandingHero } from "@/components/LandingHero";
import { Footer } from "@/components/Footer";


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
  "listen": { title: "Listen", body: "AI-generated podcasts, TED-style talks, interviews and stories in your dialect. Tap any word to translate or save." },
  
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

  // Logged-out visitors get the landing hero instead of the authed home.
  if (!authLoading && !isAuthenticated) {
    return (
      <AppShell>
        <LandingHero />
        <Footer />
      </AppShell>
    );
  }

  return (
    <AppShell>



      {/* Top bar with logo and auth */}
      <div className="flex items-center justify-between mb-4">
        <img src={lahjaLogo} alt="Hakiya" className="h-20" />
        
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
              <Button variant="ghost" size="icon" onClick={() => navigate("/profile")} className="text-muted-foreground hover:text-foreground" title="Profile">
                <Users className="h-4 w-4" />
              </Button>
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

      {/* A — Majlis welcome panel */}
      <MajlisWelcome />

      {/* Dialect Module Switcher — ritual chip + flip-card overlay */}
      <div className="mb-3">
        <DialectRitualSwitcher />
      </div>

      {/* Continue where you left off */}
      {isAuthenticated && <ContinueCard />}


      {/* MSA → Dialect bridge entry */}
      <button
        onClick={() => navigate("/bridge")}
        className={cn(
          "w-full mb-4 px-4 py-3 rounded-2xl text-left",
          "bg-gradient-to-r from-[#5C3A46]/8 via-[#F9F7F2] to-[#5C3A46]/8",
          "border border-[#5C3A46]/25 hover:border-[#5C3A46]/50",
          "flex items-center gap-3 transition-all active:scale-[0.99]"
        )}
      >
        <div className="h-9 w-9 rounded-xl bg-[#5C3A46]/10 flex items-center justify-center shrink-0">
          <Globe2 className="h-4 w-4 text-[#5C3A46]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#5C3A46]">Coming from MSA?</p>
          <p className="text-[11px] text-[#5C3A46]/70 truncate">
            Bridge <span className="font-arabic" dir="rtl">الفصحى</span> into {activeDialect} dialect
          </p>
        </div>
        <ChevronRight className="h-4 w-4 text-[#5C3A46]/60 shrink-0" />
      </button>

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
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {srsStats && srsStats.totalDueNow >= 10
                      ? `${srsStats.totalDueNow} cards due — clear them first`
                      : currentLetter && alphabetMastered < 28
                      ? `Next letter: ${currentLetter.name_translit}`
                      : "Your daily learning queue"}
                  </p>
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
              <DailyLetterGoalRing />
              <WeeklyGoalCard />
            </div>
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

