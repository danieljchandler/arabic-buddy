# Ardah timing, measured from the reference footage

Measured 2026-10-04 for the Hikaya Ardah animation. Sources and keyframes are in
`docs/reference/ardah/README.md` and `sources.txt`. Every time below is **source-video
time** (ardahN at s.ss). The clips map to the source like this: `clip_ardah1` = ardah1
320–350 s, `clip_ardah2` = ardah2 632–662 s, `clip_ardah3` = ardah3 440–470 s.

## Proposed values

| Constant | Value | Confidence | One-line basis |
|---|---|---|---|
| `ARDAH_DRUM_STROKE_MS` | **1170** | high (for ardah2); medium as a general value | Big-drum stroke period. Audio autocorrelation over 302 twenty-second windows of ardah2: median 1172 ms, IQR 1167–1175. 10 stick strikes timed by frame in ardah2 average 1190 ms |
| `ARDAH_BEAT_MS` | **1200** | low | One continuous ardah1 shot alternates REST and FORWARD: three intervals between pose changes of 1.30, 1.10 and 1.20 s. That is about one drum stroke per pose |
| `ARDAH_SWAY_DEG` | **45** (each way from centre) | low | Read by eye on the 8 extreme frames of the ardah3 sway: right about +51°, left about −37° from vertical after a camera-roll correction. Centre about +7° |
| `ARDAH_SWAY_PERIOD_MS` | **2200** | medium | Four right and four left extremes timed in ardah3: mean full sway 2175 and 2225 ms. This equals 6 drum pulses in that performance (6.05 and 6.19 measured) |
| `SEQUENCE` | **REST → FORWARD → REST → FORWARD …** (repeating), with **OVERHEAD as its own sustained section** | low | REST/FORWARD alternation seen in one ardah1 shot. OVERHEAD is held for whole shots (≥ 26.8 s) in ardah2. No shot shows the change into or out of OVERHEAD |

Two relationships are firmer than the absolute numbers. If the constants need to stay
consistent with each other, derive them from these:

- **One sway = 2 drum strokes = 6 pulses.** In ardah3 the dancer's head bobs every 1.08 s,
  which is 3 pulses, and the blade completes a sway every 2.2 s, which is 6 pulses. At the
  proposed 1170 ms stroke, that gives `ARDAH_SWAY_PERIOD_MS` = 2340. The 2200 above is what
  ardah3 actually measures at its own tempo.
