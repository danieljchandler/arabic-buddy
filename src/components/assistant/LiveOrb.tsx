import { useEffect, useRef } from "react";
import { SaduBubble } from "@/components/brand/SaduBubble";
import { useReducedMotion } from "@/lib/uiPrefs";
import { cn } from "@/lib/utils";

/**
 * The bubble during a voice call, breathing with whatever the tutor is saying.
 *
 * The point of this kind of animation is that it is *reactive* — it is how you
 * can see the call is alive and who is talking. A pre-rendered loop cannot do
 * that, so this reads the model's own audio through an AnalyserNode and drives
 * two rings from the amplitude.
 *
 * The loop writes to a CSS custom property rather than to React state: this
 * runs at up to 60fps for the length of a call, and re-rendering a component
 * tree that often to move two rings would be an absurd amount of work for the
 * main thread.
 *
 * The AudioContext is created here and closed on teardown. Browsers cap
 * concurrent contexts at around six, and the realtime hook already keeps one,
 * so leaking one per call would break voice after a handful of sessions.
 */
export function LiveOrb({
  stream,
  active,
  muted = false,
  className,
}: {
  /** The tutor's voice. Null before the call connects. */
  stream: MediaStream | null;
  active: boolean;
  muted?: boolean;
  className?: string;
}) {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Idle at rest, and stay there for anyone who asked for less motion.
    if (!stream || !active || reduced) {
      host.style.setProperty("--level", "0");
      return;
    }

    let ctx: AudioContext | null = null;
    let raf = 0;
    let cancelled = false;

    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctor();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      // Deliberately not connected to the destination: the realtime hook's own
      // <audio> element is what you hear. This branch only measures.

      const bins = new Uint8Array(analyser.frequencyBinCount);
      let smoothed = 0;

      const tick = () => {
        if (cancelled) return;
        analyser.getByteFrequencyData(bins);
        let sum = 0;
        for (let i = 0; i < bins.length; i++) sum += bins[i];
        const avg = sum / bins.length / 255;
        // Ease upward fast and fall away slowly, or the rings judder on every
        // consonant instead of riding the shape of a phrase.
        smoothed = avg > smoothed ? avg * 0.6 + smoothed * 0.4 : avg * 0.12 + smoothed * 0.88;
        host.style.setProperty("--level", (Math.min(1, smoothed * 2.6)).toFixed(3));
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } catch {
      host.style.setProperty("--level", "0");
    }

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      try { void ctx?.close(); } catch { /* noop */ }
    };
  }, [stream, active, reduced]);

  return (
    <span
      ref={hostRef}
      className={cn("relative grid place-items-center", className)}
      style={{ ["--level" as string]: 0 }}
      role="status"
      aria-label={active ? (muted ? "Call live, microphone muted" : "Call live") : "Call idle"}
    >
      {/* Two rings, the outer one lagging the inner, both driven by --level. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full bg-primary/15"
        style={{
          transform: "scale(calc(1 + var(--level) * 0.55))",
          opacity: "calc(0.25 + var(--level) * 0.45)",
          transition: "transform 90ms linear, opacity 90ms linear",
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-[18%] rounded-full bg-primary/25"
        style={{
          transform: "scale(calc(1 + var(--level) * 0.32))",
          transition: "transform 70ms linear",
        }}
      />
      <SaduBubble
        tone={muted ? "charcoal" : "terracotta"}
        className="relative h-[58%] w-auto"
      />
    </span>
  );
}
