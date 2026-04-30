import { useState, useEffect, useRef } from 'react';
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
import { Loader2, Check, ArrowLeft, User, Globe2, Target, Eye, Heart, ChevronRight, Camera } from 'lucide-react';
import { HomeLayoutEditor } from '@/components/settings/HomeLayoutEditor';
import { BibleDisplayPrefsEditor } from '@/components/settings/BibleDisplayPrefsEditor';

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [dialect, setDialect] = useState('Gulf');
  const [level, setLevel] = useState('beginner');
  const [goal, setGoal] = useState('regular');
  const [showOnLeaderboard, setShowOnLeaderboard] = useState(true);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/auth');
      return;
    }
    if (!user) return;

    const load = async () => {
      const { data } = await supabase
        .from('profiles' as any)
        .select('display_name, avatar_url, preferred_dialect, proficiency_level, weekly_goal, show_on_leaderboard')
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
      toast.success('Profile picture updated!');
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to upload picture');
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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
    <AppShell>
      <div className="max-w-lg mx-auto py-4">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold font-heading text-foreground">Settings</h1>
        </div>

        <div className="space-y-8">
          {/* Profile Section */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <User className="h-4 w-4" />
              Profile
            </div>

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
          </section>

          {/* Dialect Section */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <Globe2 className="h-4 w-4" />
              Preferred Dialect
            </div>
            <div className="grid grid-cols-2 gap-2">
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
          </section>

          {/* Level Section */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <Target className="h-4 w-4" />
              Proficiency Level
            </div>
            <div className="space-y-2">
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
          </section>

          {/* Goal Section */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <Target className="h-4 w-4" />
              Weekly Goal
            </div>
            <div className="grid grid-cols-2 gap-2">
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
          </section>

          {/* Library */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <Heart className="h-4 w-4" />
              My Library
            </div>
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
          </section>

          {/* Home Layout */}
          <HomeLayoutEditor />

          {/* Bible Display Prefs */}
          <BibleDisplayPrefsEditor />

          {/* Privacy Section */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <Eye className="h-4 w-4" />
              Privacy
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border">
              <div>
                <p className="font-medium text-foreground text-sm">Show on Leaderboard</p>
                <p className="text-xs text-muted-foreground">Others can see your name and XP</p>
              </div>
              <Switch checked={showOnLeaderboard} onCheckedChange={setShowOnLeaderboard} />
            </div>
          </section>

          {/* Save + Sign Out */}
          <div className="space-y-3 pb-8">
            <Button onClick={save} disabled={saving} className="w-full h-11">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Changes'}
            </Button>
            <Button variant="outline" onClick={handleSignOut} className="w-full h-11 text-destructive hover:text-destructive">
              Sign Out
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
};

export default Settings;
