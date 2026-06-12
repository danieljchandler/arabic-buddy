# Plan: Send metric issues to the AI to learn from

Add a one-click "Teach AI" action on warning/error rows in Admin → Feature Metrics. It hands the failing event (feature, dialect, leak tokens, meta, message) to an AI flow that proposes a new draft dialect rule (or strengthens an existing one) so future generations avoid the same issue.

## UX (AdminFeatureMetrics.tsx)
- On each event row whose `status` is `warn` or `error`, OR whose `event` is `dialect_leak` / has `meta.leaks`, show a small `Sparkles` button labeled "Teach AI".
- Also add the same button in the Summary table per `feature × dialect` row when `err > 0` or `avgLeaks > 0` — sends the aggregated recent leak tokens for that slice.
- Clicking shows a loading spinner, then a toast: "Draft rule created — review in Dialect Rules" with a link to `/admin/dialect-rules`. Errors surface via toast.
- No schema changes; reuses existing `dialect_rules` table (status `draft`, source `ai_generated`).

## Backend: new edge function `learn-from-metric`
- Input: `{ metric_id?: string, feature, event, dialect, meta, leaks?: string[], message?: string }`.
- Admin-only (check `has_role(uid,'admin')` via service-role client + user JWT).
- Loads existing approved rules for that dialect (for dedupe context), then calls `askBrain` with the same `emit_dialect_rules` tool schema used by `draft-dialect-rules`, but with a system prompt focused on:
  - "An automated metric flagged this failure. Propose 1–3 atomic rules that, if followed, would prevent it. Prefer strengthening/extending existing rules rather than duplicating."
  - Passes the raw metric payload + recent leak tokens.
- Inserts proposals into `dialect_rules` with `status='draft'`, `source='ai_generated'`, `notes` referencing the metric id/event.
- Logs its own `feature_metrics` row (`feature='learn_from_metric'`) for traceability.
- Registered in `supabase/config.toml` with `verify_jwt = true` (admin call from authenticated UI).

## Files
- `supabase/functions/learn-from-metric/index.ts` (new)
- `supabase/config.toml` (add function block)
- `src/pages/admin/AdminFeatureMetrics.tsx` (add button + handler, summary action)

## Out of scope
- No changes to existing `draft-dialect-rules`, brain, or rules schema.
- No auto-approval — admin still reviews drafts in `/admin/dialect-rules`.
