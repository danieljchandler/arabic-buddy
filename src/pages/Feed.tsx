import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Flame } from "lucide-react";
import { AppDock } from "@/components/shell/AppDock";
import { BrandMark } from "@/components/shell/BrandMark";
import { SaduPlayButton } from "@/components/brand/SaduPlayButton";
import { useDiscoverFeed } from "@/hooks/useDiscoverFeed";
import type { DiscoverVideo } from "@/hooks/useDiscoverVideos";
import { useSwipeSurfaces } from "@/hooks/useSwipeSurfaces";
import { useAuth } from "@/hooks/useAuth";
import { useDialect, type DialectModule } from "@/contexts/DialectContext";
import { supabase } from "@/integrations/supabase/client";
import { LoadingPanel } from "@/components/loading/LoadingPanel";
import { AppShell } from "@/components/layout/AppShell";
import { LandingHero } from "@/components/LandingHero";
import { Footer } from "@/components/Footer";
import { cn } from "@/lib/utils";
import { VideoThumbnail } from "@/components/media/VideoThumbnail";

/**
 * The full video experience — the same component /discover/:videoId serves,
 * lazy so the feed's own chunk stays light, prefetched the moment the feed
 * mounts so that by the time anyone taps a clip it is already here.
 */
const InlineVideoPlayer = lazy(() => import("./DiscoverVideo"));
const prefetchPlayer = () => import("./DiscoverVideo");

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
 * There is no action rail. It once carried your picture, Save and Ask — and
 * Save and Ask were labels wearing button shapes: Save just opened the player
 * (where saving actually happens) and Ask navigated away. The clip already
 * opens on a tap, the sadu Ask button floats over every screen, and your
 * picture lives in the dock's fifth slot, so the rail had nothing left to say.
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
  const queryClient = useQueryClient();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { activeDialect, setDialect } = useDialect();
  const [seed] = useState(() => Math.floor(Math.random() * 100000));
  const { data: feed, isLoading, isError, refetch } = useDiscoverFeed(seed);
  const swipe = useSwipeSurfaces({ onNext: () => navigate("/choose") });

  // OAuth sign-in redirects here, not to /auth — so without this gate a
  // Google signup never met the onboarding wizard at all: no dialect, no
  // level, no tour, straight into the feed. Same check /auth and /today run.
  useEffect(() => {
    if (!isAuthenticated || authLoading || !user) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("onboarding_completed")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data && !data.onboarding_completed) navigate("/onboarding");
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, authLoading, user, navigate]);

  /**
   * The clip playing in place. Tapping a card used to navigate to
   * /discover/:id — a route change, a chunk load and a refetch between the
   * tap and the first frame. Now the same page component mounts in an overlay
   * over the feed, so the only thing between the tap and the player is one
   * render. The route still exists, unchanged, for deep links and shares.
   */
  const [openVideoId, setOpenVideoId] = useState<string | null>(null);
  // Whether we pushed a history entry for the open overlay — the back button
  // must close the clip, not leave the feed, because that is what back means
  // in every video app this audience already uses.
  const pushedHistory = useRef(false);

  useEffect(() => {
    // Warm the player chunk while the learner is still browsing, so opening
    // a clip never waits on the network for code.
    prefetchPlayer();
  }, []);

  const openVideo = useCallback(
    (video: DiscoverVideo) => {
      // The feed already holds the full row; seeding the cache means the
      // player mounts with its data in hand instead of showing a spinner
      // while refetching what we were just looking at.
      queryClient.setQueryData(["discover-video", video.id], video);
      setOpenVideoId(video.id);
      window.history.pushState({ hakiyaClip: video.id }, "");
      pushedHistory.current = true;
    },
    [queryClient],
  );

  const closeVideo = useCallback(() => {
    if (pushedHistory.current) {
      // Pop the entry we pushed; the popstate handler does the actual close,
      // so ✕ and the browser's back button take exactly the same path.
      window.history.back();
    } else {
      setOpenVideoId(null);
    }
  }, []);

  /** The clip an entry stands for, if it stands for one. */
  const clipOf = (state: unknown): string | null => {
    const id = (state as { hakiyaClip?: unknown } | null)?.hakiyaClip;
    return typeof id === "string" && id ? id : null;
  };

  useEffect(() => {
    const onPopState = (e: PopStateEvent) => {
      // Landing back *on* a clip entry — the learner opened a clip, followed a
      // link out of it, and pressed back. The entry says a clip was open, so
      // reopen it. Treating every pop as a close left that entry dead: back
      // returned to a feed with no overlay and had to be pressed twice.
      const clipId = clipOf(e.state);
      pushedHistory.current = clipId !== null;
      setOpenVideoId(clipId);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Same restoration on mount, for the entry the learner returns to after the
  // feed has unmounted entirely.
  useEffect(() => {
    const clipId = clipOf(window.history.state);
    if (clipId) {
      pushedHistory.current = true;
      setOpenVideoId(clipId);
    }
  }, []);

  useEffect(() => {
    if (!openVideoId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeVideo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openVideoId, closeVideo]);

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
          <BrandMark />
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
      ) : isError ? (
        // A failed fetch is not an empty library — showing EmptyFeed here told
        // learners the app had no content whenever the network blipped.
        <FeedError onRetry={() => refetch()} />
      ) : items.length === 0 ? (
        <EmptyFeed />
      ) : (
        <ul className="h-[100dvh] snap-y snap-mandatory overflow-y-auto overscroll-y-contain">
          {items.map(({ video }, index) => (
            <li key={video.id} className="relative h-[100dvh] snap-start snap-always">
              {/* The first clip fills the viewport on arrival, so its still is
                  the page's largest paint — not something to defer. */}
              <Clip video={video} onOpen={openVideo} eager={index === 0} />
            </li>
          ))}
        </ul>
      )}

      <AppDock />

      {/* The inline player. Portaled to <body> for two reasons: it must sit
          above the dock, and it must escape the feed's `dark` wrapper — this
          is the same DiscoverVideo the route serves, and it should look
          exactly the same, light chrome and all. */}
      {openVideoId &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Video player"
            className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-background"
          >
            <Suspense
              fallback={
                <div className="flex min-h-[100dvh] items-center justify-center">
                  <LoadingPanel size="sm" />
                </div>
              }
            >
              <InlineVideoPlayer key={openVideoId} videoId={openVideoId} onBack={closeVideo} />
            </Suspense>
          </div>,
          document.body,
        )}
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
  onOpen,
  eager = false,
}: {
  video: DiscoverVideo;
  onOpen: (video: DiscoverVideo) => void;
  eager?: boolean;
}) {
  const mins = video.duration_seconds
    ? `${Math.floor(video.duration_seconds / 60)}:${String(video.duration_seconds % 60).padStart(2, "0")}`
    : null;
  const open = () => onOpen(video);

  return (
    <>
      <VideoThumbnail
        src={video.thumbnail_url}
        sources={video}
        alt={video.title}
        decorative
        loading={eager ? "eager" : "lazy"}
        className="absolute inset-0 h-full w-full object-cover"
        fallback={
          // The brand's warm ramp where a thumbnail is missing — sand into
          // desert red into char, not a grey box.
          <div className="absolute inset-0 bg-gradient-to-br from-[#8C4135] via-plum to-[#20191A]" />
        }
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(rgba(18,10,8,0.55)_0%,transparent_22%,transparent_45%,rgba(18,10,8,0.92)_100%)]"
      />

      {/* A button, not a link to /discover/:id: the player opens in place,
          over the feed, so the tap-to-playing gap is one render instead of a
          route change, a chunk load and a refetch. The route survives for
          deep links; the feed just stops using it. */}
      <button
        type="button"
        onClick={open}
        aria-label={`Play ${video.title}`}
        className="absolute inset-0 z-10 grid w-full place-items-center"
      >
        <SaduPlayButton className="h-16 w-16 drop-shadow-[0_2px_10px_rgba(0,0,0,0.45)] transition-transform active:scale-95" />
      </button>

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

/**
 * An empty feed is the real risk of this whole format — a video app with no
 * videos is worse than a list. So the empty state does not apologise; it hands
 * over the two things that work without a library behind them.
 */
function FeedError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-5 px-8 text-center">
      <div>
        <p className="text-lg font-semibold">The feed didn&apos;t load</p>
        <p className="mt-1 text-sm text-white/60">
          Check your connection and try again — your clips are still there.
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
      >
        Try again
      </button>
    </div>
  );
}

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
