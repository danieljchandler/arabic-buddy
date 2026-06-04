## Goal

Upgrade the shared AI Brain (`supabase/functions/_shared/aiBrain.ts` + `modelRegistry.ts`) so every edge function that calls `askBrain` uses the same top-tier models the analyze-gulf-arabic pipeline already runs:

- **Gemini 3.1 Pro Preview** (`google/gemini-3.1-pro-preview`)
- **Claude Opus 4.1** (`anthropic/claude-opus-4.1`)
- **Qwen3 Max** (`qwen/qwen3-max`) — third verifier with **less weight**

Today the brain defaults to `gemini-2.5-pro`, `gpt-5-mini`, `gemini-3-flash-preview` (drafters) and `gpt-5` (judge), which is out of sync with the pipeline and weaker on dialect.

## Changes

### 1. `supabase/functions/_shared/modelRegistry.ts`
- Add entries for `google/gemini-3.1-pro-preview`, `anthropic/claude-opus-4.1`, `qwen/qwen3-max` (tier `strong`, tags `dialect`/`reasoning`).
- Update defaults:
  - `DEFAULT_DRAFTERS = ['google/gemini-3.1-pro-preview', 'anthropic/claude-opus-4.1', 'qwen/qwen3-max']`
  - `DEFAULT_JUDGE = 'anthropic/claude-opus-4.1'` (Claude as final arbiter, matching pipeline's Claude-leaning fallback).
- Export a new `MODEL_WEIGHTS` map: Gemini 1.0, Claude 1.0, Qwen 0.6, others 0.8.

### 2. `supabase/functions/_shared/aiBrain.ts`
- Import `MODEL_WEIGHTS`.
- `runEnsemble`: when ranking candidates, sort by **weighted leak score** (`leaks.length / weight`) then by `raw.length`. Qwen wins only when both Gemini and Claude have strictly more leaks — preserving the "less weight than other two" rule.
- `runDraftCritic`: change the hardcoded drafter from `gemini-2.5-pro` to `gemini-3.1-pro-preview` and critic from `DEFAULT_JUDGE` (already updated to Claude Opus).
- `runCouncil`: judge stays `DEFAULT_JUDGE` (now Claude Opus). Pass weights into the judge prompt as `(weight: X)` labels so the judge knows Qwen is a tiebreaker, not a peer.
- `runRepair`: keep using `DEFAULT_JUDGE`.
- `streamChat` default model: bump from `gemini-2.5-pro` to `gemini-3.1-pro-preview`.

### 3. `src/components/admin/curriculum-builder/ModelSelector.tsx` (UI parity)
- Add `google/gemini-3.1-pro-preview`, `anthropic/claude-opus-4.1`, `qwen/qwen3-max` to the selectable list and update `LLMModelId`. Mark Gemini 3.1 Pro as `Recommended`; demote `gemini-3-flash-preview`.

## Out of scope
- No changes to `process-approved-video` / `analyze-gulf-arabic` pipeline (already on these models).
- No edits to per-function `models: [...]` overrides — they keep their explicit choices.
- No schema/DB changes.

## Verification
- `deno check supabase/functions/_shared/aiBrain.ts` and one consumer (e.g. `generate-sample-sentences`).
- Spot-test `hf-chat` with a Gulf prompt; expect `_meta.models` to include the three new ids.
