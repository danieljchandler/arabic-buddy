import { useLocation } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { AppBackdrop } from "@/components/layout/AppBackdrop";

/**
 * What the app shows while a route's chunk is still in flight.
 *
 * Every page is lazy-loaded behind one app-level <Suspense>, so this is the
 * first thing a learner sees on any navigation that isn't already cached. It
 * used to be one shape for all of them — a header, a row of three stat tiles
 * and a six-card grid — which is a fair guess for perhaps four routes and a
 * lie for the rest. Promising a card grid and delivering a video player is
 * worse than promising nothing: the layout visibly rearranges itself the
 * moment the real page mounts, which reads as a glitch.
 *
 * So the fallback asks where it is going. `useLocation` is available here
 * because the <Suspense> sits inside <BrowserRouter>, and the location
 * updates on navigation rather than on resolution — the skeleton knows the
 * destination before the destination exists.
 *
 * Shapes are deliberately coarse. Five buckets cover ~70 routes; the point is
 * that the *silhouette* is right (one big surface vs. a column of rows vs. a
 * grid of tiles), not that each page gets a bespoke tracing of itself, which
 * would be a second copy of every layout to keep in sync.
 */

/** Matches AppShell, so content lands where the skeleton was standing. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    // data-testid: the e2e suite waits for this to disappear rather than
    // racing the loader, so every shape has to carry it.
    <div data-testid="page-skeleton" className="min-h-[100dvh] bg-background">
      {/* Keeps the sadu frame on screen across the gap. Without it the whole
          chrome blinks out and back on every navigation to an uncached
          route, which is more noticeable than any shape underneath. */}
      <AppBackdrop />
      <div
        style={{ paddingTop: "calc(var(--sadu-band-height) + 1rem)" }}
        className="relative mx-auto w-full max-w-2xl px-4 pb-24 sm:px-6"
      >
        {children}
      </div>
    </div>
  );
}

/** The page's own title bar — every shape opens with one. */
function Heading() {
  return (
    <div className="space-y-2 mb-6">
      <Skeleton className="h-7 w-44" />
      <Skeleton className="h-4 w-64" />
    </div>
  );
}

type Shape = "feed" | "card" | "list" | "hub" | "page";

/**
 * Which silhouette a path is about to become.
 *
 * Ordered most-specific first: `/review/my-words` is a card screen and has to
 * be decided before the `/my-words` list rule can claim it.
 */
export function shapeForPath(pathname: string): Shape {
  const path = pathname.toLowerCase();

  // One immersive surface: the video feed and a single video's page.
  if (path === "/" || path === "/discover" || path.startsWith("/discover/")) return "feed";

  // One card at a time, with an answer row under it.
  if (
    path.startsWith("/review") ||
    path.startsWith("/quiz/") ||
    path.startsWith("/learn/") ||
    path.startsWith("/stories/") ||
    path.startsWith("/alphabet/")
  ) {
    return "card";
  }

  // A column of rows.
  if (
    path === "/my-words" ||
    path === "/saved-chats" ||
    path === "/translate/saved" ||
    path === "/leaderboard" ||
    path === "/mistakes" ||
    path === "/my-transcriptions" ||
    path === "/liked-videos" ||
    path === "/souq" ||
    path.startsWith("/reading")
  ) {
    return "list";
  }

  // A grid of tiles.
  if (path === "/me" || path === "/choose" || path.startsWith("/admin")) return "hub";

  return "page";
}

function FeedShape() {
  return (
    <Frame>
      <Skeleton className="h-[62dvh] w-full rounded-3xl" />
      <div className="mt-4 space-y-2">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    </Frame>
  );
}

function CardShape() {
  return (
    <Frame>
      <Skeleton className="h-64 w-full rounded-2xl" />
      {/* The four grading buttons, which is what the learner's hand is
          already reaching for. */}
      <div className="mt-4 grid grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-11 rounded-xl" />
        ))}
      </div>
    </Frame>
  );
}

function ListShape() {
  return (
    <Frame>
      <Heading />
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-2xl border border-border/60 p-3">
            <Skeleton className="h-11 w-11 rounded-xl shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

function HubShape() {
  return (
    <Frame>
      <Heading />
      <Skeleton className="h-20 w-full rounded-2xl mb-6" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    </Frame>
  );
}

function PageShape() {
  return (
    <Frame>
      <Heading />
      <div className="grid grid-cols-3 gap-3 mb-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    </Frame>
  );
}

const SHAPES: Record<Shape, () => JSX.Element> = {
  feed: FeedShape,
  card: CardShape,
  list: ListShape,
  hub: HubShape,
  page: PageShape,
};

/** The Suspense fallback. Picks its shape from the route being navigated to. */
export function PageSkeleton() {
  const { pathname } = useLocation();
  const Shape = SHAPES[shapeForPath(pathname)];
  return <Shape />;
}

export { Skeleton };
