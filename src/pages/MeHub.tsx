import { Link } from "react-router-dom";
import {
  BookOpen, Languages, FileText, Heart, BarChart3, Trophy, Users, User, Settings,
  CreditCard, GraduationCap, BookMarked, Newspaper, Globe2, Compass,
  MessageCircleQuestion, Laugh, Twitter, Mic, BookOpenText, CalendarCheck,
  MessagesSquare, SpellCheck, Target, TriangleAlert, Headset, Shuffle, Swords,
  Headphones, Quote, ArrowRightLeft, Library, Layers, type LucideIcon,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { useAuth } from "@/hooks/useAuth";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useBibleAccess } from "@/hooks/useBibleAccess";
import { useUserXP } from "@/hooks/useGamification";
import { useSRSStats } from "@/hooks/useSRSStats";
import { cn } from "@/lib/utils";

/**
 * Your account, your library, your tools.
 *
 * This was twenty-two rows in five sections, every one a rounded card with an
 * icon chip and a sentence of description, and five different accent colours
 * left over from before the brand guide. Reading all of it took longer than
 * doing any of it — which is the failure mode of a hub: it becomes a page you
 * scan rather than a page you use. It is also now the page behind the corner
 * emblem, so it is the page the new navigation points at.
 *
 * Three things changed. Numbers come first, because the reason to open your
 * own page is to see where you are. The library is four blocks, since those
 * are the only entries here that hold your own material. And everything else
 * is a label under an icon: the descriptions were what made the page long, and
 * "Meme Analyzer" does not need a sentence explaining it once you have seen
 * the icon next to it.
 *
 * The practice section exists because deleting the hubs would otherwise
 * strand working features — Ingleezy shipped exactly that bug: six features
 * whose tests all kept passing, because a test navigates by URL and never
 * asks how a person would have got there.
 *
 * Since the skills got their own pages, anything that trains one of the four
 * has a home under that skill, and this page is the exhaustive index rather
 * than the only door. It stays exhaustive on purpose: "I know it exists and I
 * cannot remember where it lives" needs one page that lists everything, and
 * that is a different job from helping someone choose what to do next.
 */

interface Item {
  label: string;
  icon: LucideIcon;
  to: string;
  show?: boolean;
}

/** Your own material. The only entries that are yours rather than the app's. */
const library = (signedIn: boolean): Item[] => [
  { label: "My Words", icon: BookOpen, to: "/my-words", show: signedIn },
  { label: "Saved Translations", icon: Languages, to: "/translate/saved", show: signedIn },
  { label: "My Transcriptions", icon: FileText, to: "/my-transcriptions", show: signedIn },
  { label: "Liked Videos", icon: Heart, to: "/liked-videos", show: signedIn },
];

/** Tools and content, one grid. The old split between them was a distinction
 *  the learner never had to make: both are things you go and do. */
const tools = (signedIn: boolean, bible: boolean): Item[] => [
  { label: "Translate", icon: Languages, to: "/translate" },
  { label: "Transcribe", icon: Mic, to: "/transcribe" },
  { label: "Tutor Upload", icon: GraduationCap, to: "/tutor-upload", show: signedIn },
  { label: "How do I say…?", icon: MessageCircleQuestion, to: "/how-do-i-say" },
  { label: "Culture Guide", icon: Compass, to: "/culture-guide" },
  { label: "Dialect Compare", icon: Globe2, to: "/dialect-compare" },
  { label: "Stories", icon: BookOpenText, to: "/stories" },
  { label: "Souq News", icon: Newspaper, to: "/souq-news" },
  { label: "Reading Library", icon: Library, to: "/reading-library" },
  { label: "Bible Reading", icon: BookMarked, to: "/bible", show: bible },
  { label: "Meme Analyzer", icon: Laugh, to: "/meme" },
  { label: "Learn from X", icon: Twitter, to: "/learn-from-x" },
  { label: "MSA Bridge", icon: ArrowRightLeft, to: "/bridge" },
];

/**
 * Practice modes whose only doors were the deleted hubs. Practising is not
 * the same kind of act as translating something, so they get their own
 * section rather than folding into the tools grid.
 */
const practice = (signedIn: boolean): Item[] => [
  { label: "Today", icon: CalendarCheck, to: "/today" },
  { label: "Review", icon: Layers, to: "/review", show: signedIn },
  { label: "Quick Practice", icon: Shuffle, to: "/learn" },
  { label: "Set Phrases", icon: Quote, to: "/set-phrases" },
  { label: "Conversation", icon: MessagesSquare, to: "/conversation" },
  { label: "Grammar Drills", icon: SpellCheck, to: "/grammar" },
  { label: "Daily Challenge", icon: Target, to: "/daily-challenge" },
  { label: "Listening", icon: Headphones, to: "/listening" },
  { label: "Vocab Battles", icon: Swords, to: "/battles" },
  { label: "Your Mistakes", icon: TriangleAlert, to: "/mistakes", show: signedIn },
  { label: "Native Feedback", icon: Headset, to: "/native-feedback", show: signedIn },
];

