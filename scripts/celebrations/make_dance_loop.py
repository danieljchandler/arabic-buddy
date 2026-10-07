"""Cut a dance's music loop from a recording, on the dance's measured beat.

    pip install librosa soundfile numpy        (ffmpeg on the PATH)
    python scripts/celebrations/make_dance_loop.py IN OUT.mp3 --period-ms 1170 \
        [--from 632 --to 662] [--seconds 6] [--no-stretch]

The celebration scenes are timed to constants measured from footage
(src/lib/dances.ts), so the music has to keep the same clock. The script:

1. reads the stretch --from..--to (seconds) of IN as mono audio;
2. finds the recording's own period near --period-ms (onset autocorrelation,
   searched within 15% either way) and, unless --no-stretch, time-stretches
   the audio so that period becomes exactly --period-ms;
3. picks the start whose beat grid (start + k * period) lands on the strongest
   onsets, so the first pose of the scene falls on a beat;
4. cuts whole periods covering at least --seconds (the longest scene is 6 s),
   fades the ends, normalises loudness and writes a small mono MP3.

It prints what it found (the recording's period, the stretch applied, the
start time in the source) for docs/celebrations.md. Use --no-stretch where the
dance is not locked to the music (the Tanoura's turn, the Sana'ani bob).
"""
import argparse
import subprocess
import tempfile
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

SR = 44100
HOP = 256


def onset_envelope(y):
    return librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP)


def own_period(env, period_s):
    """The recording's period near the expected one, from the envelope's
    autocorrelation; None when no clear peak exists."""
    ac = librosa.autocorrelate(env - env.mean())
    frame_s = HOP / SR
    lo, hi = int(period_s * 0.85 / frame_s), int(period_s * 1.15 / frame_s) + 1
    if hi >= len(ac):
        return None
    window = ac[lo:hi]
    k = int(np.argmax(window))
    if window[k] <= 0 or k in (0, len(window) - 1):
        return None
    # Parabolic interpolation for a sub-frame estimate.
    a, b, c = ac[lo + k - 1], ac[lo + k], ac[lo + k + 1]
    shift = 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) else 0
    return (lo + k + shift) * frame_s


def best_start(env, period_s, cycles):
    """The start (seconds) whose beat grid sums the most onset strength."""
    frame_s = HOP / SR
    span = period_s * cycles
    last = len(env) * frame_s - span - 0.05
    best, best_t = -1.0, 0.0
    for t in np.arange(0.0, max(last, 0.0), 0.005):
        idx = np.round((t + np.arange(cycles) * period_s) / frame_s).astype(int)
        # A little tolerance either side of each beat.
        score = sum(env[max(i - 1, 0): i + 2].max() for i in idx if i < len(env))
        if score > best:
            best, best_t = score, float(t)
    return best_t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--period-ms", type=float, required=True)
    ap.add_argument("--from", dest="start", type=float, default=0.0)
    ap.add_argument("--to", dest="end", type=float, default=None)
    ap.add_argument("--seconds", type=float, default=6.0)
    ap.add_argument("--no-stretch", action="store_true")
    ap.add_argument("--bitrate", default="96k")
    args = ap.parse_args()

    duration = None if args.end is None else args.end - args.start
    y, _ = librosa.load(args.src, sr=SR, mono=True, offset=args.start, duration=duration)
    period_s = args.period_ms / 1000

    env = onset_envelope(y)
    found = own_period(env, period_s)
    rate = 1.0
    if found and not args.no_stretch:
        rate = found / period_s
        y = librosa.effects.time_stretch(y, rate=rate)
        env = onset_envelope(y)

    cycles = int(np.ceil(args.seconds / period_s))
    start = best_start(env, period_s, cycles + 1)
    a, b = int(start * SR), int((start + cycles * period_s) * SR)
    clip = y[a:b].copy()

    fade_in, fade_out = int(0.008 * SR), int(0.12 * SR)
    clip[:fade_in] *= np.linspace(0, 1, fade_in)
    clip[-fade_out:] *= np.linspace(1, 0, fade_out)
    rms = np.sqrt(np.mean(clip**2)) or 1.0
    clip *= 10 ** (-18 / 20) / rms
    peak = np.abs(clip).max()
    if peak > 0.89:
        clip *= 0.89 / peak

    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "clip.wav"
        sf.write(wav, clip, SR)
        subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav), "-ac", "1", "-b:a", args.bitrate, args.out],
            check=True,
        )

    print(
        f"{args.out}: {cycles} x {args.period_ms:.0f} ms = {cycles * period_s:.2f} s; "
        f"own period {found * 1000 if found else float('nan'):.0f} ms; "
        f"stretch x{1 / rate:.3f}; starts at {args.start + start * rate:.2f} s in the source"
    )


if __name__ == "__main__":
    main()
