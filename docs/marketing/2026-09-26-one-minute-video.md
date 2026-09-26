# Hikaya — 60-second marketing video script

Written 2026-09-26 from what the repo actually ships. Voiceover is 142 words
(about 57 s at a relaxed pace). Voiceover linted 5/5 with the slopmonster
`deslop.py`; the rival-model cleanse was not run (no model CLI in the cloud
session that drafted it).

Vertical 9:16 first (the app is portrait and the feed is a phone surface);
a 16:9 cut can letterbox the phone over a sadu-weave background.

## Script

| Time | Picture | Voiceover | On-screen text |
|---|---|---|---|
| 0:00–0:05 | Back seat of a Cairo taxi at dusk, driver half turns and asks something fast in Egyptian Arabic (real audio, subtitled only as "…?"). Learner's face: blank. | You studied Arabic for a year. Then a taxi driver in Cairo asked you something, and you caught none of it. | — |
| 0:05–0:10 | Dinner with Arab friends at a cafe table. The learner has his Fusha grammar book open by his plate; the table laughs, he looks up, back down at the book, up again, lost. | That's because the textbook taught you Fusha. Nobody speaks Fusha at the shop, or out to dinner with friends. | فصحى ≠ what people say |
| 0:10–0:19 | Hikaya logo (sadu frame, sand variant) → the home feed. Thumb taps the dialect pill: Gulf → Egyptian → Yemeni. Vertical swipe through three clips. | Hikaya teaches the Arabic people actually speak. Pick Gulf, Egyptian or Yemeni, and scroll short clips of native speakers. | Gulf · Egyptian · Yemeni |
| 0:19–0:29 | Video player. Subtitle card under the clip. Finger taps one word → popover with meaning. Toggle EN → Literal → Fusha rows on. Tap "Save to My Words", small check animation. | Lost on a word? Tap it. You get the English, the literal meaning, even how it would look in Fusha. One more tap saves it. | Tap any word |
| 0:29–0:35 | `/review`: the saved word appears as a flashcard, flip, rate "Good". | Saved words come back as flashcards right before you'd forget them. | — |
| 0:35–0:45 | Shadow tab: learner repeats the line into the phone, score appears, one sound highlighted. Then the sadu "Ask" button → tutor answers a question about that exact line. | Then say it yourself. Shadow the line, get a score, see which sound to fix. Stuck? Ask the tutor. It knows which line you're on. | Say it. Fix one sound. |
| 0:45–0:52 | Quick split: Alphabet Journey caravan on one side, the feed on the other. | Start with the alphabet, or jump straight into the clips. It's free. | Free to start |
| 0:52–1:00 | Campfire scene from the landing page, lockup fades in. | Hikaya. Every story starts with one word. Join the waitlist. | كل حكاية تبدأ بكلمة · Join the waitlist · hakiya.app |

## What each claim rests on

| Claim | Where it is in the app |
|---|---|
| Three dialects, switched from the feed | `src/pages/Feed.tsx` dialect pill |
| Tap a word; EN / Literal / Fusha rows; save | `src/pages/DiscoverVideo.tsx` |
| Words return before you forget | FSRS-6, `src/lib/spacedRepetition.ts`, `/review` |
| Shadowing score, which sound to fix | Shadow tab, `src/lib/shadowScoring.ts`; `/pronunciation` |
| Tutor knows the line you're on | Ask AI page context, `usePageAiContext` |
| Alphabet start | `/alphabet` (28-letter journey) |
| Free | Free plan is permanent, `src/pages/Pricing.tsx` |

## Before filming — traps found in the repo

1. **Signup needs an invite code** (`src/pages/Auth.tsx`, "Invite code required"),
   so the call to action is a waitlist (decided 2026-09-26). **The app has no
   waitlist yet**: nothing in `src/`, the migrations or `public/` collects an
   email without an invite code. It has to exist, and the end card's URL has to
   land on it, before the video goes out.
2. **Film the Shadow tab on a non-TikTok clip.** QA audit 2026-09-04 (M1): slow
   listen and shadowing audio fail on the TikTok-sourced videos.
3. **Pick a clip with word-level timing.** Only ~34% of lines had it at the
   2026-09-04 audit (M5); the rest highlight whole lines, which reads worse on
   camera.
4. **Don't film `/curriculum`.** The same audit found it empty in production;
   the seed migration landed after, and a merged migration isn't applied until
   Lovable runs it. Check the live site first. That's why the script shows the
   alphabet and the feed, not the lesson path.
5. **Don't say "every word recorded by native speakers".** The landing page
   does, but lesson and flashcard audio is synthetic (Munsit Faseeh,
   `docs/tts-voice-routing.md`). The videos are real speakers; the script only
   claims those.
6. **No speed claims.** `docs/follow-ups-2026-09.md` #4: "Claim the on-ramp,
   never the accelerator." The script never says faster or fluent.
7. **Domain vs name.** The app is Hikaya; the URL is `hakiya.app`. On screen
   the mismatch reads like a typo. Say the name aloud, show the URL small, or
   point at a `hikaya.*` domain if one exists.
8. **No numbers.** No user counts or ratings exist to cite. If a stat is wanted,
   the checkable ones are "3 dialects" and "28-letter alphabet journey"; lesson
   counts are uneven (Gulf 23, Yemeni 20, Egyptian 11 of 38 each) and not worth
   putting on screen.

## Alternatives for the hook

Same body, different first five seconds, depending on who the ad targets
(the onboarding "why are you learning" options are work, family & partner,
living there, travel, faith & study, media):

- **Partner / in-laws:** "Your mother-in-law says something. Everyone laughs. You smile and nod."
- **MSA learners:** "You can read the news in Arabic. You can't order coffee in Cairo."
- **Relocating for work:** "Your new colleagues switch to Arabic the moment the meeting ends."
