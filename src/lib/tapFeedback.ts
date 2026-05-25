/**
 * Gentle tap chime using Web Audio API.
 * No external assets needed — generates a soft bell-like tone.
 */
let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioCtx;
}

export function playTapChime() {
  try {
    const ctx = getCtx();
    if (ctx.state === "suspended") ctx.resume();

    const t = ctx.currentTime;

    // Primary tone — soft bell
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(880, t); // A5
    osc.frequency.exponentialRampToValueAtTime(440, t + 0.25);

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.12, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(t);
    osc.stop(t + 0.4);

    // Harmonic overtone for warmth
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();

    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(1320, t); // E6
    osc2.frequency.exponentialRampToValueAtTime(660, t + 0.2);

    gain2.gain.setValueAtTime(0, t);
    gain2.gain.linearRampToValueAtTime(0.04, t + 0.015);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);

    osc2.start(t);
    osc2.stop(t + 0.35);
  } catch {
    // Audio context not available — silently fail
  }
}

export function playSuccessChime() {
  try {
    const ctx = getCtx();
    if (ctx.state === "suspended") ctx.resume();

    const t = ctx.currentTime;

    // Ascending triad for success
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t + i * 0.08);

      gain.gain.setValueAtTime(0, t + i * 0.08);
      gain.gain.linearRampToValueAtTime(0.1, t + i * 0.08 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.4);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t + i * 0.08);
      osc.stop(t + i * 0.08 + 0.45);
    });
  } catch {
    // silently fail
  }
}

/** Trigger a brief haptic-style visual pop on an element. */
export function hapticPop(el: HTMLElement) {
  el.classList.add("animate-pop");
  el.addEventListener(
    "animationend",
    () => el.classList.remove("animate-pop"),
    { once: true }
  );
}

/** Combined tap feedback: sound + visual pop. */
export function tapFeedback(el?: HTMLElement | null) {
  playTapChime();
  if (el) hapticPop(el);
}
