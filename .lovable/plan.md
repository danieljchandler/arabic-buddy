# Design polish plan: Today, Hubs, Review

Scope is presentation only — no business logic, no route changes. Everything stays inside the existing digital majlis palette (off-white #F9F7F2 surfaces, Desert Red borders, dialect accent per active module).

## 1. Today / Home dashboard (`src/pages/Index.tsx`)

Problem: feels like a stack of unrelated cards with uneven rhythm and no clear focal point.

- **Hero band**: tighter greeting block with the Arabic greeting as the dominant element (Noto Sans Arabic, large), English subgreeting muted. Include date + streak chip inline instead of as a separate card.
- **Streak / XP**: collapse into a single horizontal "status strip" with streak flame, XP today, and goal ring — replaces the current full-width card.
- **Primary CTA**: one prominent "Continue learning" button styled with the active dialect accent, full-width, with subtle gradient + shadow-elegant token.
- **Discover preview card**: keep as-is structurally (per prior decision), but reframe with a section label "Watch today" and consistent 16px radius + border treatment so it matches sibling cards.
- **Quick actions**: convert to a 2-col compact grid of icon tiles (Practice, Translate, My Words, Discover) instead of a vertical list. Removes scroll length.
- **Spacing rhythm**: enforce 24px vertical gap between sections, 16px inside cards. Add a subtle watercolor divider between hero and content blocks.

## 2. Hub navigation — Learn / Practice / Me

Problem: three hubs use slightly different card styles, icon sizes, and headings.

- **Unify HubGrid tile**: one shared tile component — square-ish, 4:3, icon top-left, title bold, one-line description muted, optional badge top-right. Apply across `LearnHub`, `PracticeHub`, `MeHub`.
- **Section headers**: same eyebrow + H2 pattern on all three hubs (`text-xs uppercase tracking-wide text-muted` over `text-2xl font-display`).
- **Grouping**: Learn = "Foundations / Skills / Content"; Practice = "Drills / Conversation / Games"; Me = "Library / Progress / Account". Same group header style across.
- **BottomNav polish**: active tab gets a soft pill background in the dialect accent + label weight bump; inactive icons reduced to 70% opacity; add a 1px hairline top border using `border-border/60`.
- **Page padding**: standardize `px-4 pt-6 pb-24` on every hub so BottomNav never overlaps content.

## 3. Flashcard review screens (`MyWordsReview`, `MyPhrasesReview`, `ReviewClozeCard`, recognition card)

Problem: cards feel utilitarian — heavy borders, inconsistent button hierarchy, cramped audio controls.

- **Card frame**: switch from hard border to layered surface (off-white card on warm sand backdrop, `shadow-elegant`, 20px radius). Removes the "form field" feel.
- **Arabic typography**: bump Arabic display size (`text-4xl` recognition, `text-3xl` cloze), generous line-height, center-aligned, with optional tashkil rendered in muted color so the unvocalized form stays dominant.
- **Audio control**: single large circular play button (56px) with the dialect accent, replacing the small icon button. Waveform/loading state uses an animated ring.
- **Reveal flow**: "Reveal" becomes a full-width ghost button under the card; once revealed, English translation fades in with a soft slide, and the rating buttons (Again / Hard / Good / Easy) appear as a 4-segment pill with color-coded accents (red→amber→teal→green) instead of equal gray buttons.
- **Cloze blanks**: blank slot rendered as a rounded chip with dashed border in dialect accent; multiple-choice answers as large tap targets (min-h 56px), Arabic-only filtering already in place.
- **Progress**: replace numeric "3 / 12" with a slim progress bar at the top + small counter on the right. Less visual noise.
- **Empty / done state**: celebratory illustration block (use existing dallah / motif assets) instead of plain text.

## Shared design system additions

- Add `--shadow-card`, `--shadow-elegant`, `--gradient-accent` tokens in `index.css` if not present, derived from current dialect primary.
- Add `Card` variant `variant="majlis"` for the layered off-white surface so all three areas use the same primitive.
- No new fonts, no palette changes, no route or data changes.

## Out of scope

- Admin pages, Discover video player internals, onboarding tour visuals, settings.
- Any dialect color rework (Gulf Sadu palette stays as-is).

## Verification

After implementation: Playwright screenshots of `/`, `/learn-hub`, `/practice`, `/me`, `/review/my-words`, `/review/my-phrases` at mobile width (390) to confirm spacing rhythm and tile consistency.