const progress = (signedIn: boolean): Item[] => [
  { label: "Analytics", icon: BarChart3, to: "/analytics", show: signedIn },
  { label: "Leaderboard", icon: Trophy, to: "/leaderboard" },
  { label: "Friends", icon: Users, to: "/friends", show: signedIn },
];

const account = (signedIn: boolean, admin: boolean): Item[] => [
  { label: "Profile", icon: User, to: "/profile", show: signedIn },
  { label: "Settings", icon: Settings, to: "/settings", show: signedIn },
  { label: "Pricing & Plans", icon: CreditCard, to: "/pricing" },
  { label: "Admin", icon: GraduationCap, to: "/admin", show: admin },
];

const visible = (items: Item[]) => items.filter((i) => i.show !== false);

/** Section accents — the charcoal→terracotta ramp Choose's skill tiles use
 *  (src/lib/surfaces.ts tints), so the hub's hierarchy comes from the brand
 *  ramp rather than the pre-brand-guide per-section colours this page once
 *  had. Account stays neutral on purpose: it is chrome, not content.
 *
 *  Chips carry the accent at 15%. The first pass used 8%, which on a page of
 *  thirty tiles was invisible — the hierarchy it was meant to buy simply was
 *  not legible. */
const ACCENTS = {
  library: "#2E3532",
  tools: "#4A3733",
  practice: "#6B3A31",
  progress: "#8C4135",
} as const;

const MeHub = () => {
  const { isAuthenticated } = useAuth();
  const { isAdmin } = useAdminAuth();
  const { hasAccess: hasBible } = useBibleAccess();
  const { data: xp } = useUserXP();
  const { data: srs } = useSRSStats();

  return (
    <AppShell>
      <h1 className="pb-1 pt-1 text-[28px] font-bold leading-tight">Me</h1>
      <p className="pb-5 text-sm text-muted-foreground">Your library, tools &amp; account.</p>

      {/* Where you are, before what you can do. */}
      <div className="mb-7 grid grid-cols-3 overflow-hidden rounded-2xl bg-primary text-primary-foreground">
        <Stat value={xp?.level ?? 1} label="Level" />
        <Stat value={srs?.totalCards ?? 0} label="Words" divided />
        <Stat value={srs?.totalDueNow ?? 0} label="Due now" divided />
      </div>

      <Section title="Your library">
        <div className="grid grid-cols-2 gap-2.5">
          {visible(library(isAuthenticated)).map(({ label, icon: Icon, to }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex items-center gap-3 rounded-2xl border border-border bg-card p-4",
                "transition-colors active:bg-muted",
              )}
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                style={{ backgroundColor: `${ACCENTS.library}26`, color: ACCENTS.library }}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="text-sm font-semibold leading-tight">{label}</span>
            </Link>
          ))}
        </div>
      </Section>

      <Section title="Tools & content">
        <Grid items={visible(tools(isAuthenticated, hasBible))} accent={ACCENTS.tools} />
      </Section>

      <Section title="Practice">
        <Grid items={visible(practice(isAuthenticated))} accent={ACCENTS.practice} />
      </Section>

      <Section title="Progress">
        <Grid items={visible(progress(isAuthenticated))} accent={ACCENTS.progress} />
      </Section>

      <Section title="Account">
        <Grid items={visible(account(isAuthenticated, isAdmin))} />
      </Section>
    </AppShell>
  );
};

function Stat({ value, label, divided }: { value: number; label: string; divided?: boolean }) {
  return (
    <div className={cn("px-2 py-4 text-center", divided && "border-l border-primary-foreground/20")}>
      <span className="block text-2xl font-bold leading-tight tabular-nums">{value}</span>
      <span className="text-[11px] text-primary-foreground/75">{label}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Tiles are links, not buttons: every one of them navigates, and a hub built
 *  from buttons gives up middle-click, open-in-new-tab, and the browser's own
 *  idea of what it is looking at. */
function Grid({ items, accent }: { items: Item[]; accent?: string }) {
  return (
    <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
      {items.map(({ label, icon: Icon, to }) => (
        <Link
          key={`${to}-${label}`}
          to={to}
          className={cn(
            "flex flex-col items-center gap-1.5 rounded-2xl border border-border bg-card px-1 py-3.5 text-center",
            "transition-colors active:bg-muted",
          )}
        >
          <span
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-xl",
              !accent && "bg-muted text-muted-foreground",
            )}
            style={accent ? { backgroundColor: `${accent}26`, color: accent } : undefined}
          >
            <Icon className="h-5 w-5" />
          </span>
          <span className="text-[11px] font-medium leading-tight">{label}</span>
        </Link>
      ))}
    </div>
  );
}

export default MeHub;
