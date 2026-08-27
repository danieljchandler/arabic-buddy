import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useDialect, type DialectModule } from '@/contexts/DialectContext';
import { supabase } from '@/integrations/supabase/client';
import { markTourPending } from '@/components/onboarding/OnboardingTour';
import { AppShell } from '@/components/layout/AppShell';
import { LoadingPanel } from '@/components/loading/LoadingPanel';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Loader2,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Globe2,
  GraduationCap,
  Target,
  Check,
} from 'lucide-react';
import { getTopicCategories } from '@/data/listenTopics';
import { LEARNING_REASONS, reasonLabel } from '@/data/learningReasons';
// The stacked logo lockup, not hakiya-icon.png — that file is a 712 kB render
// whose artwork floats inside a much larger canvas (see BrandMark's comment).
import hakiyaLockup from '@/assets/hakiya-lockup.webp';
import dialectGulfArt from '@/assets/illustrations/dialect-gulf.webp';
import dialectEgyptianArt from '@/assets/illustrations/dialect-egyptian.webp';
import dialectYemeniArt from '@/assets/illustrations/dialect-yemeni.webp';
import levelBeginnerArt from '@/assets/illustrations/level-beginner.webp';
import levelBasicArt from '@/assets/illustrations/level-basic.webp';
import levelElementaryArt from '@/assets/illustrations/level-elementary.webp';
import levelIntermediateArt from '@/assets/illustrations/level-intermediate.webp';
import levelAdvancedArt from '@/assets/illustrations/level-advanced.webp';
import goalCasualArt from '@/assets/illustrations/goal-casual.webp';
import goalRegularArt from '@/assets/illustrations/goal-regular.webp';
import goalSeriousArt from '@/assets/illustrations/goal-serious.webp';
import goalIntensiveArt from '@/assets/illustrations/goal-intensive.webp';

type Step = 'welcome' | 'dialect' | 'level' | 'purpose' | 'goal';

const DRAFT_KEY = 'hakiya_onboarding_draft';

interface Draft {
  step: Step;
  dialect: string;
  level: string;
  goal: string;
  reason: string | null;
  interests: string[];
}

const STEPS: Step[] = ['welcome', 'dialect', 'level', 'purpose', 'goal'];

// Must match DialectModule ('Gulf' | 'Egyptian' | 'Yemeni') — the only values
// DialectContext actually recognizes. Anything else silently falls back to
// Gulf, which previously happened for every Saudi/Kuwaiti/Emirati/etc. pick,
// while Egyptian and Yemeni (real, supported dialects) weren't offered at all.
const DIALECTS = [
  { id: 'Gulf', label: 'Gulf Arabic', labelAr: 'خليجي', desc: 'Shared across all GCC countries', flag: '🌊', image: dialectGulfArt },
  { id: 'Egyptian', label: 'Egyptian Arabic', labelAr: 'مصري', desc: 'The most widely understood dialect', flag: '🇪🇬', image: dialectEgyptianArt },
  { id: 'Yemeni', label: 'Yemeni Arabic', labelAr: 'يمني', desc: 'Yemeni expressions', flag: '🇾🇪', image: dialectYemeniArt },
];

const LEVELS = [
  { id: 'beginner', label: 'Complete Beginner', desc: "I don't know any Arabic", image: levelBeginnerArt, cefr: 'Pre-A1' },
  { id: 'basic', label: 'Basic', desc: 'I know some words & greetings', image: levelBasicArt, cefr: 'A1' },
  { id: 'elementary', label: 'Elementary', desc: 'I can make basic sentences', image: levelElementaryArt, cefr: 'A2' },
  { id: 'intermediate', label: 'Intermediate', desc: 'I can hold simple conversations', image: levelIntermediateArt, cefr: 'B1' },
  { id: 'advanced', label: 'Advanced', desc: 'I understand most spoken Arabic', image: levelAdvancedArt, cefr: 'B2+' },
];

