import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Loader2, Check, ArrowLeft, User, Globe2, Target, Eye, Heart, ChevronRight, Camera, AlertTriangle, Info, Compass, Bell, Palette } from 'lucide-react';
import { AvatarPicker } from '@/components/settings/AvatarPicker';
import {
  SettingSection,
  SettingsGroup,
  type SettingsGroupMeta,
} from '@/components/settings/SettingsGroup';
import { SettingsGroupNav } from '@/components/settings/SettingsGroupNav';
import { invalidateProfileAvatar } from '@/hooks/useProfileAvatar';
import { HomeLayoutEditor } from '@/components/settings/HomeLayoutEditor';
import { DisplayPrefsEditor } from '@/components/settings/DisplayPrefsEditor';
import { TutorMemoryCard } from '@/components/settings/TutorMemoryCard';
import { useLeechPrefs } from '@/hooks/useLeechPrefs';
import { useRootFamilyPrefs } from '@/hooks/useRootFamilyPrefs';
import { useFeatureHints } from '@/hooks/useFeatureHints';
import { useSubscription } from '@/hooks/useSubscription';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { getTopicCategories } from '@/data/listenTopics';
import { useTheme, type ThemePref } from '@/hooks/useTheme';
import { useSRSStats } from '@/hooks/useSRSStats';
import { useFsrsCalibration } from '@/hooks/useFsrsCalibration';
import { useFsrsWeights } from '@/hooks/useFsrsWeights';
import { useFsrsFit } from '@/hooks/useFsrsFit';
import { MIN_REVIEWS_TO_FIT } from '@/lib/fsrsFit';
import { LEARNING_REASONS, reasonLabel, reasonIdFromLabel } from '@/data/learningReasons';

/**
 * The four groups the page's fifteen settings fall into, in the order they are
 * rendered and indexed.
 *
 * Before this, the settings sat in one flat 4,500px column in the order they
 * happened to be added — Appearance, then Profile, then dialect, with the
 * subscription and Sign Out four thousand pixels below. Nothing said which
 * settings belonged together, so the only way to find one was to read all of
 * them.
 *
 * The split is by *what you came here to change*, not by which table the value
 * lands in: "Learning" mixes profile columns (dialect, level) with
 * device-local review preferences because a learner adjusting how hard the app
 * pushes them does not care which of those is which. The one thing the split
 * must not do is separate a setting from the save model it belongs to, and it
 * doesn't — the unsaved-changes bar follows the learner rather than living at
 * the bottom of any one group.
 */
const GROUPS: SettingsGroupMeta[] = [
  {
    id: 'account',
    label: 'Account',
    icon: User,
    blurb: "Who you are here, what you've saved, and your plan.",
  },
  {
    id: 'learning',
    label: 'Learning',
    icon: Compass,
    blurb: 'The Arabic you want, and how hard the app pushes you towards it.',
  },
  {
    id: 'appearance',
    label: 'Appearance & Display',
    icon: Palette,
    blurb: 'How the app looks, and how much of each phrase it shows by default.',
  },
  {
    id: 'privacy',
    label: 'Privacy & Data',
    icon: Eye,
    blurb: 'What other learners can see, and what the tutor remembers about you.',
  },
];

/** Addressed by name below, so a reordering of GROUPS can't silently reshuffle
 *  which settings sit under which heading. */
const GROUP = Object.fromEntries(GROUPS.map((g) => [g.id, g])) as Record<
  string,
  SettingsGroupMeta
>;

const DIALECTS = [
  { id: 'Gulf', label: 'Gulf Arabic', labelAr: 'خليجي', flag: '🌊' },
  { id: 'Egyptian', label: 'Egyptian Arabic', labelAr: 'مصري', flag: '🇪🇬' },
  { id: 'Saudi', label: 'Saudi', labelAr: 'سعودي', flag: '🇸🇦' },
  { id: 'Kuwaiti', label: 'Kuwaiti', labelAr: 'كويتي', flag: '🇰🇼' },
  { id: 'Emirati', label: 'Emirati', labelAr: 'إماراتي', flag: '🇦🇪' },
  { id: 'Qatari', label: 'Qatari', labelAr: 'قطري', flag: '🇶🇦' },
  { id: 'Bahraini', label: 'Bahraini', labelAr: 'بحريني', flag: '🇧🇭' },
  { id: 'Omani', label: 'Omani', labelAr: 'عماني', flag: '🇴🇲' },
];

