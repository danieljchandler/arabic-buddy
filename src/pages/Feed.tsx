import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bookmark, MessageCircleQuestion, Captions, RotateCcw, Play, Flame } from "lucide-react";
import { AppDock } from "@/components/shell/AppDock";
import { ProfileEmblem } from "@/components/shell/ProfileEmblem";
import { useDiscoverFeed } from "@/hooks/useDiscoverFeed";
import { useSwipeSurfaces } from "@/hooks/useSwipeSurfaces";
import { useAuth } from "@/hooks/useAuth";
import { useUserVocabularyDueCount } from "@/hooks/useUserVocabulary";
import { useDialect, type DialectModule } from "@/contexts/DialectContext";
import { supabase } from "@/integrations/supabase/client";
import { LoadingPanel } from "@/components/loading/LoadingPanel";
import { AppShell } from "@/components/layout/AppShell";
import { LandingHero } from "@/components/LandingHero";
import { Footer } from "@/components/Footer";
import { cn } from "@/lib/utils";

/**
 * The home screen: real dialect Arabic, one clip at a time.
 *
 * The app used to open on a checklist — a greeting, a goal ring, and a queue
 * of task rows. That is a fine dashboard and a poor front door for something
 * people are meant to open out of habit. This opens on content, the way every
 * app this audience already uses does, and the dashboard moves to /today.
 *
 * Vertical scroll moves through clips. A leftward swipe opens the chooser —
 * see useSwipeSurfaces for why that is the forward direction.
 *
 * The action rail is where the old hub lists went. "Transcript" and "Ask" were
 * destinations you navigated to and then had to feed with content; here they
 * are buttons on the clip in front of you, which is what they always were.
 *
 * Where Ingleezy's feed header carries For-you/Following, this one carries the
 * dialect: Hakiya has three of them, that choice is exactly what filters the
 * feed, so it belongs at the top of the feed rather than in a card halfway
 * down a dashboard. (The ritual flip-card switcher survives on /today.)
 */

const DIALECTS: { id: DialectModule; label: string }[] = [
  { id: "Gulf", label: "Gulf" },
  { id: "Egyptian", label: "Egyptian" },
  { id: "Yemeni", label: "Yemeni" },
];

