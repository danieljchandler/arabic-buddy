import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import {
  Headphones, AudioLines, Video, BookOpen, Library, Newspaper, BookOpenText,
  BookMarked, Mic, MessagesSquare, Headset, PenLine, SpellCheck, ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ProfileEmblem } from "@/components/shell/ProfileEmblem";
import { BrandMark } from "@/components/shell/BrandMark";
import { SKILL_BY_ID, type Activity } from "@/lib/surfaces";
import { useSwipeSurfaces } from "@/hooks/useSwipeSurfaces";
import { useAuth } from "@/hooks/useAuth";
import { useBibleAccess } from "@/hooks/useBibleAccess";
import { cn } from "@/lib/utils";

/**
 * One skill, and everything in the app that trains it.
 *
 * This page exists because the chooser's four tiles used to point straight at
 * a single page each — "Read" opened /reading, one of five reading surfaces —
 * which left the Reading Library, Souq News, Stories and Bible Reading with no
 * door anywhere except the account page, listed under "Tools & content"
 * between the meme analyser and the dialect comparer. Every one of them still
 * worked. None of them could be found by looking for reading.
 *
 * So a skill tile now opens the skill. The list is short enough to read at a
 * glance — three to five entries, not the thirteen the old Practice hub
 * carried — and short enough to afford a line of description each, which is
 * what makes it scannable rather than a wall of identical chips.
 *
 * The first entry is the one most people picking this skill want, and it is
 * styled as the primary so the common path is still one obvious tap.
 */

const ICONS: Record<string, LucideIcon> = {
  Headphones, AudioLines, Video, BookOpen, Library, Newspaper, BookOpenText,
  BookMarked, Mic, MessagesSquare, Headset, PenLine, SpellCheck,
};

const Skill = () => {
  const { skillId } = useParams<{ skillId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { hasAccess: hasBible } = useBibleAccess();
  // A skill sits one page forward of the chooser, so a backward swipe —
  // rightward — returns to it, the same way the chooser returns to the feed.
  const swipe = useSwipeSurfaces({ onPrev: () => navigate("/choose") });

  const skill = skillId ? SKILL_BY_ID.get(skillId) : undefined;
  // An unknown skill is a mistyped URL, not a page. The chooser is the honest
  // answer to "which skill did you mean".
  if (!skill) return <Navigate to="/choose" replace />;

  const granted = (a: Activity) =>
    a.requires === "bible" ? hasBible : a.requires === "auth" ? isAuthenticated : true;
  const activities = skill.activities.filter(granted);
  const [primary, ...rest] = activities;

  return (
    <AppShell>
      <div {...swipe} className="flex flex-col gap-2.5">
        <header className="flex items-center justify-between gap-3">
          <BrandMark />
          <div className="flex items-center gap-3">
            <Link to="/choose" className="text-xs text-muted-foreground">
              ← Skills
            </Link>
            <ProfileEmblem />
          </div>
        </header>

        {/* The skill wears its own tile colour, so arriving here reads as
            opening the block you just tapped rather than landing somewhere new. */}
        <div
          className="mt-3 flex items-end justify-between rounded-2xl p-5 text-white"
          style={{ backgroundColor: skill.tint }}
        >
          <span className="flex flex-col gap-0.5">
            <h1 className="text-[28px] font-bold leading-tight">{skill.label}</h1>
            <span dir="rtl" lang="ar" className="font-arabic text-[15px] text-white/60">
              {skill.arabic}
            </span>
          </span>
          {(() => {
            const Icon = ICONS[skill.icon];
            return Icon ? <Icon className="h-8 w-8 text-white/35" /> : null;
          })()}
        </div>

        {primary && <Row activity={primary} primary />}
        {rest.map((a) => (
          <Row key={a.to} activity={a} />
        ))}
      </div>
    </AppShell>
  );
};

function Row({ activity, primary }: { activity: Activity; primary?: boolean }) {
  const Icon = ICONS[activity.icon];
  return (
    <Link
      to={activity.to}
      className={cn(
        "flex items-center gap-3 rounded-xl border px-4 py-3.5 transition-colors",
        primary
          ? "border-primary bg-primary/10 active:bg-primary/15"
          : "border-border bg-card active:bg-muted",
      )}
    >
      {Icon && <Icon className="h-5 w-5 shrink-0 text-primary" />}
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm", primary ? "font-semibold" : "font-medium")}>
          {activity.label}
        </span>
        <span className="block text-[11px] text-muted-foreground">{activity.description}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

export default Skill;
