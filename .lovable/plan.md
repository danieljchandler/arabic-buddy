# Plan: Unified "Today" Hub

A single screen at `/today` that tells the learner exactly what to do right now — combining due flashcards, reading, listening, and the daily challenge into one prioritized queue with a daily-goal ring.

## Goals
- One question answered on open: "what should I do today?"
- One daily target (XP-based) that all modules contribute to.
- Zero new backend tables — read from existing due-count hooks and gamification.

## UX

```text
┌──────────────────────────────┐
│  Today          [streak 🔥5] │
│  ╭───────────╮               │
│  │   ◜◝      │  42 / 100 XP  │
│  │  ring     │  3 of 6 tasks │
│  ╰───────────╯               │
├──────────────────────────────┤
│ ▣ Review 12 words      →     │  (My Words SRS, recognition+production)
│ ▣ Read 1 short passage →     │  (Reading Practice — next unread)
│ ▣ 1 Souq article       →     │  (Souq News — today's pick)
│ ▣ Listen: 1 clip       →     │  (Discover — short, dialect-matched)
│ ▣ Daily challenge      →     │  (existing DailyChallenge route)
│ ▣ 3 set phrases        →     │  (only if due > 0)
├──────────────────────────────┤
│  Completed today (collapsed) │
└──────────────────────────────┘
```

- Tasks with 0 due are hidden (not greyed out) to keep the list short.
- Each task shows a count badge + estimated minutes.
- Tapping a task deep-links into the existing module (no behavior change inside modules).
- A task marks itself "complete for today" when its underlying signal flips (e.g., due-count hits 0, or `daily_xp >= goal_share`). Stored in localStorage keyed by date — no migration needed.
- Goal ring uses the same XP source already powering `XPDisplay`.

## Tasks definition (data sources, all already exist)

| Task | Source hook / table | "Done" condition |
|---|---|---|
| Flashcard review | `useUserVocabularyDueCount` | due === 0 |
| Set phrases | `useSetPhrases` due count | due === 0 |
| Reading passage | `useInteractiveStories` / Reading Practice last-completed in localStorage | 1 read today |
| Souq article | `souq_news` table latest unread per dialect | 1 read today |
| Listening clip | `useDiscoverVideos` top-1 short by dialect | 1 watched today |
| Daily challenge | `useGamification` daily challenge status | already-tracked completion |

Filter everything by `activeDialect` from `DialectContext`.

## Files

**New**
- `src/pages/Today.tsx` — screen
- `src/components/today/TaskRow.tsx` — single row (icon, title, count badge, est. minutes, chevron)
- `src/components/today/DailyGoalRing.tsx` — SVG ring around XP progress
- `src/hooks/useTodayQueue.ts` — composes all due-count hooks above into a single ordered task list
- `src/lib/todayCompletion.ts` — localStorage helpers keyed by `YYYY-MM-DD`

**Edited**
- `src/App.tsx` — register `/today` route
- `src/pages/Index.tsx` — add a prominent "Start today" card at the top linking to `/today`. Leave the rest of the home dashboard intact (don't remove anything yet — we can simplify later once Today proves itself).

## Technical notes
- Use existing `AppShell` (standard width).
- Goal default: 100 XP/day, stored in localStorage (`today.goal`), editable from a small popover. No DB change.
- Order tasks by: (1) overdue flashcards, (2) daily challenge, (3) reading, (4) listening, (5) souq, (6) phrases. Tweakable constant.
- All counts come from React Query — no new edge functions, no new tables.
- Respect immersion toggles & dialect context; no new prompts.

## Out of scope (next iterations)
- Drag-to-reorder tasks
- Customizable goal per dialect
- Notifications/reminders at goal-deadline
- Replacing the Home dashboard entirely

---

Approve to implement, or tell me which task to drop/add.
