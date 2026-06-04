## Goal
Replace the sequential 3-tier translation cascade in `analyze-gulf-arabic` with a **weighted ensemble**: Gemini 3.1 Pro + Claude Opus 4.1 translate in parallel as co-equal peers, and Qwen3-Max acts as a lighter-weight third opinion / tiebreaker.

## Architecture

```text
                  ┌─────────────────────┐
                  │  42 Arabic lines    │
                  └──────────┬──────────┘
                             │
            ┌────────────────┼────────────────┐
            ▼                ▼                ▼
       Gemini 3.1 Pro   Claude Opus 4.1   Qwen3-Max
       (weight 1.0)     (weight 1.0)      (weight 0.5)
       direct Google    OpenRouter        OpenRouter
            │                │                │
            └────────────────┼────────────────┘
                             ▼
                  ┌─────────────────────┐
                  │  Per-line merger    │
                  │  (weighted vote +   │
                  │   Claude arbiter on │
                  │   disagreement)     │
                  └──────────┬──────────┘
                             ▼
                  Final translations[42]
                  + per-line provenance
```

## Merging rules (per line)

For each of the 42 lines we get up to 3 candidate English translations.

1. **Normalize** — lowercase, strip punctuation, collapse whitespace for comparison only (preserve original casing for output).
2. **Semantic similarity grouping** — group candidates whose normalized Jaccard token overlap ≥ 0.6 into the same cluster.
3. **Weighted vote** — each cluster gets the sum of its members' weights (Gemini 1.0, Claude 1.0, Qwen 0.5).
4. **Pick winner**:
   - If one cluster's weight ≥ 1.5 → pick the **longest** (most detailed) translation in that cluster.
   - If Gemini and Claude agree (cluster contains both) → always wins regardless of Qwen.
   - If Gemini and Claude **disagree** and Qwen sides with one → that side wins (weight 1.5 vs 1.0).
   - If all three disagree (3 separate clusters) → Claude wins by default (best literary English), and the line is flagged `needs_review: true`.
5. **Fallback** — if a model returned nothing for a line, that slot is skipped (weights recomputed from available votes).

## Provenance logging

Extend `engines_used.translation` jsonb structure:
```json
{
  "strategy": "weighted_ensemble",
  "tiers": [
    { "name": "google/gemini-3.1-pro-preview", "weight": 1.0, "status": "ok", "latency_ms": 38342, "chars": 4820, "lines_won": 18 },
    { "name": "anthropic/claude-opus-4.1", "weight": 1.0, "status": "ok", "latency_ms": 41200, "chars": 5102, "lines_won": 19 },
    { "name": "qwen/qwen3-max", "weight": 0.5, "status": "ok", "latency_ms": 12400, "chars": 4655, "lines_won": 5 }
  ],
  "agreements": { "all_three": 12, "gemini_claude": 25, "needs_review": 2 }
}
```

## Failure handling

- Run all three in `Promise.allSettled` parallel; never block on the slowest.
- If **any one** model fails → ensemble proceeds with remaining two (weights renormalized).
- If **only one** model returns → use it directly, mark `degraded: true`.
- If **all three** fail → return error to caller (no silent empty translations).
- Hard timeout per model: 90s (Claude Opus is the slowest, ~60–80s typical).

## Files to change

1. **`supabase/functions/analyze-gulf-arabic/index.ts`**
   - Replace sequential cascade with `runTranslationEnsemble(lines, dialect)`
   - Add `mergeTranslations(candidates[], weights[])` helper
   - Update `translationTierWon` → `engines_used.translation` ensemble block
   - Apply per-line `needs_review` flag into transcript_lines jsonb so the editor can highlight uncertain lines

2. **`supabase/functions/_shared/translationEnsemble.ts`** (new)
   - Pure helper: `jaccard()`, `clusterCandidates()`, `pickWinner()`
   - Three model callers: `callGeminiDirect()`, `callClaudeOpusOR()`, `callQwen3MaxOR()`
   - All return `{ translations: string[], latencyMs, charCount, error? }`

3. **`src/integrations/supabase/types.ts`** — extend the optional `needs_review_lines` field on `discover_videos.engines_used` (backward compatible, additive).

## What stays unchanged

- Tier 1 (Gemini) still uses **direct Google API** with audio multimodality (your prior decision).
- Tier 2 + Tier 3 still go through OpenRouter via `OPENROUTER_API_KEY`.
- `EdgeRuntime.waitUntil` background pattern preserved.
- Schema is fully backward-compatible: `engines_used` is jsonb, new fields are additive.
- No DB migration needed.

## Out of scope (ask if you want)

- Surfacing `needs_review` lines in the admin transcript editor UI
- Adding a 4th verifier (e.g. Fanar) — current Fanar role is dialect validation, not translation
- Recomputing weights dynamically based on per-language historical win rates

## Open question

When Gemini + Claude agree on a line, do you want me to pick:
- (a) the **longer/more detailed** of the two (current proposal), or
- (b) Claude's version always (more literary), or
- (c) Gemini's version always (more literal)?

I'll default to **(a) longest** unless you say otherwise.