const Feed = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { activeDialect, setDialect } = useDialect();
  const [seed] = useState(() => Math.floor(Math.random() * 100000));
  const { data: feed, isLoading } = useDiscoverFeed(seed);
  const { data: dueStats } = useUserVocabularyDueCount();
  const swipe = useSwipeSurfaces({ onNext: () => navigate("/choose") });

  // The chip is a number that opens the page explaining the number; the same
  // row StreakDisplay reads on /today.
  const { data: streak } = useQuery({
    queryKey: ["review-streak", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("review_streaks")
        .select("current_streak")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  const items = useMemo(() => feed?.items ?? [], [feed]);

  // A visitor who has never signed in has no feed to show — the recommender
  // is keyed on their history — so the front door stays the landing page for
  // them. Dropping a stranger into an empty video feed would be the worst
  // possible first impression of an app whose whole pitch is the content.
  if (!authLoading && !isAuthenticated) {
    return (
      <AppShell>
        <LandingHero />
        <Footer />
      </AppShell>
    );
  }

  return (
    <div
      {...swipe}
      className="dark relative min-h-[100dvh] bg-black text-white"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {/* Chrome floats over the media rather than pushing it down — the clip
          is the page, so nothing above it should claim vertical space. */}
      <header
        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-3 pt-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        <div className="pointer-events-auto">
          <ProfileEmblem hasNews={(dueStats?.dueCount ?? 0) > 0} />
        </div>
        {/* The dialect is what filters this feed, so it sits on the feed. */}
        <div
          className="pointer-events-auto flex items-center gap-0.5 rounded-full bg-black/45 p-1 backdrop-blur"
          role="group"
          aria-label="Dialect"
        >
          {DIALECTS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDialect(d.id)}
              aria-pressed={activeDialect === d.id}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
                activeDialect === d.id
                  ? "bg-[#E2C5A6] text-[#2A1C16]"
                  : "text-white/60 hover:text-white",
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
        {/* The streak opens your day, not your account. Tapping a number to
            find out where that number came from is the only thing this chip
            can mean, and /today is the page that answers it. */}
        <Link
          to="/today"
          className="pointer-events-auto flex items-center gap-1 text-sm font-bold text-[#E2C5A6]"
        >
          <Flame className="h-4 w-4" />
          <span className="tabular-nums">{streak?.current_streak ?? 0}</span>
        </Link>
      </header>

      {isLoading ? (
        <div className="flex min-h-[100dvh] items-center justify-center">
          <LoadingPanel size="sm" />
        </div>
      ) : items.length === 0 ? (
        <EmptyFeed />
      ) : (
        <ul className="h-[100dvh] snap-y snap-mandatory overflow-y-auto overscroll-y-contain">
          {items.map(({ video }) => (
            <li key={video.id} className="relative h-[100dvh] snap-start snap-always">
              <Clip video={video} />
            </li>
          ))}
        </ul>
      )}

      <AppDock />
    </div>
  );
};

/**
 * One clip. The thumbnail stands in until the learner taps play — autoplaying
 * an embed per card would burn data on a phone and is the single fastest way
 * to make a feed feel expensive to open.
 */
function Clip({
  video,
}: {
  video: {
    id: string;
    title: string;
    title_arabic: string | null;
    thumbnail_url: string | null;
    duration_seconds: number | null;
  };
}) {
  const mins = video.duration_seconds
    ? `${Math.floor(video.duration_seconds / 60)}:${String(video.duration_seconds % 60).padStart(2, "0")}`
    : null;

  return (
    <>
      {video.thumbnail_url ? (
        <img
          src={video.thumbnail_url}
          alt=""
          aria-hidden
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        // The brand's warm ramp where a thumbnail is missing — sand into
        // desert red into char, not a grey box.
        <div className="absolute inset-0 bg-gradient-to-br from-[#8C4135] via-[#5C3A46] to-[#20191A]" />
      )}
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(rgba(18,10,8,0.55)_0%,transparent_22%,transparent_45%,rgba(18,10,8,0.92)_100%)]"
      />

      <Link
        to={`/discover/${video.id}`}
        aria-label={`Play ${video.title}`}
        className="absolute inset-0 z-10 grid place-items-center"
      >
        <span className="grid h-16 w-16 place-items-center rounded-full bg-black/45 backdrop-blur">
          <Play className="h-7 w-7 fill-white" />
        </span>
      </Link>

      {/* Verbs, applied to this clip. This rail is why the hub lists could go. */}
      <div className="absolute bottom-40 right-2 z-20 grid gap-4">
        <RailButton icon={Bookmark} label="Save" to={`/discover/${video.id}`} />
        <RailButton icon={MessageCircleQuestion} label="Ask" to="/how-do-i-say" />
        <RailButton icon={Captions} label="Transcript" to={`/discover/${video.id}`} />
        <RailButton icon={RotateCcw} label="Replay" to={`/discover/${video.id}`} />
      </div>

      <div className="absolute inset-x-0 bottom-28 z-20 px-3.5">
        {mins && (
          <span className="mb-2 inline-block rounded bg-black/50 px-2 py-0.5 text-[10px] font-semibold tabular-nums">
            {mins}
          </span>
        )}
        {/* The Arabic is the material, so the Arabic is the big line; the
            English gloss rides underneath — the same contract as the
            transcript pages, and the mirror of Ingleezy's feed. */}
        {video.title_arabic ? (
          <>
            <p dir="rtl" lang="ar" className="text-right font-arabic text-[21px] font-bold leading-relaxed">
              {video.title_arabic}
            </p>
            <p className="mt-1 text-[13px] text-white/75">{video.title}</p>
          </>
        ) : (
          <p className="text-[19px] font-semibold leading-snug">{video.title}</p>
        )}
      </div>
    </>
  );
}

function RailButton({
  icon: Icon,
  label,
  to,
}: {
  icon: typeof Bookmark;
  label: string;
  to: string;
}) {
  return (
    <Link to={to} aria-label={label} className="grid justify-items-center gap-1">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-black/45 backdrop-blur">
        <Icon className="h-5 w-5" />
      </span>
      <span className="text-[9px] text-white/85">{label}</span>
    </Link>
  );
}

/**
 * An empty feed is the real risk of this whole format — a video app with no
 * videos is worse than a list. So the empty state does not apologise; it hands
 * over the two things that work without a library behind them.
 */
function EmptyFeed() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-5 px-8 text-center">
      <div>
        <p className="text-lg font-semibold">No new clips right now</p>
        <p className="mt-1 text-sm text-white/60">
          Upload a clip you love and we&apos;ll turn it into a lesson, or pick a skill to practise.
        </p>
      </div>
      <div className="flex gap-2.5">
        <Link
          to="/tutor-upload"
          className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          Upload a clip
        </Link>
        <Link
          to="/choose"
          className={cn(
            "rounded-xl border border-white/20 px-4 py-2.5 text-sm font-semibold",
            "transition-colors active:bg-white/10",
          )}
        >
          Pick a skill
        </Link>
      </div>
    </div>
  );
}

export default Feed;