const LEVELS = [
  { id: 'beginner', label: 'Complete Beginner', cefr: 'Pre-A1', icon: '🌱' },
  { id: 'basic', label: 'Basic', cefr: 'A1', icon: '📖' },
  { id: 'elementary', label: 'Elementary', cefr: 'A2', icon: '🗣️' },
  { id: 'intermediate', label: 'Intermediate', cefr: 'B1', icon: '💬' },
  { id: 'advanced', label: 'Advanced', cefr: 'B2+', icon: '🎯' },
];

const GOALS = [
  { id: 'casual', label: 'Casual', desc: '5 min/day', icon: '☕', reviewTarget: 20, xpTarget: 100 },
  { id: 'regular', label: 'Regular', desc: '10 min/day', icon: '📚', reviewTarget: 50, xpTarget: 300 },
  { id: 'serious', label: 'Serious', desc: '20 min/day', icon: '🔥', reviewTarget: 100, xpTarget: 500 },
  { id: 'intensive', label: 'Intensive', desc: '30+ min/day', icon: '🚀', reviewTarget: 150, xpTarget: 750 },
];

const Settings = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated, loading: authLoading, signOut } = useAuth();
  const { pref: themePref, setPref: setThemePref } = useTheme();
  const { data: srsStats } = useSRSStats();
  const stabilityMultiplier = useFsrsCalibration();
  const fittedWeights = useFsrsWeights();
  const fsrsFit = useFsrsFit();
  /**
   * Plain-language read-out of the measured FSRS calibration. Absent until
   * there is enough review history for a correction to exist at all, so it
   * never shows a learner a number that isn't doing anything.
   */
  const calibrationNote = (() => {
    if (Math.abs(stabilityMultiplier - 1) < 0.02) return null;
    const percent = Math.round(Math.abs(stabilityMultiplier - 1) * 100);
    const direction = stabilityMultiplier > 1 ? 'longer' : 'shorter';
    const measured = srsStats?.retentionRate ?? 0;
    return `Measured from your ${srsStats?.reviewedCount ?? 0} reviews: you recall `
      + `${measured}% at review time, so your intervals run about ${percent}% ${direction} `
      + `than the default schedule.`;
  })();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const { enabled: leechEnabled, setEnabled: setLeechEnabled } = useLeechPrefs();
  const { enabled: rootFamiliesEnabled, setEnabled: setRootFamiliesEnabled } = useRootFamilyPrefs();
  const { enabled: hintsEnabled, setEnabled: setHintsEnabled } = useFeatureHints();
  const { subscribed, tier, openCustomerPortal } = useSubscription();
  const [clearingLeeches, setClearingLeeches] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);

  const handleManageSubscription = async () => {
    setOpeningPortal(true);
    try {
      await openCustomerPortal();
    } catch (e) {
      toast.error('Unable to open subscription portal', {
        description: e instanceof Error ? e.message : 'Please try again.',
      });
    } finally {
      setOpeningPortal(false);
    }
  };

  const clearAllLeeches = async () => {
    if (!user) return;
    setClearingLeeches(true);
    try {
      await Promise.all([
        (supabase.from('user_vocabulary') as any)
          .update({ is_leech: false, lapses: 0, production_lapses: 0 })
          .eq('user_id', user.id),
        (supabase.from('user_phrases') as any)
          .update({ is_leech: false, lapses: 0 })
          .eq('user_id', user.id),
      ]);
      toast.success('Cleared all leech flags.');
    } catch {
      toast.error('Failed to clear leech flags');
    } finally {
      setClearingLeeches(false);
    }
  };
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [dialect, setDialect] = useState('Gulf');
  const [level, setLevel] = useState('beginner');
  const [goal, setGoal] = useState('regular');
  const [showOnLeaderboard, setShowOnLeaderboard] = useState(true);
  const [contributeAudio, setContributeAudio] = useState(false);
  const [desiredRetention, setDesiredRetention] = useState<number>(0.9);
  // Purpose + topics. Both feed the server-side learner profile that content
  // generators read, so editing them here changes what gets generated next.
  const [reason, setReason] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[]>([]);

  /**
   * The nine fields `save` actually writes, as loaded.
   *
   * This page mixes two save models: theme, home layout, display preferences,
   * feature hints, review preferences and reminders all apply the moment you
   * touch them, while these nine sit in local state until Save Changes is
   * pressed at the very bottom of a five-thousand-pixel scroll. Nothing said
   * which was which, so the safe assumption — "it saved itself like the last
   * one did" — silently lost the edit.
   *
   * Comparing against the loaded values is what lets the page say so: the save
   * bar appears only when there is something unsaved, which also marks, by its
   * absence, everything that needed no saving at all.
   */
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);

  // Order matters for the comparison, so build it in one place.
  const currentSnapshot = JSON.stringify([
    displayName.trim(),
    dialect,
    level,
    goal,
    showOnLeaderboard,
    contributeAudio,
    desiredRetention,
    reason,
    [...interests].sort(),
  ]);
  // Never "dirty" before the profile has loaded: the defaults above would
  // otherwise read as edits and offer to save them over the real values.
  const isDirty = savedSnapshot !== null && savedSnapshot !== currentSnapshot;

  // Whatever the page shows once loading finishes is, by definition, already
  // saved — including the defaults a learner with no profile row starts from.
  // Taken in an effect rather than at the end of load(), whose closure still
  // holds the pre-load values, and only once: `?? current` never overwrites a
  // real baseline with a later edit.
  useEffect(() => {
    if (loading) return;
    setSavedSnapshot((prev) => prev ?? currentSnapshot);
  }, [loading, currentSnapshot]);

  const push = usePushNotifications();

  // Same taxonomy the Listen catalog uses, scoped to the selected dialect.
  const topicCategories = getTopicCategories(dialect);

  const toggleInterest = (id: string) =>
    setInterests((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/auth');
      return;
    }
    if (!user) return;

    const load = async () => {
      const { data } = await supabase
        .from('profiles' as any)
        .select('display_name, avatar_url, preferred_dialect, proficiency_level, weekly_goal, show_on_leaderboard, learning_reason, interests, contribute_audio, desired_retention')
        .eq('user_id', user.id)
        .maybeSingle();

      if (data) {
        const p = data as any;
        setDisplayName(p.display_name || '');
        setAvatarUrl(p.avatar_url || null);
        setDialect(p.preferred_dialect || 'Gulf');
        setLevel(p.proficiency_level || 'beginner');
        setGoal(p.weekly_goal || 'regular');
        setShowOnLeaderboard(p.show_on_leaderboard ?? true);
        setContributeAudio(p.contribute_audio === true);
        setDesiredRetention(
          typeof p.desired_retention === 'number' && p.desired_retention >= 0.7 && p.desired_retention <= 0.97
            ? p.desired_retention
            : 0.9,
        );
        setReason(reasonIdFromLabel(p.learning_reason));
        setInterests(Array.isArray(p.interests) ? p.interests : []);
      }
      setLoading(false);
    };
    load();
  }, [user, authLoading, isAuthenticated, navigate]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be smaller than 5MB');
      return;
    }

    setUploadingAvatar(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      const newUrl = `${pub.publicUrl}?t=${Date.now()}`;

      const { error: updErr } = await supabase
        .from('profiles' as any)
        .update({ avatar_url: newUrl } as any)
        .eq('user_id', user.id);
      if (updErr) throw updErr;

      setAvatarUrl(newUrl);
      // The emblem in every page's corner reads its own cached copy of this
      // row, so a write that skips it leaves the old picture on screen until
      // the next reload.
      void invalidateProfileAvatar(queryClient, user.id);
      toast.success('Profile picture updated!');
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to upload picture');
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePresetAvatarSelect = async (src: string) => {
    if (!user || src === avatarUrl) return;

    const previous = avatarUrl;
    setAvatarUrl(src); // optimistic — the preset is a local asset, so it renders instantly
    setUploadingAvatar(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ avatar_url: src })
        .eq('user_id', user.id);
      if (error) throw error;

      void invalidateProfileAvatar(queryClient, user.id);
      toast.success('Profile picture updated!');
    } catch (err) {
      console.error(err);
      setAvatarUrl(previous);
      void invalidateProfileAvatar(queryClient, user.id);
      toast.error(err instanceof Error ? err.message : 'Failed to update picture');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles' as any)
        .update({
          display_name: displayName.trim() || null,
          preferred_dialect: dialect,
          proficiency_level: level,
          weekly_goal: goal,
          show_on_leaderboard: showOnLeaderboard,
          contribute_audio: contributeAudio,
          desired_retention: desiredRetention,
          learning_reason: reasonLabel(reason),
          interests,
        } as any)
        .eq('user_id', user.id);

      if (error) throw error;

      // Update weekly goal targets
      const selectedGoal = GOALS.find((g) => g.id === goal);
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

      setSavedSnapshot(currentSnapshot);
      toast.success('Settings saved!');
    } catch (e) {
      console.error(e);
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  if (authLoading || loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell wide>
      <div className="py-4">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold font-heading text-foreground">Settings</h1>
        </div>

        {/*
          The index sits beside the settings from lg and above them below it.

          `AppShell wide` only widens from lg, so on a phone this is still one
          column in DOM order — the chip strip, then the groups — and becomes a
          two-column grid exactly where there is room for one. What it replaces
          is a max-w-lg column: narrower even than the shell's own max-w-2xl,
          which is how a 1440px screen ended up almost entirely empty next to a
          four-thousand-pixel scroll.
        */}
        <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-10">
          <SettingsGroupNav groups={GROUPS} className="mb-6 lg:mb-0" />

          <div className="min-w-0 space-y-12">
            <SettingsGroup group={GROUP.account}>
              {/* Profile Section */}
              <SettingSection icon={User} title="Profile">
                {/* Who you are on the left, what you could look like on the
                    right. Stacked, the preset grid is six 100px medallions
                    across the full column — five hundred pixels of decoration
                    between the upload button and the name field, on a page
                    whose problem is its length. */}
                <div className="space-y-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6 lg:space-y-0">
                  <div className="space-y-3">
                    <div className="flex items-center gap-4">
                      <div className="relative">
                        <Avatar className="h-20 w-20 border-2 border-border">
                          <AvatarImage src={avatarUrl || undefined} alt="Profile picture" />
                          <AvatarFallback className="text-lg font-semibold">
                            {(displayName || user?.email || '?').charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        {uploadingAvatar && (
                          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
                            <Loader2 className="h-6 w-6 animate-spin text-primary" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 space-y-2">
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleAvatarUpload}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploadingAvatar}
                        >
                          <Camera className="h-4 w-4 mr-2" />
                          {avatarUrl ? 'Change picture' : 'Upload picture'}
                        </Button>
                        <p className="text-xs text-muted-foreground">JPG or PNG, up to 5MB</p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="displayName" className="text-foreground">Display Name</Label>
                      <Input
                        id="displayName"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Your display name"
                        maxLength={50}
                      />
                      <p className="text-xs text-muted-foreground">
                        {user?.email}
                      </p>
                    </div>
                  </div>

                  <AvatarPicker
                    value={avatarUrl}
                    onSelect={handlePresetAvatarSelect}
                    disabled={uploadingAvatar}
                  />
                </div>
              </SettingSection>

              {/* Library */}
              <SettingSection icon={Heart} title="My Library">
                <button
                  onClick={() => navigate('/liked-videos')}
                  className="w-full flex items-center justify-between p-3 rounded-xl bg-card border border-border hover:border-primary/30 transition-all"
                >
                  <div className="flex items-center gap-3">
                    <Heart className="h-5 w-5 text-primary fill-primary/30" />
                    <div className="text-left">
                      <p className="font-medium text-foreground text-sm">Liked Videos</p>
                      <p className="text-xs text-muted-foreground">Videos you've saved</p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              </SettingSection>

              {/* Subscription */}
              <SettingSection icon={Heart} title="Subscription">
                <div className="p-3 rounded-xl bg-card border border-border space-y-2">
                  <p className="text-sm font-medium text-foreground">
                    {subscribed ? `Active plan: ${tier === 'allin' ? 'All-In' : 'Standard'}` : 'Free plan'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {subscribed
                      ? 'Manage billing, update payment method, or cancel anytime.'
                      : 'Upgrade to remove daily limits and unlock everything.'}
                  </p>
                  {subscribed ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={handleManageSubscription}
                      disabled={openingPortal}
                    >
                      {openingPortal ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Manage subscription'}
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" className="w-full" onClick={() => navigate('/pricing')}>
                      View plans
                    </Button>
                  )}
                </div>
              </SettingSection>

              {/* Sign Out ends the Account group rather than the page. It was
                  the last thing on a 4,500px scroll, which read as "the end of
                  Settings" — the position a destructive action is least
                  expected in and most easily hit on the way past. Here it is
                  the last thing about *this account*, next to the plan it
                  belongs with, and Save is nowhere near it. */}
              <Button variant="outline" onClick={handleSignOut} className="w-full h-11 text-destructive hover:text-destructive">
                Sign Out
              </Button>
            </SettingsGroup>

            <SettingsGroup group={GROUP.learning}>
              {/* Dialect Section */}
              <SettingSection icon={Globe2} title="Preferred Dialect">
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                  {DIALECTS.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => setDialect(d.id)}
                      className={cn(
                        'flex items-center gap-2 p-3 rounded-xl border-2 transition-all duration-200 text-left',
                        dialect === d.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border bg-card hover:border-primary/30'
                      )}
                    >
                      <span className="text-lg">{d.flag}</span>
                      <div className="min-w-0">
                        <span className="font-medium text-foreground text-sm block">{d.label}</span>
                        <span className="text-xs text-muted-foreground" dir="rtl">{d.labelAr}</span>
                      </div>
                      {dialect === d.id && <Check className="h-4 w-4 text-primary ml-auto shrink-0" />}
                    </button>
                  ))}
                </div>
              </SettingSection>

              {/* Level Section */}
              <SettingSection icon={Target} title="Proficiency Level">
                {/* Five full-width rows are a lot of vertical run for five words
                    each; from lg the column is wide enough to read them two abreast. */}
                <div className="space-y-2 lg:grid lg:grid-cols-2 lg:gap-2 lg:space-y-0">
                  {LEVELS.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => setLevel(l.id)}
                      className={cn(
                        'w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all duration-200 text-left',
                        level === l.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border bg-card hover:border-primary/30'
                      )}
                    >
                      <span className="text-xl">{l.icon}</span>
                      <span className="font-medium text-foreground text-sm flex-1">{l.label}</span>
                      <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{l.cefr}</span>
                      {level === l.id && <Check className="h-4 w-4 text-primary shrink-0" />}
                    </button>
                  ))}
                </div>
              </SettingSection>

              {/* Goal Section */}
              <SettingSection icon={Target} title="Weekly Goal">
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  {GOALS.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => setGoal(g.id)}
                      className={cn(
                        'flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all duration-200',
                        goal === g.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border bg-card hover:border-primary/30'
                      )}
                    >
                      <span className="text-2xl">{g.icon}</span>
                      <span className="font-semibold text-foreground text-sm">{g.label}</span>
                      <span className="text-xs text-muted-foreground">{g.desc}</span>
                    </button>
                  ))}
                </div>
              </SettingSection>

              {/* What you want Arabic for — feeds generated content */}
              <SettingSection icon={Compass} title="What you're learning for">
                <p className="text-xs text-muted-foreground">
                  Shapes the situations and topics in your stories, listening and drills.
                </p>
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                  {LEARNING_REASONS.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setReason((prev) => (prev === r.id ? null : r.id))}
                      aria-pressed={reason === r.id}
                      className={cn(
                        'flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all duration-200',
                        reason === r.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border bg-card hover:border-primary/30'
                      )}
                    >
                      <span className="text-2xl">{r.icon}</span>
                      <span className="font-semibold text-foreground text-sm">{r.label}</span>
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
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
              </SettingSection>

              {/* Review Preferences */}
              <SettingSection icon={AlertTriangle} title="Review Preferences">
                <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border">
                  <div className="min-w-0 pr-3">
                    <p className="font-medium text-foreground text-sm">Flag difficult cards as "leeches"</p>
                    <p className="text-xs text-muted-foreground">
                      After several misses, show an AI mnemonic and memory jingle to help you remember.
                    </p>
                  </div>
                  <Switch checked={leechEnabled} onCheckedChange={setLeechEnabled} />
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border">
                  <div className="min-w-0 pr-3">
                    <p className="font-medium text-foreground text-sm">Show related words from the same root</p>
                    <p className="text-xs text-muted-foreground">
                      Under a card you've answered, quietly list the other words you know that are built
                      from its Arabic root — كتب, كتاب, مكتب.
                    </p>
                  </div>
                  <Switch checked={rootFamiliesEnabled} onCheckedChange={setRootFamiliesEnabled} />
                </div>
                <div className="p-3 rounded-xl bg-card border border-border">
                  <p className="font-medium text-foreground text-sm">Review intensity</p>
                  <p className="text-xs text-muted-foreground mb-2">
                    How reliably you want to remember cards at review time. Lighter means fewer,
                    longer-spaced reviews and a little more forgetting; intense means the reverse.
                  </p>
                  <div className="flex gap-2" role="radiogroup" aria-label="Review intensity">
                    {[
                      { value: 0.85, label: 'Lighter' },
                      { value: 0.9, label: 'Standard' },
                      { value: 0.95, label: 'Intense' },
                    ].map(({ value, label }) => (
                      <Button
                        key={value}
                        size="sm"
                        variant={Math.abs(desiredRetention - value) < 0.001 ? 'default' : 'outline'}
                        role="radio"
                        aria-checked={Math.abs(desiredRetention - value) < 0.001}
                        onClick={() => setDesiredRetention(value)}
                        className="flex-1"
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                  {/* The correction is invisible otherwise, and an invisible
                      scheduler change is indistinguishable from a bug when a
                      learner notices their intervals moved. */}
                  {calibrationNote && (
                    <p className="text-xs text-muted-foreground mt-2">{calibrationNote}</p>
                  )}
                </div>
                {/* Per-learner FSRS weights. On the maintainers' benchmark this is
                    worth more than an algorithm version, and it only ever
                    replaces the defaults when it beats them on history it was
                    not trained on — so the copy says what happened, not that
                    it helped. */}
                <div className="p-3 rounded-xl bg-card border border-border">
                  <p className="font-medium text-foreground text-sm">Personalised scheduling</p>
                  <p className="text-xs text-muted-foreground mb-2">
                    {fittedWeights.weights
                      ? `Your intervals use weights fitted to ${fittedWeights.reviews ?? 'your'} of your own reviews`
                        + (fittedWeights.fittedAt ? ` on ${new Date(fittedWeights.fittedAt).toLocaleDateString()}` : '')
                        + '. Refit any time to include newer history.'
                      : `Once you have ${MIN_REVIEWS_TO_FIT.toLocaleString()} reviews, the scheduler can be fitted to how `
                        + `your memory actually behaves. It only replaces the defaults if it predicts your recall `
                        + `better on reviews it was not trained on.`}
                  </p>
                  <div className="flex items-center gap-3">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!fsrsFit.eligible || fsrsFit.isFitting}
                      onClick={() => { void fsrsFit.fit(); }}
                    >
                      {fsrsFit.isFitting ? 'Fitting…' : fittedWeights.weights ? 'Refit to my reviews' : 'Fit to my reviews'}
                    </Button>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {fsrsFit.reviewCount != null
                        ? `${fsrsFit.reviewCount.toLocaleString()} / ${MIN_REVIEWS_TO_FIT.toLocaleString()} reviews`
                        : ''}
                    </span>
                  </div>
                  {fsrsFit.result && (
                    <p className="text-xs text-muted-foreground mt-2" role="status">
                      {fsrsFit.result.status === 'fitted'
                        ? `Adopted: predicts your recall ${Math.round((fsrsFit.result.improvement ?? 0) * 100)}% better than the defaults on your most recent reviews.`
                        : fsrsFit.result.status === 'kept-defaults'
                          ? 'Kept the defaults — a fit did not predict your recent reviews better than they do. Try again with more history.'
                          : `Not enough history yet (${fsrsFit.result.reviews.toLocaleString()} reviews).`}
                    </p>
                  )}
                  {fsrsFit.error && (
                    <p className="text-xs text-destructive mt-2" role="alert">{fsrsFit.error}</p>
                  )}
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border">
                  <div className="min-w-0 pr-3">
                    <p className="font-medium text-foreground text-sm">Contribute my practice recordings</p>
                    <p className="text-xs text-muted-foreground">
                      Keep my pronunciation clips (with the phrase I was saying and my score) to help
                      improve Arabic speech recognition. Off by default; stored privately, never
                      published, and you can turn this off anytime — see the Terms for details.
                    </p>
                  </div>
                  <Switch checked={contributeAudio} onCheckedChange={setContributeAudio} />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={clearAllLeeches}
                  disabled={clearingLeeches}
                >
                  {clearingLeeches ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Clear all leech flags'}
                </Button>
              </SettingSection>

              {/* Reminders. Hidden entirely when the browser can't do push or the
                  deployment has no VAPID key — a dead toggle is worse than none. */}
              {push.isSupported && (
                <SettingSection icon={Bell} title="Reminders">
                  <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-card border border-border">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground text-sm">Review reminders</p>
                      <p className="text-xs text-muted-foreground">
                        {push.permission === 'denied'
                          ? 'Blocked in your browser settings — allow notifications for this site to enable.'
                          : 'One evening nudge when you have cards waiting.'}
                      </p>
                    </div>
                    <Switch
                      checked={push.isSubscribed}
                      disabled={push.isBusy || push.permission === 'denied'}
                      onCheckedChange={(next) => {
                        if (next) void push.subscribe();
                        else void push.unsubscribe();
                      }}
                    />
                  </div>
                </SettingSection>
              )}
            </SettingsGroup>

            <SettingsGroup group={GROUP.appearance}>
              {/* Appearance Section */}
              <SettingSection icon={Palette} title="Appearance">
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { id: 'light', label: 'Light', desc: 'Warm sand' },
                    { id: 'dark', label: 'Dark', desc: 'Night majlis' },
                    { id: 'system', label: 'System', desc: 'Match device' },
                  ] as { id: ThemePref; label: string; desc: string }[]).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setThemePref(t.id)}
                      aria-pressed={themePref === t.id}
                      className={cn(
                        'rounded-2xl border-2 p-3 text-left transition-all active:scale-[0.98]',
                        themePref === t.id
                          ? 'border-primary bg-primary/5 shadow-soft'
                          : 'border-border bg-card hover:border-primary/30',
                      )}
                    >
                      <span className="block text-sm font-semibold text-foreground">{t.label}</span>
                      <span className="block text-xs text-muted-foreground mt-0.5">{t.desc}</span>
                    </button>
                  ))}
                </div>
              </SettingSection>

              {/* Global Display Preferences */}
              <DisplayPrefsEditor />

              {/* Home Layout */}
              <HomeLayoutEditor />

              {/* Feature Hints */}
              <SettingSection icon={Info} title="Feature Hints">
                <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border">
                  <div className="min-w-0 pr-3">
                    <p className="font-medium text-foreground text-sm">Show feature hints</p>
                    <p className="text-xs text-muted-foreground">
                      Small (i) icons across the app explain what each feature does. Turn off once you know your way around.
                    </p>
                  </div>
                  <Switch checked={hintsEnabled} onCheckedChange={setHintsEnabled} />
                </div>
              </SettingSection>
            </SettingsGroup>

            <SettingsGroup group={GROUP.privacy}>
              {/* Privacy Section */}
              <SettingSection icon={Eye} title="Privacy">
                <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border">
                  <div>
                    <p className="font-medium text-foreground text-sm">Show on Leaderboard</p>
                    <p className="text-xs text-muted-foreground">Others can see your name and XP</p>
                  </div>
                  <Switch checked={showOnLeaderboard} onCheckedChange={setShowOnLeaderboard} />
                </div>
                <TutorMemoryCard />
              </SettingSection>
            </SettingsGroup>

            {/* Room for the unsaved-changes bar, which is fixed and would
                otherwise sit on top of whatever ends the page — the same way
                the Ask AI FAB used to. */}
            {isDirty && <div aria-hidden className="h-20" />}
          </div>
        </div>
      </div>

      {/*
        The unsaved-changes bar.

        Most of this page applies the moment you touch it — theme, home
        layout, display preferences, hints, review preferences, reminders. Nine
        fields do not, and the button for them used to sit at the very bottom
        of a five-thousand-pixel scroll with nothing to distinguish the two
        models. A learner who changed their dialect and navigated away lost it
        and had no way to know.

        So the bar appears only when one of those nine has actually changed,
        and it follows the learner instead of waiting to be scrolled to. Its
        absence is the other half of the message: if nothing appeared, nothing
        is waiting to be saved.
      */}
      {isDirty && (
        <div
          role="status"
          className={cn(
            "fixed inset-x-0 bottom-0 z-40 border-t border-border",
            "bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85",
            // Clear the dock below lg; from lg the dock is a left rail, so the
            // bar starts after it instead. Mirrors AppShell's own insets.
            "pb-[calc(env(safe-area-inset-bottom)+5.5rem)] lg:left-20 lg:pb-[env(safe-area-inset-bottom)]",
            "animate-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none",
          )}
        >
          {/* Same column the page uses, `wide` included, so the button sits
              under the settings it saves rather than under the section index. */}
          <div className="mx-auto flex max-w-2xl lg:max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
            <p className="flex-1 text-sm text-muted-foreground">
              You have unsaved changes.
            </p>
            <Button onClick={save} disabled={saving} className="h-10 shrink-0">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Changes'}
            </Button>
          </div>
        </div>
      )}
    </AppShell>
  );
};

export default Settings;