- **One pose per drum stroke.** `ARDAH_BEAT_MS` (1200 ± 100) is the same as
  `ARDAH_DRUM_STROKE_MS` (1142 in ardah1's own drumming) to within measurement error. While
  held, OVERHEAD and REST rows also bob or pump once per stroke: 1159 ms and 1174 ms by
  optical flow.

The three performances run at different tempos: ardah1 1142 ms, ardah2 1170 ms, and ardah3
with a 360 ms pulse. Choose one tempo, then derive the rest from it.

---

## 1. Drum strokes

### Result

The drumming is **a repeating cycle, not evenly spaced strokes.** One cycle in ardah2 is
**1170 ms** (51.3 cycles per minute). Folded over 119 twelve-second windows, it contains:

| ms after the main stroke | What it is | Which frequency bands it shows in |
|---|---|---|
| 0 | main stroke (the big drum, see the video check) | all |
| ~105 | short extra event | mid and high only, not below 250 Hz |
| ~444 | stroke | all |
| ~824 | stroke | all |
| 1170 | next main stroke | |

So there are three strokes per cycle, spaced 444, 380 and 346 ms, plus a flam-like event
about 105 ms after the accent. The underlying pulse is about 390 ms (154 BPM), which is a
third of the cycle. ardah1 has the same shape at its own tempo: 0 / 97 / 388 / 748 ms in a
1142 ms cycle, giving gaps of 388, 360 and 394 ms.

**What I can't tell:** whether the ~105 ms event is a second drummer's stroke or a PA/hall
echo of the accent. In the arena (ardah2), 105 ms of delay is about 36 m of extra path. It
also appears outdoors in ardah1 (at 97 ms, weaker), which argues for a real stroke, but
audio alone can't separate the two. The close-up drummer strikes only once per cycle.

**Steadiness:** across ardah2, the 20-second windows with clear drumming (302 of 456)
have a median period of 1172 ms, IQR 1167–1175, sd 23 ms. The tempo barely moves over
about 25 minutes of drumming.

### Video cross-check

25 fps frames (40 ms apart). The impact frame is the first frame where the stick head
touches the skin.

| Drummer | Impacts (ardah2, s) | Intervals (ms) | Audio onset offset |
|---|---|---|---|
| Big drum, 1395–1401 s close-up (keyframe 10 drum) | 1395.06, 1396.26, 1397.46, 1398.59, 1399.78, 1400.94 | 1200, 1200, 1130, 1190, 1160 (mean 1176, sd 27) | median −50 ms, max 93 |
| Second big drum, 1998–2002 s close-up | 1998.26, 1999.43, 2000.66, 2001.90 | 1170, 1230, 1240 (mean 1213, sd 31) | median −46 ms, max 145 |

That's 10 strikes and 8 intervals, mean **1190 ms**, against 1170 ms from audio. Each
drummer hits **once per cycle**. Between strikes the arm draws the stick back across the
drum face. The −50 ms offset (audio a little ahead of the chosen frame) is one to two
frames, consistent with frame quantisation and with impact frames picked slightly late.

### Ruling out crowd, chant and PA

- **Raw onset detection is misleading here.** librosa's default onset picker on
  `clip_ardah2` gives a median inter-onset interval of 302 ms with a coefficient of
  variation of 0.65: irregular. 85–92% of the energy in the clips is harmonic (chant,
  voice, crowd), and their syllables produce onsets too. Those raw numbers were discarded.
- **Harmonic/percussive separation (HPSS)** removes sustained, pitched sound (chant,
  voice). The 1170 ms periodicity survives in the percussive part.
- **Band split.** The 444 and 824 ms strokes appear in the band below 250 Hz, where big
  drums sit and voice and crowd hiss don't. A chant syllable doesn't hold 1170 ± 8 ms for
  12 minutes.
- **The video check** puts the visible stick impacts on audio onsets within 0–93 ms (one
  outlier at 145 ms).
- **What isn't separable:** drums heard through the PA rather than directly. The timing is
  the same either way; only the ~105 ms event is in question (above).

### Clips not used

- **`clip_ardah1` 0:00–0:15** (ardah1 320–335 s): no stable periodicity (autocorrelation
  r ≤ 0.12). The UNESCO soundtrack has narration and editing over the drums, and there are
  scene cuts at 0.6 and 8.8 s. I used ardah1's clean drumming at 535–585 s instead (r up to
  0.52, period 1142 ms).
- **`clip_ardah2`** agrees with the full-video result: 1168 ms, r = 0.43.

---

## 2. The sway

Shot: ardah3 441.16–452.36 s (11.2 s between two scene cuts). It's a close row seen from
the side, the near dancer facing frame-right, swords held high.

### What the sway is

It's an **arm swing plus a blade tilt**, not a wrist flick.

- **Right extreme:** the sword hand is above the forehead and the blade leans over the
  head toward frame-right, the direction the dancer faces.
- **Left extreme:** the arm is extended up and out to frame-left at about shoulder height,
  and the blade leans to frame-left.

The whole row moves together.

### Period

Extremes timed by eye at 5 fps (±0.1 s):

| Extreme | Times (s) | Intervals (s) |
|---|---|---|
| Right | 443.0, 445.2, 447.3, 449.6, 451.7 | 2.2, 2.1, 2.3, 2.1 (mean **2.175**) |
| Left | 441.7, 444.2, 446.2, 448.5, 450.6 | 2.5, 2.0, 2.3, 2.1 (mean **2.225**) |

**Full sway ≈ 2200 ms**, averaged over 4 cycles from each side. Half-cycles average 1.11 s
(sd 0.10). As an independent check, the tracked head of the near dancer (template match,
score median 0.85) moves down and up every **1.08 s**: ten head-low maxima from 442.2 to
451.9 s. That's two head bobs per sway.

### Amplitude

