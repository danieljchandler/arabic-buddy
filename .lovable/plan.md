## Goal
Now that Google AI credit is available, fully open up the Lyria-powered jingle feature.

## Changes

### 1. Add Yemeni dialect styling to `generate-word-jingle`
`generate-phrase-jingle` already has a Yemeni branch (`"Yemeni folk-pop style with Yemeni dialect vocals"`), but `generate-word-jingle/index.ts` only branches Egyptian vs. Gulf. Add a matching Yemeni branch so word jingles in the Yemeni module use Yemeni folk-pop instead of falling back to Khaliji.

### 2. Raise daily cap from 5 → 50 per user/day
Both functions call `enforceDailyCap(req, "generate-…-jingle", 5, corsHeaders)`. With paid Google credit the original 5/day throttle is overly conservative. Bump to **50/day per user** in both functions — high enough to feel uncapped during a normal study session, low enough to protect against abuse / runaway loops.

### 3. UI exposure — already done, no change needed
Confirmed both jingle buttons are already wired:
- `MyWordsReview.tsx` (line 612) — 🎵 Generate / Play + regenerate button
- `LeechHelperPanel.tsx` (used by `MyWordsReview` and `MyPhrasesReview`) — "Generate memory jingle" button shown after repeated misses

Nothing to add on the frontend.

## Files touched
- `supabase/functions/generate-word-jingle/index.ts` — add Yemeni branch, bump cap to 50
- `supabase/functions/generate-phrase-jingle/index.ts` — bump cap to 50

## Out of scope
Removing the cap entirely (kept at 50 as a safety net), changing prompts beyond the dialect-style line, or surfacing a new manual entry point — buttons already exist where they make sense (post-leech and per-card).