const GOALS = [
  { id: 'casual', label: 'Casual', desc: '5 min/day · 2-3 days/week', image: goalCasualArt, reviewTarget: 20, xpTarget: 100 },
  { id: 'regular', label: 'Regular', desc: '10 min/day · 4-5 days/week', image: goalRegularArt, reviewTarget: 50, xpTarget: 300 },
  { id: 'serious', label: 'Serious', desc: '20 min/day · every day', image: goalSeriousArt, reviewTarget: 100, xpTarget: 500 },
  { id: 'intensive', label: 'Intensive', desc: '30+ min/day · every day', image: goalIntensiveArt, reviewTarget: 150, xpTarget: 750 },
];


const Onboarding = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated, loading } = useAuth();
  // The app-wide dialect, not just this wizard's draft. DialectContext syncs
  // from the profile only on mount — before this wizard writes it — so a pick
  // that stays local never reaches the feed, the curriculum or the placement
  // quiz: choose Egyptian here and the quiz would have tested Gulf.
  const { setDialect: setAppDialect } = useDialect();
  // The wizard's draft survives the round trip to the placement quiz — the
  // level step links there, and losing four answered steps to that link made
  // the CTA a trap. sessionStorage: a draft should not outlive the visit.
  const draft = useMemo(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      return raw ? (JSON.parse(raw) as Partial<Draft>) : null;
    } catch {
      return null;
    }
  }, []);
  const [step, setStep] = useState<Step>(
    draft?.step && STEPS.includes(draft.step) ? draft.step : 'welcome',
  );
  const [dialect, setDialect] = useState(draft?.dialect ?? 'Gulf');
  const [level, setLevel] = useState(draft?.level ?? 'beginner');
  const [goal, setGoal] = useState(draft?.goal ?? 'regular');
  const [reason, setReason] = useState<string | null>(draft?.reason ?? null);
  const [interests, setInterests] = useState<string[]>(draft?.interests ?? []);
  const [saving, setSaving] = useState(false);

  const goToPlacement = () => {
    try {
      const toSave: Draft = { step, dialect, level, goal, reason, interests };
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(toSave));
    } catch {
      /* a lost draft is survivable; a blocked jump is not */
    }
    navigate('/placement?from=onboarding');
  };

  // Same taxonomy the Listen catalog uses, scoped to the dialect just picked —
  // no second topic vocabulary to keep in sync.
  const topicCategories = getTopicCategories(dialect);

  const toggleInterest = (id: string) =>
    setInterests((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      navigate('/auth');
    }
  }, [loading, isAuthenticated, navigate]);

  const currentStepIndex = STEPS.indexOf(step);
  const progress = ((currentStepIndex + 1) / STEPS.length) * 100;

  const next = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < STEPS.length) {
      setStep(STEPS[nextIndex]);
    }
  };

  const prev = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setStep(STEPS[prevIndex]);
    }
  };

  const finish = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const selectedGoal = GOALS.find((g) => g.id === goal);

      const { error } = await supabase
        .from('profiles' as any)
        .update({
          onboarding_completed: true,
          preferred_dialect: dialect,
          proficiency_level: level,
          weekly_goal: goal,
          // Both feed the server-side learner profile that content generators
          // are conditioned on. Nullable/empty is fine — the profile simply
          // omits whatever it doesn't know.
          learning_reason: reasonLabel(reason),
          interests,
        } as any)
        .eq('user_id', user.id);

      if (error) throw error;

      // Set weekly goal based on selection
      if (selectedGoal) {
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        const weekStartStr = weekStart.toISOString().split('T')[0];

        await supabase.from('weekly_goals').upsert({
          user_id: user.id,
          week_start_date: weekStartStr,
          target_reviews: selectedGoal.reviewTarget,
          target_xp: selectedGoal.xpTarget,
        } as any, { onConflict: 'user_id,week_start_date' });
      }

      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      markTourPending();
      // The wizard's pick becomes the active dialect right now — not after
      // the next full reload, which is when the context would next read it.
      setAppDialect(dialect as DialectModule);
      toast.success('Welcome to Hakiya! 🎉');
      navigate('/');
    } catch (e) {
      console.error(e);
      toast.error('Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <LoadingPanel variant="page" />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-lg mx-auto py-6">
        {/* Progress bar */}
        <div className="mb-8">
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Step {currentStepIndex + 1} of {STEPS.length}
          </p>
        </div>

        {/* ─── WELCOME ─────────────────────────── */}
        {step === 'welcome' && (
          <div className="text-center space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <img src={hakiyaLockup} alt="Hakiya" className="h-40 w-40 mx-auto" />
            <div>
              <h1 className="text-3xl font-bold font-heading text-foreground mb-3" dir="rtl">
                !أهلاً وسهلاً
              </h1>
              <h2 className="text-xl font-semibold text-foreground mb-2">
                Welcome to Hakiya
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                Learn Arabic dialects through real conversations, videos, and interactive lessons.
                Let's personalize your learning experience.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4">
              <div className="bg-card border border-border rounded-xl p-3 text-center">
                <Globe2 className="h-6 w-6 text-primary mx-auto mb-1" />
                <p className="text-xs text-muted-foreground">Multiple dialects</p>
              </div>
              <div className="bg-card border border-border rounded-xl p-3 text-center">
                <GraduationCap className="h-6 w-6 text-primary mx-auto mb-1" />
                <p className="text-xs text-muted-foreground">6 learning stages</p>
              </div>
              <div className="bg-card border border-border rounded-xl p-3 text-center">
                <Sparkles className="h-6 w-6 text-primary mx-auto mb-1" />
                <p className="text-xs text-muted-foreground">AI-powered</p>
              </div>
            </div>
            <Button onClick={next} className="w-full h-12 text-base">
              Let's Get Started <ChevronRight className="h-5 w-5 ml-1" />
            </Button>
          </div>
        )}

        {/* ─── DIALECT ─────────────────────────── */}
        {step === 'dialect' && (
          <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="text-center">
              <h2 className="text-2xl font-bold font-heading text-foreground mb-2">
                Which dialect interests you?
              </h2>
              <p className="text-muted-foreground text-sm">
                You can always explore other dialects later
              </p>
            </div>

            <div className="space-y-2">
              {DIALECTS.map((d) => (
                <button
                  key={d.id}
                  onClick={() => {
                    setDialect(d.id);
                    // Applied app-wide immediately, so leaving the wizard for
                    // the placement quiz tests the dialect just chosen.
                    setAppDialect(d.id as DialectModule);
                  }}
                  className={cn(
                    'w-full overflow-hidden rounded-2xl border-2 text-left transition-all duration-200 active:scale-[0.99]',
                    dialect === d.id
                      ? 'border-primary shadow-elegant'
                      : 'border-border bg-card hover:border-primary/30'
                  )}
                >
                  {/* Each dialect gets its own painted scene — a Gulf majlis, a
                      Cairo ahwa, an Old Sana'a rooftop — instead of an emoji. */}
                  <div className="relative aspect-[5/2]">
                    <img
                      src={d.image}
                      alt=""
                      aria-hidden
                      loading="lazy"
                      draggable={false}
                      className="absolute inset-0 h-full w-full object-cover select-none"
                    />
                    {dialect === d.id && (
                      <span className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-button">
                        <Check className="h-4 w-4" />
                      </span>
                    )}
                  </div>
                  <div className={cn('p-3', dialect === d.id ? 'bg-primary/5' : 'bg-card')}>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{d.label}</span>
                      <span className="text-sm text-muted-foreground" dir="rtl">{d.labelAr}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{d.desc}</p>
                  </div>
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={prev} className="h-11">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button onClick={next} className="flex-1 h-11">
                Continue <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ─── LEVEL ─────────────────────────── */}
        {step === 'level' && (
          <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="text-center">
              <h2 className="text-2xl font-bold font-heading text-foreground mb-2">
                What's your Arabic level?
              </h2>
              <p className="text-muted-foreground text-sm">
                We'll tailor content to match your skills
              </p>
            </div>

            {/* Placement Quiz CTA */}
            <button
              onClick={goToPlacement}
              className="w-full flex items-center gap-3 p-3.5 rounded-xl border-2 border-primary/30 bg-primary/5 hover:bg-primary/10 transition-all duration-200 text-left"
            >
              <span className="text-2xl">🧠</span>
              <div className="flex-1">
                <span className="font-semibold text-foreground">Not sure? Take the Placement Quiz</span>
                <p className="text-xs text-muted-foreground">20 adaptive questions to find your CEFR level</p>
              </div>
              <ChevronRight className="h-5 w-5 text-primary shrink-0" />
            </button>

            <div className="space-y-2">
              {LEVELS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setLevel(l.id)}
                  className={cn(
                    'w-full flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all duration-200 text-left',
                    level === l.id
                      ? 'border-primary bg-primary/5 shadow-soft'
                      : 'border-border bg-card hover:border-primary/30'
                  )}
                >
                  <img src={l.image} alt="" aria-hidden loading="lazy" draggable={false} className="h-12 w-12 rounded-xl object-cover shrink-0 select-none ring-1 ring-border/60" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{l.label}</span>
                      <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{l.cefr}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{l.desc}</p>
                  </div>
                  {level === l.id && (
                    <Check className="h-5 w-5 text-primary shrink-0" />
                  )}
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={prev} className="h-11">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button onClick={next} className="flex-1 h-11">
                Continue <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ─── PURPOSE ─────────────────────────── */}
        {step === 'purpose' && (
          <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="text-center">
              <h2 className="text-2xl font-bold font-heading text-foreground mb-2">
                What do you want to use Arabic for?
              </h2>
              <p className="text-muted-foreground text-sm">
                This shapes the situations and topics we write about. Both are optional.
              </p>
            </div>

            <div className="space-y-2">
              {LEARNING_REASONS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setReason((prev) => (prev === r.id ? null : r.id))}
                  aria-pressed={reason === r.id}
                  className={cn(
                    'w-full flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all duration-200 text-left',
                    reason === r.id
                      ? 'border-primary bg-primary/5 shadow-soft'
                      : 'border-border bg-card hover:border-primary/30'
                  )}
                >
                  <span className="text-2xl">{r.icon}</span>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-foreground block">{r.label}</span>
                    <p className="text-xs text-muted-foreground">{r.desc}</p>
                  </div>
                  {reason === r.id && <Check className="h-5 w-5 text-primary shrink-0" />}
                </button>
              ))}
            </div>

            <div>
              <p className="text-sm font-semibold text-foreground mb-1">
                Topics you'd enjoy
              </p>
              <p className="text-xs text-muted-foreground mb-3">
                Pick any that appeal — we'll lean on them for stories and listening.
              </p>
              <div className="flex flex-wrap gap-2">
                {topicCategories.map((c) => {
                  const selected = interests.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggleInterest(c.id)}
                      aria-pressed={selected}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-2 rounded-full border-2 text-sm transition-all duration-200',
                        selected
                          ? 'border-primary bg-primary/5 text-foreground font-medium'
                          : 'border-border bg-card text-muted-foreground hover:border-primary/30'
                      )}
                    >
                      <span>{c.emoji}</span>
                      <span>{c.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={prev} className="h-11">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button onClick={next} className="flex-1 h-11">
                Continue <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ─── GOAL ─────────────────────────── */}
        {step === 'goal' && (
          <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="text-center">
              <h2 className="text-2xl font-bold font-heading text-foreground mb-2">
                Set your weekly goal
              </h2>
              <p className="text-muted-foreground text-sm">
                How much time can you dedicate to learning?
              </p>
            </div>

            <div className="space-y-2">
              {GOALS.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setGoal(g.id)}
                  className={cn(
                    'w-full flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all duration-200 text-left',
                    goal === g.id
                      ? 'border-primary bg-primary/5 shadow-soft'
                      : 'border-border bg-card hover:border-primary/30'
                  )}
                >
                  <img src={g.image} alt="" aria-hidden loading="lazy" draggable={false} className="h-12 w-12 rounded-xl object-cover shrink-0 select-none ring-1 ring-border/60" />
                  <div className="flex-1">
                    <span className="font-semibold text-foreground block">{g.label}</span>
                    <p className="text-xs text-muted-foreground">{g.desc}</p>
                  </div>
                  {goal === g.id && (
                    <Check className="h-5 w-5 text-primary shrink-0" />
                  )}
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={prev} className="h-11">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button onClick={finish} disabled={saving} className="flex-1 h-11">
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Target className="h-4 w-4 mr-1" />
                    Start Learning!
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default Onboarding;
