import borderFullPageImg from "@/assets/border-full-page.webp";

/**
 * The fixed sadu frame behind every screen.
 *
 * Its own component because two things need it: AppShell, which every page
 * mounts, and the Suspense fallback, which stands in the gap *between* two
 * pages. Without it in the fallback the frame blinks out and back on every
 * navigation to an uncached route — the band, the sand, all of it — which is
 * a more noticeable flaw than whatever the skeleton underneath is doing.
 *
 * The art carries both the band at the top and the sand field below it. In
 * light that field is the paper the app is printed on; in night majlis it is
 * dimmed sand over near-black, which comes out a muddy brown that lifts the
 * page above --card and makes every card read as a hole. `.app-backdrop`
 * (index.css) masks the field away in dark and keeps the band.
 */
export function AppBackdrop() {
  return (
    <div
      aria-hidden
      className="app-backdrop opacity-95 dark:opacity-60"
      style={{
        position: "fixed",
        inset: 0,
        backgroundImage: `url(${borderFullPageImg})`,
        backgroundSize: "cover",
        backgroundPosition: "top center",
        backgroundRepeat: "no-repeat",
        pointerEvents: "none",
      }}
    />
  );
}
