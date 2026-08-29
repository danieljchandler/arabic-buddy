import { AppShell } from "@/components/layout/AppShell";
import { LandingHero } from "@/components/LandingHero";
import { Footer } from "@/components/Footer";

/**
 * What a signed-out visitor sees: the hero, the footer, and the shell they sit
 * in.
 *
 * It is a component because two routes need exactly this. "/" is the video
 * feed for a signed-in learner and the landing page for a visitor (Feed.tsx),
 * and /today is the daily dashboard for a learner and the landing page for a
 * visitor (Index.tsx). Both had their own copy of the same three lines, and
 * the copies had already drifted once — `wide` was added to one of them and
 * not the other, so /today's landing rendered its card grids at 672px while
 * "/" rendered them at 1024px. The bug was invisible because both pages
 * *looked* right in isolation.
 *
 * `wide` rather than the default max-w-2xl because LandingHero's card grids
 * already ask for max-w-3xl, which the narrower shell silently clamps: the
 * three value cards and the three dialect cards were rendering at roughly
 * 200px each on a 1440px screen, on the one page a stranger judges the product
 * by. The shell still holds max-w-2xl below lg, so phones and tablets are
 * untouched.
 */
export function LandingPage() {
  return (
    <AppShell wide>
      <LandingHero />
      <Footer />
    </AppShell>
  );
}