| Extreme | Frames (15 fps, f####) | Blade from vertical, as seen | After roll correction |
|---|---|---|---|
| Right | f0027, f0060, f0091, f0126 | +46 to +51° (mean ~+48) | ~+51° |
| Left | f0045, f0075 (others too occluded) | −35 to −42° (mean ~−40) | ~−37° |

Read on full-resolution frames against an 80 px grid, from the hilt to the visible end of
the blade. Each reading is good to ±5–10°.

- **Camera correction:** the LED-wall stripes behind the row lean **−2.9°** (median over
  163 frames, IQR −3.5 to −1.1), so +2.9° is added to every reading. The camera pans slowly
  (≤ 81 px over 11 s) but doesn't change angles measured within a frame. Caveat: the
  stripes might not be truly vertical (wall angle, perspective), so the correction is
  itself uncertain by about ±2°.
- **Projection:** the camera is side-on to the swing plane, so foreshortening should be
  small, but it isn't measured.
- **Result:** about +51° / −37° gives a centre of about +7° and **about 44° each way**,
  rounded to 45. Low confidence.

**Automatic tracking failed and wasn't used.** HoughLinesP and contour fits found the near
blade in only 68 of 167 frames, and the overlays showed it often locking onto the wrong
blade (10+ crossing blades, curved sabres, scrolling LED patterns). The output files are
kept for reference (`sway.py`, `blade.py`, `blade.csv`); the angles above come from
reading by eye.

### Lock to the drums

ardah3's drum pulse over 436–458 s is **359.7 ms**.

- **The full sway is 6 pulses** (6.05 by right extremes, 6.19 by left), **half a sway is 3
  pulses** (3.09), and each head bob is 3 pulses (1.08 s / 0.36 s = 3.0). In this
  performance a 3-pulse group (1086 ms) is one stroke cycle, so **one sway = 2 stroke
  cycles.**
- **The phase is locked.** Folding the audio at 6 pulses, the right extreme falls at the
  same position in the group every time (positions 5.0–5.4 relative to the strongest
  pulse). The left extreme spreads more (1.5–2.4).
- **Caveat:** ardah3's audio is ambiguous between 3-pulse grouping (1086 ms, r = 0.43) and
  4-pulse grouping (1446 ms, r = 0.37). The head bob decides it for 3.

---

## 3. Pose changes and order

The broadcast cuts every 2–5 seconds. **Within a shot, a sword row nearly always holds one
pose.** Only one shot in all the requested stretches shows a row changing pose repeatedly.

### The one measured sequence: ardah1 369.30–374.64 s (one shot, camera zooms but no cut)

10 fps frames, labelled by eye. Change times are midpoints between the last frame of one
state and the first frame of the next (±0.05 s).

| Time (s) | State | What's visible |
|---|---|---|
| 369.3–370.05 | REST | Hands at the waist and chest, blades not out |
| **370.05** | → FORWARD | Swords thrust out level toward frame-left (the way the row faces), arm extended |
| 370.5–371.1 | (FORWARD, raised) | Blades lift to about 30–45° above horizontal |
| 371.2–371.3 | (FORWARD, level) | Back down to level |
| **371.35** | → REST | Retracted, hands at the chest |
| **372.45** | → FORWARD | Thrust out level again |
| 372.8–373.3 | (FORWARD, raised) | Blades about 45–60° above horizontal, some near vertical |
| 373.4–373.5 | (FORWARD, level) | Lowering |
| **373.65** | → REST | Retracted |
| 373.7–374.64 | REST | Held until the cut |

- **Durations:** FORWARD 1.30 s and 1.20 s. REST 1.10 s, and at least 0.95 s for the last,
  truncated one.
- **In drum strokes** (ardah1 tempo, 1142 ms): FORWARD about 1.1 strokes, REST about 1.0.
- **Mean interval between changes: 1.20 s.** The narration under this shot gives no usable
  drum tempo (r = 0.13), so the stroke count uses ardah1's drumming tempo from 535–585 s.
  That's an assumption: the same troupe, possibly not the same moment.
- **Optical flow on the row** (motion relative to the frame) gives a horizontal period of
  2256 ms (r = 0.54), which is one REST + FORWARD cycle and agrees with the hand-labelled
  2.3–2.4 s.
- **Inside FORWARD** there's a sub-motion: thrust out level, lift to about 45° (sometimes
  steeper), back to level, retract. It takes the whole of the roughly 1.2 s.

### Stretches with no pose change inside a shot

