## Alphabet polish pass

Three small visual upgrades on top of the existing Alphabet Journey map.

### 1. Mini mastery ring around each stop
- Replace the binary locked/mastered styling on stop markers with a thin SVG ring that fills 0–100% based on the letter's mastery score from `useAlphabetProgress`.
- Locked stops show a dim gray ring; in-progress stops show a partial primary-color arc; fully mastered stops show a complete ring plus the existing ornament/checkmark.
- Ring is purely presentational — sits behind the existing stop button, no layout shift.

### 2. Milestone banners every 7 letters
- After completing letter 7, 14, 21, 28, show a one-time celebratory banner on `AlphabetJourney` ("7 letters mastered — keep going!") with a soft confetti/shine animation.
- Dismissed banners are remembered in `localStorage` so they don't reappear.
- Respects the reduced-motion and sound preferences already in `uiPrefs.ts`.

### 3. Per-step XP popup
- On every correct answer inside `AlphabetLetter` (tracer, sound match, spot-the-letter), float a small "+5 XP" pill upward from the answer area and fade out (~800ms).
- Pure CSS keyframe, no new dependencies. Skipped when `prefersReducedMotion()` is true.

### Files

- `src/components/alphabet/StopMasteryRing.tsx` (new) — SVG ring component, takes `progress: 0..1` and `state: 'locked' | 'active' | 'mastered'`.
- `src/components/alphabet/MilestoneBanner.tsx` (new) — banner with shine animation + dismiss.
- `src/components/alphabet/XPPopup.tsx` (new) — floating "+N XP" element.
- `src/pages/AlphabetJourney.tsx` — render mastery ring around each stop, mount milestone banner when threshold crossed.
- `src/pages/AlphabetLetter.tsx` — trigger XP popup on correct answers in the three mini-games.
- `src/index.css` — keyframes for `xp-float`, `banner-shine`.

No backend or schema changes. Uses existing `useAlphabetProgress` data only.
