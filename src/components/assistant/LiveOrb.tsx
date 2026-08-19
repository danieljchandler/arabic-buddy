import { useEffect, useRef, useId } from "react";
import { useReducedMotion } from "@/lib/uiPrefs";
import { cn } from "@/lib/utils";

/**
 * The orb during a voice call: a terracotta droplet carrying one tone-on-tone
 * band of sadu weave, like the chat bubbles wear.
 *
 * Two kinds of motion, deliberately separated. At rest the outline undulates
 * slowly — a border-radius morph on the inner element, no rotation, the way a
 * drop of liquid sits. When the tutor speaks, the whole orb swells with the
 * voice: the analyser loop writes an amplitude to --level and a wrapper scales
 * with it. The two transforms live on different elements so they compose
 * instead of fighting.
 *
 * This replaced a generated video of a woven sphere. The sphere rotated —
 * which read as a globe, not a voice — and carried four colours, which read
 * as an ornament. Two colours and a pulse is the language the bubbles
 * already speak, and code can couple the pulse to the actual voice, which a
 * video loop never could.
 *
 * The loop writes to a CSS custom property rather than React state: it runs
 * at up to 60fps for the length of a call. The AudioContext is closed on
 * teardown — browsers cap concurrent contexts around six and the realtime
 * hook already holds one.
 */

/** One horizontal band of weave: triangles above and below a diamond run. */
function WeaveBand({ className }: { className?: string }) {
  const pid = `orb-weave-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden className={className}>
      <defs>
        <pattern id={pid} width="25" height="34" patternUnits="userSpaceOnUse">
          <path d="M0.5,7 L6.25,0.5 L12,7 Z M13,7 L18.75,0.5 L24.5,7 Z" fill="#000" />
          <rect y="9" width="25" height="1.5" fill="#000" />
          <path d="M12.5,12.5 L19,21 L12.5,29.5 L6,21 Z" fill="none" stroke="#000" strokeWidth="2" />
          <path d="M12.5,17.5 L15.2,21 L12.5,24.5 L9.8,21 Z" fill="#000" />
          <path d="M0,12.5 L2.8,21 L0,29.5 M25,12.5 L22.2,21 L25,29.5" fill="none" stroke="#000" strokeWidth="2" />
          <rect y="31.5" width="25" height="1.5" fill="#000" />
        </pattern>
      </defs>
      <rect width="100" height="34" fill={`url(#${pid})`} opacity="0.28" />
    </svg>
  );
}

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
      // Not connected to the destination: the realtime hook's own <audio>
      // element is what you hear. This branch only measures.

      const bins = new Uint8Array(analyser.frequencyBinCount);
      let smoothed = 0;

      const tick = () => {
        if (cancelled) return;
        analyser.getByteFrequencyData(bins);
        let sum = 0;
        for (let i = 0; i < bins.length; i++) sum += bins[i];
        const avg = sum / bins.length / 255;
        // Rise fast, fall slowly — the orb rides the shape of a phrase
        // rather than juddering on every consonant.
        smoothed = avg > smoothed ? avg * 0.6 + smoothed * 0.4 : avg * 0.12 + smoothed * 0.88;
        host.style.setProperty("--level", Math.min(1, smoothed * 2.6).toFixed(3));
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
      aria-label={active ? (muted ? "Call live, microphone muted" : "Call live") : "Call connecting"}
    >
      {/* Two rings, the outer one lagging the inner, both driven by --level. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full bg-primary/15"
        style={{
          transform: "scale(calc(1 + var(--level) * 0.5))",
          opacity: "calc(0.25 + var(--level) * 0.45)",
          transition: "transform 90ms linear, opacity 90ms linear",
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-[16%] rounded-full bg-primary/25"
        style={{
          transform: "scale(calc(1 + var(--level) * 0.3))",
          transition: "transform 70ms linear",
        }}
      />

      {/* Voice-coupled swell on the wrapper; idle undulation on the child. */}
      <span
        aria-hidden
        className="relative block h-[64%] w-[64%]"
        style={{
          transform: "scale(calc(1 + var(--level) * 0.12))",
          transition: "transform 80ms linear",
        }}
      >
        <span
          className={cn(
            "relative block h-full w-full overflow-hidden bg-primary",
            reduced ? "rounded-full" : "animate-orb-blob",
            muted && "opacity-70 saturate-50",
            "transition-[opacity,filter] duration-300",
          )}
        >
          <WeaveBand className="absolute inset-x-0 top-1/2 h-[46%] w-full -translate-y-1/2" />
        </span>
      </span>
    </span>
  );
}
