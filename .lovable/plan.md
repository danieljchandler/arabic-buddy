## Goal

Make dialect output provably authentic and visibly trustworthy. Three workstreams, ordered by leverage.

---

### 1. Rulebook-driven leak detection + few-shot prompting

Today the MSA detector uses a small hardcoded word list and prompts only inject the *text* of approved rules. Approved `dialect_rules.examples.bad/good` are dormant data. Wire them in both directions:

- **Leak detector (`_shared/aiBrain.ts` + `_shared/dialectHelpers.ts`)**
  - Extend `primeDialectPrompt` cache to also expose a per-dialect `forbiddenTokens[]` array harvested from every approved rule's `examples.bad` (deduped, normalized).
  - MSA leak detector now flags both the hardcoded list AND rulebook-forbidden tokens. Each violation row gets the matching `rule_id` populated so the admin digest groups by rule.
- **Few-shot injection**
  - `primeDialectPrompt` selects up to 6 high-priority approved rules per dialect and renders an "Examples of authentic dialect" block:
    ```
    ✅ <examples.good[0]>   (rule: <rule.rule>)
    ❌ <examples.bad[0]>    → use ✅ <examples.good[0]>
    ```
  - Block is appended to the system prompt used by `askBrain`/`streamBrain` so every generation sees concrete authentic patterns, not just abstract rules.
- **Cache invalidation**: bump cache TTL key when any approved rule changes (simple `updated_at` max watermark).

Result: curating rules in the admin UI immediately tightens detection *and* improves generation, with no code changes.

---

### 2. Native-validator critic pass

Add an authenticity scorer that runs after the repair pass for any dialect-sensitive generation.

- New `_shared/dialectValidator.ts` exporting `validateDialect(text, dialect, opts)`:
  - Calls a single strong model (Gemini 2.5 Pro or GPT-5-mini) with a "native speaker reviewer" persona, the approved rulebook context, and a structured tool `emit_authenticity_score` returning `{ score: 1-5, leaks: [{token, suggestion, rule_id}], verdict: 'pass'|'rewrite' }`.
  - Score ≥ 4 → pass. Score ≤ 3 → trigger one rewrite pass with the leaks as targeted instructions; re-score once; log final result.
- **Integration in `askBrain`**:
  - Add `validateDialect: boolean` option; default `true` for council/draft_critic strategies that touch Arabic content.
  - Final score + leaks are returned in the brain response metadata, and any unresolved leaks are written to `dialect_rule_violations` (with `detected_by='native_validator'`).
- **Opt-in surface**: high-volume / low-stakes flows (transcription, asr post-edit) keep `validateDialect: false` for cost; lesson generators, story generators, conversation simulator, daily challenges turn it on.

Result: every learner-facing AI text gets graded by a stricter persona against the same rulebook before publishing.

---

### 3. Native review queue (trusted natives)

Let `recorder`-role users (and admins) triage flagged outputs and feed fixes back into the rulebook.

- **Schema (single migration)**
  - New table `dialect_native_reviews`:
    - `id`, `dialect`, `content_type` (e.g. `discover_video`, `story`, `daily_challenge`, `manual`), `content_id` (nullable), `original_text`, `corrected_text` (nullable), `reviewer_notes`, `status` (`pending` | `corrected` | `dismissed`), `reviewer_id`, `created_at`, `updated_at`, `source` (`user_report` | `native_validator` | `msa_leak_detector` | `manual`), `violation_id` (nullable FK-style ref to `dialect_rule_violations.id`).
  - GRANTs + RLS: recorders and admins can SELECT/UPDATE; admins also INSERT/DELETE; learners can INSERT only via the report flow (restricted columns).
- **Auto-population**:
  - `native_validator` and `msa_leak_detector` insert into both `dialect_rule_violations` (existing) and `dialect_native_reviews` (new) when severity warrants review.
- **Learner "doesn't sound native" report button** — out of scope for this plan (deferred), but the table is ready to accept user reports later.
- **Admin / native UI** — extend `src/pages/admin/AdminDialectRules.tsx` with a fourth tab **"Native Review"**:
  - Queue list (pending first) with original text, dialect, source, link back to source content if `content_id` present.
  - Inline editor to write `corrected_text` + notes.
  - On submit: row → `status='corrected'`, and a draft `dialect_rules` row is auto-proposed (category=`native_fix`, source=`native_review`, examples.bad=original snippet, examples.good=correction) for admin approval.
  - Recorders see only the review queue; admins see the queue and the auto-drafted rule.

Result: a clean human-in-the-loop: detection → review → correction → new rule → tighter prompts/detection (loop closes back into workstream 1).

---

## Sequencing

1. Workstream 1 (rulebook → detector + few-shot) — small, pure-edit, high leverage.
2. Workstream 2 (native-validator critic) — additive edge logic; respect cost flag.
3. Workstream 3 (review queue) — migration + admin tab; recorder role gains queue access.

## Out of scope (next plans)
- Learner-facing "doesn't sound native" button + trust badge.
- Golden eval set / regression tests.
- Sub-dialect tagging (deferred per your call).

## Files touched
- `supabase/functions/_shared/dialectHelpers.ts` — extend `primeDialectPrompt` (forbidden tokens, few-shot block).
- `supabase/functions/_shared/aiBrain.ts` — rulebook-aware detector, optional validator hook.
- `supabase/functions/_shared/dialectValidator.ts` — **new**.
- `supabase/functions/_shared/msaViolationLogger.ts` — accept `rule_id`, dual-write to reviews when severe.
- 1 migration — `dialect_native_reviews` table + GRANTs + RLS.
- `src/pages/admin/AdminDialectRules.tsx` — add "Native Review" tab.
- Memory: update `mem://architecture/ai-integration/dialect-rulebook`.