| Stretch | State, and how long it's held | Notes |
|---|---|---|
| clip_ardah1 second half, ardah1 338.5–350.2 s | REST variants | 338.5–341.5: sword held upright against the body, hilt at the waist, blade up along the chest. 342–346: hands at the chest, bodies rocking side to side, blades mostly hidden. 346.5–350: hilt at the chest, blade up. No FORWARD or OVERHEAD. Cuts at 336.34, 338.44 and 350.25 |
| ardah1 240–262 s | REST (keyframe 5 pose), across several shots | No change seen; shots are 4–9 s |
| ardah1 360–369 s | too wide to read | |
| ardah1 375.0–379.6 s | REST, rows rocking | Low angle. Swords at the chest, bodies sway. Horizontal-flow period ~2.05 s, weak (r = 0.27) |
| ardah2 1390.3–1394.96 s | REST (keyframe 6 pose), held the whole shot (≥ 4.66 s, ≥ 4 strokes) | The row bobs at 1174 ms (vertical-flow r = 0.38): once per drum stroke |
| ardah2 1380–1382, 1404–1410 s | "other": hilts at the waist, blades forward-down | See below |
| ardah2 2205.0–2208.2, 2208.2–2212.3, 2216.0–2242.8 s | **OVERHEAD**, held through all three shots; the last alone is **≥ 26.8 s, ≥ 23 strokes** | The swords pump up and down once per stroke: vertical-flow period **1159 ms**, r = 0.58. At 2208–2212, close-ups show raised blades crossing overhead. The 2212.3–2215.8 cutaway is dignitaries |

So the order between OVERHEAD and REST/FORWARD **can't be measured** from this footage.
Every OVERHEAD shot starts and ends on a cut while still in OVERHEAD.

### States that aren't REST, FORWARD or OVERHEAD

- **Waist-low forward** (ardah2 1294–1317 s, three shots, about 23 s total, and 1380–1382 s):
  hilt at the waist, elbows bent, blade pointing forward and slightly down or level. The arm
  isn't extended, so it isn't FORWARD. Rows shoulder to shoulder, rocking.
- **Lowered** (ardah2 1851–1858.6 s): hilt at belly or waist height, blade angled down
  toward the floor in front of the body.
- **Upright against the body** (ardah1 338.5–341.5 s): described in the table above.
- **Overhead sway** (ardah3 441–452 s): OVERHEAD-height swords swung left and right
  (section 2). Treat it as a variant of OVERHEAD.
- **Horizontal across the chest** (ardah1 403.0–404.5 s, one dancer): sword held level
  across the body at chest height.
- **Hand to the face or ear** (ardah1 405–409 s): a man at the end of a row, hand raised to
  the side of his face, apparently chanting.
- **A different group** (ardah2 1859–1864.5 s): dancers in maroon swinging a white cloth
  and a sword. Not a row; probably a different dance in the same ceremony. Not used.

---

## Method summary and files

All scripts, CSVs and plots are in `C:\ai\projects\arabic-app\reference\ardah\timing\`
(Drive). The 10–25 fps frames and grids used for reading by eye are in
`C:\media\ardah\timing\` (machine A only, not in Drive or git). Python 3.12 venv:
librosa 1.0.0, numpy 2.5.3, scipy 1.18.1, OpenCV 5.0.0.

| File | What it does |
|---|---|
| `drums.py`, `drums2.py` | First pass: HPSS, low-band and prominence onset picking, histograms, spectrograms (`clip*_spec.png`, `clip*_audio.png`) |
| `bands.py` | Band-split envelopes (40–250 Hz, 250–2000 Hz, 2–8 kHz) |
| `tempo_scan.py` | Stroke period across each full video, 20 s windows (`ardahN_tempo_scan.csv` / `.png`) |
| `pattern.py` | Folds each 12 s window at its own refined period, then averages (`*_pattern.csv` / `.png`): the cycle shape in section 1 |
| `av_check.py` | Stick impacts timed by eye vs audio onsets |
| `grid.sh` | 10–25 fps contact grids with source time on each tile |
| `track.py` | Head tracking and camera pan in the sway shot (`track.csv`, `track.png`) |
| `sway.py`, `blade.py` | Automatic blade and stripe angles: **failed for blades, kept for reference**; stripe roll was used |
| `sway_vs_drum.py` | Sway extremes against the drum pulse grid |
| `motion.py` | Optical-flow rhythm of a row within a shot, against the audio period |

## What didn't fit, or couldn't be measured

- **No transition into or out of OVERHEAD** is visible in any shot. The `SEQUENCE` position
  of OVERHEAD is unknown; it's only known to be held for long stretches with a pump per
  stroke.
- **Only one shot shows REST/FORWARD changes:** four changes, in an edited documentary. The
  1.2 s beat and the alternation could be specific to that troupe or moment.
- **The ~105 ms event after each main stroke:** a stroke or an echo, unresolved.
- **The sway angles are by eye** (±5–10°) on a busy, blurred night shot. The left-extreme
  frames are partly occluded.
- **Footwork:** feet aren't visible in any row shot, so steps couldn't be timed.
- **ardah3's grouping** (3 vs 4 pulses) is ambiguous in audio; it's settled for 3 only by
  the head bob.
