# Add Feature Info Buttons App-Wide

Give users a clickable (i) icon next to features and buttons that opens a small popover with a friendly, engaging explanation of what it does.

## What you'll see

- A small circled **i** icon next to feature titles, buttons, and tiles throughout the app.
- Tapping it opens a compact popover bubble with a short, plain-English description written to make users want to try the feature.
- A new **Settings → "Show feature hints"** toggle to turn all (i) icons off once a user feels confident.

## Where info buttons get added (priority order)

**Pass 1 — Home / Today (highest impact)**
- Today page: Daily Goal Ring, each task row (Review, New Words, Daily Challenge, etc.), Streak display, XP display.
- Home (Index): every dialect-module tile and every quick-action tile (My Words, Discover, Reading, Stories, Picture Scenes, Souq News, Conversation Simulator, Pronunciation, Meme Analyzer, Learn from X, Transcribe, How Do I Say, Vocab Battles, Culture Guide, Dialect Compare, Placement Quiz).

**Pass 2 — Learning surfaces**
- Review / My Words Review / My Phrases Review: rating buttons (Again/Hard/Good/Easy), pronunciation button, leech helper panel, "mix all dialects" toggle, audio replay.
- Quiz / Flashcard: tap-to-reveal, image hint, cloze cards.
- Reading Practice: Ask AI sentence, Mark Unknowns, Save Unknowns bar, display-prefs toggles (Arabic / Tashkil / Formal / English).

**Pass 3 — Tools & specialty pages**
- Transcribe, Meme Analyzer, Learn from X, Picture Scenes, Tutor Upload, Conversation Simulator, Discover, Souq News, Stories — one info button on the page header explaining the tool, plus icons on key sub-controls.

**Pass 4 — Settings & profile**
- Display prefs, leech prefs, dialect switcher, new-card cap, home layout editor.

## How it works

1. New reusable `<InfoHint>` component — a Lucide `Info` icon in a circle, sized to sit inline next to titles/buttons. Uses Shadcn `Popover` for the bubble.
2. Component reads a global "show feature hints" preference from a new `useFeatureHints()` hook (localStorage-backed, same pattern as `useLeechPrefs`). When off, the icon renders nothing.
3. Each `<InfoHint>` takes a `title` and `body` prop. Copy is written in a warm, encouraging voice ("Catch words before they slip away — review just the ones your brain is about to forget.").
4. Settings page gets a new "Feature hints" section with a single toggle and a one-line description.
5. Styling: muted foreground color by default, hover/tap → primary; small (14–16px) so it never crowds the UI.

## Copy approach

Each hint follows a 2-line pattern:
- **Line 1 (what):** one sentence on what the feature does.
- **Line 2 (why try it):** one sentence on the benefit, with a light verb ("Try it next time you…").

Example — Daily Challenge tile:
> **Daily Challenge** — A bite-sized mission that refreshes every day. Keep your streak alive and earn bonus XP just for showing up.

Example — Leech Helper:
> **Stuck on a word?** When a card keeps tripping you up, we'll spin up a mnemonic or a catchy jingle to make it stick.

## Out of scope

- No backend/database changes — pure frontend, preference stored locally.
- No changes to feature behavior; only adds the (i) affordance.
- Admin pages skipped (admins already know the tools).

## Rollout

Pass 1 is the bulk of the perceived value and ships first. Passes 2–4 follow in the same PR if scope allows, otherwise sequentially.
