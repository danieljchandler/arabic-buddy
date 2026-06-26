# Reorganize the app into 5 clear hubs (Discover preserved)

Group every existing page into one of 5 hubs with a persistent bottom nav, and turn the home screen into a calm "Today" dashboard instead of a feature catalog. **Discover keeps its current full-screen, immersive look exactly as it is today** — it's the marquee feature and the bottom nav must not shrink or reframe it.

## The 5 hubs (bottom nav)

```text
[ Today ]  [ Learn ]  [ Discover ]  [ Practice ]  [ Me ]
```

Discover gets its own dedicated tab in the middle slot (the highest-prominence position on a mobile bottom nav) because it's a primary draw.

1. **Today** (`/`) — daily dashboard only
   - Majlis welcome, dialect switcher, Continue card, MSA bridge entry
   - Due reviews, daily challenge, daily story, phrase of the day
   - Streak / XP / weekly goal, one "Jump back in" row
   - No feature grid here anymore

2. **Learn** (`/learn-hub`) — structured curriculum
   - Placement Quiz, Alphabet Journey, Curriculum lessons (`/learn`), MSA→Dialect Bridge, Grammar Drills, Set Phrases

3. **Discover** (`/discover`) — unchanged
   - Existing full-screen video feed UI, layout, gestures, autoplay, sizing all preserved
   - Liked Videos accessed from inside Discover the same way it is today
   - Bottom nav appears on the Discover feed list, but is **hidden the moment a video opens** (`/discover/:videoId`) so playback stays edge-to-edge

4. **Practice** (`/practice`) — active skills drills
   - Review (SRS), My Words Review, My Phrases Review, Pronunciation, Conversation Simulator, Listening Practice, Reading Practice, Vocab Games, Vocab Battles, Daily Challenge

5. **Me** (`/me`) — library, content tools & social
   - My Words, My Phrases, Saved Translations, My Transcriptions, Liked Videos, Learning Analytics, Leaderboard, Friends, Profile, Settings, Pricing
   - Plus the "content & tools" group that doesn't fit elsewhere: Listen (podcasts), Stories, Souq News, Bible Reading (if entitled), Dialect Compare, Culture Guide, How Do I Say, Meme Analyzer, Learn from X, Translate, Transcribe, Tutor Upload

## What changes vs. what stays

- **Discover:** zero visual changes. Same page component, same player, same fullscreen behavior. Only the nav route assignment changes.
- **Routes:** unchanged. All existing URLs keep working. New routes added: `/learn-hub`, `/practice`, `/me`.
- **Home (`/`):** stripped to the dashboard sections listed above. The big feature grid currently rendered from `homeLayout` is removed from Index.
- **Bottom nav:** new persistent `BottomNav` component rendered by `AppShell`, shown on hub list routes, **hidden on focused flows**: `/discover/:videoId`, `/review/*`, `/quiz/*`, `/stories/:id`, `/learn/:id`, `/battles/:id`, `/listen/:id`, `/auth`, `/onboarding`, `/reset-password`.
- **Top bar:** Profile/Settings/Admin icons move into Me; top bar keeps logo + notifications + sign-out.
- **Admin entry:** stays gated, accessed from Me when `isAdmin`.
- **Hidden-today rescue:** every page currently only reachable from the home grid now also has a tile in its hub, so nothing relies on a single discovery path.

## Files to add

- `src/components/layout/BottomNav.tsx` — 5-tab nav, active state via `useLocation`, lucide icons, hidden on focused-flow routes
- `src/components/layout/HubGrid.tsx` — shared section + tile primitives reusing existing tile styling from `Index.tsx`
- `src/pages/LearnHub.tsx`, `src/pages/PracticeHub.tsx`, `src/pages/MeHub.tsx`

## Files to edit

- `src/App.tsx` — register the 3 new hub routes (lazy)
- `src/components/layout/AppShell.tsx` — render `BottomNav` with the hide-list; add bottom padding only when nav is visible so Discover video stays edge-to-edge
- `src/pages/Index.tsx` — remove the feature-grid sections; keep gamification, continue, dialect, placement banner, phrase of the day; clean unused `TILE_HINTS`
- `src/pages/Discover.tsx` — no UI changes; only ensure it tolerates the nav being present on the list view (bottom padding handled by AppShell)

## Acceptance

- Discover list and Discover video pages look identical to today (video page has no bottom nav)
- From any hub, every existing feature is reachable in ≤2 taps
- Home screen fits roughly one viewport without a feature catalog
- No route removed, no feature removed

## Out of scope (separate passes)

- Per-user reordering of hub tiles
- Cross-feature search
- Desktop sidebar variant (mobile-first now; desktop can mirror later)
