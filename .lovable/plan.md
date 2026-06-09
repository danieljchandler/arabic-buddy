# Rebrand: Lahja → Hakiya

Sweep every user-facing reference to **Lahja** and replace it with **Hakiya** (Arabic: **حكية**). Swap the logo for the uploaded Hakiya logo. Migrate localStorage keys so existing users keep their prefs. Email/domain references stay on the TODO list until you have them.

## 1. New logo asset
- Upload the attached `Hakiya` logo to Lovable Assets as `src/assets/hakiya-logo.png.asset.json` (full lockup, used on hero/landing/learn).
- Generate a square icon variant from the same logo for compact placements (auth, onboarding, admin headers) → `src/assets/hakiya-icon.png.asset.json`.
- Delete the old `src/assets/lahja-logo.png` and `src/assets/lahja-icon.png` once all imports are switched.
- Keep `public/favicon.png` as-is for this pass (favicon swap can come with the new domain).

## 2. User-facing copy + imports
Replace every visible "Lahja" string and every `lahja-logo` / `lahja-icon` import with the Hakiya equivalents in:

- `index.html` — title, author meta, OG/Twitter tags, JSON-LD `name`.
- `src/hooks/useDocumentTitle.ts` — base title + suffix.
- `src/components/Footer.tsx` — copyright line (email left as TODO comment).
- `src/components/LandingHero.tsx`, `src/pages/Index.tsx`, `src/pages/Learn.tsx` — logo import + alt text + body copy.
- `src/pages/Auth.tsx`, `src/pages/Onboarding.tsx`, `src/pages/admin/AdminLogin.tsx`, `src/pages/admin/AdminStories.tsx`, `src/pages/admin/AdminStoryForm.tsx`, `src/pages/admin/Dashboard.tsx` — icon import + alt + welcome/back copy.
- `src/components/admin/AlertsBell.tsx` — browser notification title.
- `src/pages/Listen.tsx`, `src/pages/NotFound.tsx` — document title strings.
- `src/pages/Pricing.tsx`, `src/pages/Privacy.tsx`, `src/pages/Terms.tsx`, `src/pages/Today.tsx` — body copy. Emails left with `TODO(rebrand-email)` comments.
- `src/components/DialectRitualSwitcher.tsx` (`Lahja · لهجة` → `Hakiya · حكية`) and `src/pages/Profile.tsx` (`Lahja · جواز` → `Hakiya · جواز`).
- `src/components/design-system/index.ts` — comment header.

## 3. Edge function prompts
Update the strings the AI sees (so generated content uses the new brand):
- `supabase/functions/ai-resegment-transcript/index.ts` — "Lahja dialect-learning platform" → "Hakiya".
- `supabase/functions/culture-guide/index.ts` — `"Lahja"` → `"Hakiya"`.
- `supabase/functions/curriculum-chat/index.ts` — `"Lahja" (لهجة)` → `"Hakiya" (حكية)` and "The Lahja curriculum" line.

## 4. Internal identifiers (kept, with migration)
Internal storage keys, event names, and the Tailwind `lahja` easing token stay named `lahja*` to avoid churn, EXCEPT for localStorage values, which are migrated so users keep their data:

- New `src/lib/brandMigration.ts` runs once at app bootstrap (called from `src/main.tsx`, guarded by a `hakiya:migrated:v1` flag). It walks every known key and copies:
  - `lahja_dialect_module` → `hakiya_dialect_module`
  - `lahja_bridge_view_enabled`, `lahja_bible_session`, `lahja_freechat_v1` → `hakiya_*`
  - All `lahja:*` prefixed keys (`home-layout:v1`, `continue:v1`, `display-prefs`, `bible-display-prefs`, `imageStyleLock:v1`, `feature-hints-enabled`, `leech-tracking-enabled`, `review-queue:*`, `ui:sound`, `alphabet:milestone-seen`) → `hakiya:*`.
  - Old keys are then deleted.
- Every file under `src/hooks/` and `src/lib/` that defines a `STORAGE_KEY`, `KEY_PREFIX`, or custom event name is updated in lock-step to read/write the new `hakiya*` names. Custom events (`lahja:continue-changed`, `lahja:bridge-mode-changed`, `lahja:home-layout-changed`, `lahja:display-prefs-changed`, `lahja:feature-hints-changed`, `lahja:leech-prefs-changed`, `lahja:ui-sound-changed`) are renamed to `hakiya:*` on both dispatch and listener sides so they stay paired.
- `src/lib/exportData.ts` filenames change to `hakiya-vocabulary-*.json/csv` and `hakiya-reviews-*.json`.
- `src/lib/storageBootstrap.ts` probe key renamed.
- `src/lib/ankiImport/types.ts` + `scheduleMap.ts` type `LahjaStage` renamed to `HakiyaStage` (internal type only, no runtime impact).
- `src/lib/parseLessonXlsx.ts` header detector matches both `LAHJA` and `HAKIYA` so old lesson XLSX files still parse.
- Tailwind `lahja` easing token, the comments in `tailwind.config.ts` and `src/index.css`, and User-Agent string `lahja-listen` in `supabase/functions/_shared/listenTts.ts` stay as-is (not user-facing, churn risk on classNames).

## 5. Explicitly NOT touched in this pass
- `supabase/migrations/*.sql` historical migrations (immutable history).
- `supabase/functions/_shared/cors.ts` default origin (`lahja-arabic.lovable.app`) — waiting on new domain.
- All email addresses — left with `TODO(rebrand-email)` next to each so they're easy to grep when you have the new address.
- `public/favicon.png` — paired with the domain swap.
- Project memory index "Lahja Overview" entry — I'll update the underlying memory file content to say "Hakiya (formerly Lahja)" so future AI context reflects the rename, without removing the historical name.

## 6. Verification
- `rg -in "lahja"` after the sweep should only match: migrations, CORS default origin, TODO-tagged email lines, the Tailwind `lahja` easing token + related comments, the `listenTts.ts` UA string, and the `parseLessonXlsx` back-compat header check.
- Smoke-test in preview: landing hero shows Hakiya logo, document title reads "Hakiya — Learn Spoken Arabic", auth/onboarding/admin headers show new icon, dialect ritual switcher shows `Hakiya · حكية`, footer copyright reads Hakiya.
- Open DevTools → Application → Local Storage and confirm new `hakiya*` keys exist and old `lahja*` keys are gone after first load.

## Follow-ups (saved for later)
- New contact email + propagate to Footer/Privacy/Terms/Pricing.
- New domain + update `cors.ts` default origin, `index.html` canonical/OG URLs, favicon.
