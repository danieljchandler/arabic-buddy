import { useLocation } from "react-router-dom";
import art from "@/assets/sadu-ask.svg";
import { useAiAssistant } from "@/contexts/AiAssistantContext";
import { useAuth } from "@/hooks/useAuth";
import { isAssistantOffRoute } from "@/lib/assistantRoutes";
import { cn } from "@/lib/utils";

/**
 * Floating "Ask AI" button, mounted once at the app root (next to
 * AssistantMount, which owns Cmd/Ctrl+K and the lazy panel). The disc is the
 * assistant's one always-visible way in: the chips on a sentence, a tapped
 * word and the phrase of the day only exist where there is content to hang
 * them on, and a first-time learner has no way to know a keystroke exists.
 *
 * Its first life ended for sitting on top of the bottom dock: it dropped to
 * `bottom-6` from `md`, but the dock stays a bottom bar until `lg` — so on a
 * tablet the disc landed on the bar, over the Review due count. The geometry
 * now follows the dock's own breakpoint: above the bar (`bottom-20`) until
 * `lg`, and only then into the corner the left rail leaves free. The feedback
 * FAB owns the bottom-left; this owns the bottom-right.
 *
 * Hidden while the panel is open — the panel is the button, opened — on the
 * routes where a tutor has no business (ASSISTANT_OFF_ROUTES: auth,
 * onboarding, admin), and for a visitor who is not signed in. The last one is
 * not a permission check (the panel enforces its own): it is that the disc sat
 * on top of the marketing page offering a signed-out visitor a tutor they
 * cannot open, right beside a dock of tabs they cannot use.
 * Must do no fetching on mount: the route sweep renders every page.
 */
export function AskAiFab({ className }: { className?: string }) {
  const { openChat, isOpen } = useAiAssistant();
  const { pathname } = useLocation();
  const { isAuthenticated } = useAuth();

  if (isAssistantOffRoute(pathname) || isOpen || !isAuthenticated) return null;

  return (
    <button
      type="button"
      aria-label="Ask AI"
      data-feedback-ignore="true"
      onClick={() => openChat()}
      className={cn(
        // z-[46] rather than z-40: the dock and the feed's inline video player
        // are both full-width chrome below it (z-40 and z-[45]), and the disc
        // has to clear them — an Ask AI button hidden behind the player was
        // the whole reason the feed had no way in. It stays *below* the
        // modal layer (z-50), so a dialog still covers it.
        "fixed right-3 bottom-20 z-[46] flex flex-col items-center gap-1",
        "transition-transform hover:scale-105 active:scale-95",
        "lg:bottom-6 lg:right-6",
        className,
      )}
    >
      {/* The loud sadu cloth — the play button's rejected first face, kept in
          docs/branding because it wanted an element that can afford to be
          loud. This is that element. The Arabic question mark says what the
          button takes; see sadu-ask.svg for why it is painted, not cut. */}
      <img
        src={art}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="h-12 w-12 drop-shadow-[0_2px_10px_rgba(0,0,0,0.45)]"
      />
      {/* The label rides its own chip rather than trusting whatever is behind
          the button — this floats over dark video and warm sand alike. */}
      <span className="rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold leading-none text-white backdrop-blur">
        Ask AI
      </span>
    </button>
  );
}
