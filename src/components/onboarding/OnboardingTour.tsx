import { useEffect, useLayoutEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { X, ChevronRight } from "lucide-react";

const TOUR_KEY = "hakiya:tourCompleted";
const TRIGGER_KEY = "hakiya:showTour";

export function markTourPending() {
  try { localStorage.setItem(TRIGGER_KEY, "1"); } catch { /* private mode: no storage, no tour */ }
}

interface Step {
  selector: string;
  title: string;
  body: string;
  placement?: "top" | "bottom" | "center";
}

/**
 * Four steps, not five. The old tour walked five tabs because the old nav had
 * five places to explain; a feed you scroll needs no explaining, so the steps
 * are only the things that are not obvious from looking: where the skills
 * went, that upload takes your own clip, and that the mark is your account.
 * Each step names the slot it points at with the same word the slot itself
 * uses — a tour that calls it something else is describing a screen the
 * reader cannot find.
 */
const STEPS: Step[] = [
  {
    selector: "[data-tour='nav-feed']",
    title: "Home",
    body: "Real dialect clips, one after another. Scroll up for the next one; tap any clip for the transcript and translation.",
    placement: "top",
  },
  {
    selector: "[data-tour='nav-choose']",
    title: "Skills",
    body: "Listening, reading, speaking and writing each have their own page — reach them here, or swipe the feed sideways.",
    placement: "top",
  },
  {
    selector: "[data-tour='nav-upload']",
    title: "Upload",
    body: "Got a clip you love? Upload it and we'll turn it into a lesson — transcript, vocabulary and exercises from the same video.",
    placement: "top",
  },
  {
    selector: "[data-tour='emblem']",
    title: "Your account",
    body: "The Hakiya mark in the corner opens your page: saved words, progress and settings. When something's waiting, it gets a ring.",
    placement: "bottom",
  },
];

interface Rect { top: number; left: number; width: number; height: number }

export function OnboardingTour() {
  const [active, setActive] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    try {
      const done = localStorage.getItem(TOUR_KEY);
      const pending = localStorage.getItem(TRIGGER_KEY);
      if (!done && pending) {
        // Defer to let nav mount
        setTimeout(() => setActive(true), 400);
      }
    } catch { /* private mode: no storage, no tour */ }
  }, []);

  const step = STEPS[stepIdx];

  const measure = useCallback(() => {
    if (!step) return;
    const el = document.querySelector(step.selector) as HTMLElement | null;
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  useLayoutEffect(() => {
    if (!active) return;
    measure();
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [active, measure, stepIdx]);

  const finish = () => {
    try {
      localStorage.setItem(TOUR_KEY, "1");
      localStorage.removeItem(TRIGGER_KEY);
    } catch { /* private mode: the tour may rerun, which beats crashing it */ }
    setActive(false);
  };

  const next = () => {
    if (stepIdx < STEPS.length - 1) setStepIdx((i) => i + 1);
    else finish();
  };

  if (!active) return null;

  const PAD = 8;
  const highlight = rect
    ? {
        top: rect.top - PAD,
        left: rect.left - PAD,
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
      }
    : null;

  // Tooltip positioning: above the highlight, but if tight to top, below.
  const tooltipTop = highlight
    ? highlight.top > 220
      ? highlight.top - 180
      : highlight.top + highlight.height + 12
    : window.innerHeight / 2 - 90;

  return createPortal(
    <div className="fixed inset-0 z-[9999]" aria-modal="true" role="dialog">
      {/* Dim overlay with cutout via box-shadow trick */}
      {highlight ? (
        <div
          className="absolute rounded-2xl pointer-events-none transition-all duration-300"
          style={{
            top: highlight.top,
            left: highlight.left,
            width: highlight.width,
            height: highlight.height,
            boxShadow: "0 0 0 9999px rgba(15, 12, 20, 0.65)",
            outline: "2px solid rgba(255,255,255,0.85)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/65" />
      )}

      {/* Tooltip */}
      <div
        className="absolute left-1/2 -translate-x-1/2 w-[min(360px,90vw)] rounded-2xl bg-white shadow-2xl border border-[#5C3A46]/20 p-4 animate-in fade-in zoom-in-95 duration-200"
        style={{ top: tooltipTop }}
      >
        <div className="flex items-start justify-between gap-2 mb-1">
          <h3 className="font-bold text-foreground" style={{ fontFamily: "'Montserrat', sans-serif" }}>
            {step.title}
          </h3>
          <button
            onClick={finish}
            className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 p-1"
            aria-label="Skip tour"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{step.body}</p>
        <div className="flex items-center justify-between mt-4">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === stepIdx ? "w-5 bg-[#5C3A46]" : "w-1.5 bg-[#5C3A46]/25"
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={finish} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1">
              Skip
            </button>
            <Button size="sm" onClick={next} className="h-8">
              {stepIdx === STEPS.length - 1 ? "Done" : "Next"}
              {stepIdx < STEPS.length - 1 && <ChevronRight className="h-3.5 w-3.5 ml-0.5" />}
            </Button>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground/70 mt-2 text-center">
          Step {stepIdx + 1} of {STEPS.length}
        </p>
      </div>
    </div>,
    document.body
  );
}
