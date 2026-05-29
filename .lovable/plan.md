# Lahja AI Brain — Multi-Model Collaboration Layer

## The problem today

Most AI calls pick **one model** and trust it:
- `word-enrichment` → `gemini-2.5-flash-lite` (weakest, leaks MSA)
- `generate-sample-sentences` → `gemini-2.5-flash` solo
- `hf-chat` (used by `huggingface.ts`) → single `gemini-3-flash-preview` with a generic Gulf system prompt
- `generate-story`, `phrase-of-the-day`, `curriculum-chat` → solo Gemini
- `daily-story`, `analyze-meme` → solo, hardcoded

Only `how-do-i-say` and `analyze-meme` (visual) currently use an **ensemble** (multiple models in parallel, then merge). That's the pattern we want everywhere dialect authenticity matters.

## The idea: a shared "AI Brain" orchestrator

One reusable module — `_shared/aiBrain.ts` — that any edge function can call instead of `fetch('ai.gateway.lovable.dev/...')` directly. It runs models in **roles** (Drafter → Critic → Judge), or in **parallel ensembles** with consensus, depending on the task profile.

Think of it as a small multi-agent pipeline that *every* dialect-sensitive generator inherits.

## Architecture

```text
┌─────────────────────── AI Brain ────────────────────────┐
│                                                          │
│  Task profile  ──►  Strategy picker                      │
│  (dialect,         ├─ "solo"        → 1 fast model       │
│   category,        ├─ "ensemble"    → N models ∥, vote   │
│   stakes)          ├─ "draft+critic"→ A drafts, B critiques│
│                    └─ "council"     → A,B,C draft → D judges│
│                                                          │
│  Each strategy → models from Model Registry              │
│  Each output → MSA leak detector + dialect rule guard    │
│  Logged → llm_logs with strategy, models, agreement %    │
└──────────────────────────────────────────────────────────┘
```

### Strategies (4 reusable patterns)

| Strategy | When to use | Models (default) |
|---|---|---|
| **solo** | Low-stakes, high-volume, deterministic (titles, slugs, simple classifications) | `gemini-3-flash-preview` |
| **ensemble** (parallel + consensus) | Short dialect outputs where authenticity matters: vocab definitions, example sentences, dialect translations | `gemini-2.5-pro` + `gpt-5-mini` + `gemini-3-flash-preview` |
| **draft+critic** (sequential) | Longer outputs that need polish: stories, news summaries, meme explanations | Drafter: `gemini-2.5-pro` → Critic: `gpt-5` ("rewrite anything that drifts to MSA, return only the corrected version") |
| **council** (drafts + judge) | Highest-stakes user-facing teaching content: lesson generation, Curriculum Brain output, "How do I say…" | Drafters: `gemini-2.5-pro`, `gpt-5`, `qwen-3-72b` → Judge: `gpt-5` ("pick the most authentic dialect response, merge best phrasing, no MSA") |

All four strategies share the same input/output shape so any caller can swap strategies without rewriting.

### Consensus + MSA guard

After every strategy run:
1. **MSA leak detector** scans output for forbidden MSA tokens (driven by the dialect rulebook from the previous plan).
2. If a leak is found and strategy ≠ `solo`, the orchestrator triggers a **repair pass**: re-prompt the judge/critic with `"The following words are MSA and must be replaced with dialectal equivalents: [list]. Return the corrected text only."`
3. Final output + agreement score + repair count logged to `llm_logs`.

### Specs in code

```ts
// _shared/aiBrain.ts
type BrainTask = {
  purpose: 'vocab_definition' | 'sample_sentences' | 'story' | 'translation' | 'chat' | …
  dialect: Dialect
  prompt: string
  system?: string           // optional override; otherwise built from dialect rulebook
  strategy?: Strategy       // optional override; otherwise picked from task profile
  schema?: ZodSchema        // for structured output
  maxTokens?: number
}

type BrainResult<T> = {
  output: T
  strategy: Strategy
  models: string[]
  agreementScore: number   // 0–1, only set for ensemble/council
  msaRepairs: number
  totalLatencyMs: number
  totalTokens: number
}

export async function askBrain<T>(task: BrainTask): Promise<BrainResult<T>>
```

Every dialect-sensitive function (~15 of them) becomes a 1-line call:
```ts
const { output } = await askBrain({
  purpose: 'sample_sentences',
  dialect,
  prompt: `Generate 3 sentences using "${word}"`,
  schema: SentencesSchema,
})
```

## What gets built

1. **`_shared/aiBrain.ts`** — strategy registry, model dispatcher, consensus voter, repair loop, structured-output wrapper.
2. **`_shared/modelRegistry.ts`** — central list of models with `tier`, `cost`, `latencyMs`, `strengths` so strategies can pick by tag, not hardcoded names. Survives provider swaps.
3. **`_shared/consensus.ts`** — small helpers: token-overlap score for short outputs, semantic-similarity (cosine via Lovable embeddings) for longer ones, majority-vote for structured outputs.
4. **`_shared/msaLeakDetector.ts`** — regex pass over forbidden tokens (from dialect rulebook). Returns `{ leaks: string[], severity }`. Reused by repair loop.
5. **Migration of 7 hot-path functions** to `askBrain`:
   - `word-enrichment` (vocab_definition, ensemble)
   - `generate-sample-sentences` (sample_sentences, ensemble)
   - `generate-story` (story, draft+critic)
   - `phrase-of-the-day` (translation, ensemble)
   - `hf-chat` → renamed `ai-brain-chat` (chat, council for "How do I say"-style asks)
   - `curriculum-chat` (lesson_generation, council)
   - `analyze-meme` (meme_explain, draft+critic; also fixes the hardcoded-Gulf bug)
6. **Admin "AI Brain" page** (`/admin/ai-brain`):
   - Shows per-purpose strategy in use, model list, average agreement, MSA-repair rate, cost/req, p50/p95 latency (last 7d from `llm_logs`).
   - "Try it" panel: enter dialect + prompt + purpose → see all model drafts side-by-side, judge output, MSA leaks, final result. Great for tuning.
   - Toggle strategy per purpose without code deploy (config row in `ai_brain_config` table).
7. **`llm_logs` schema additions:** `purpose`, `strategy`, `models jsonb`, `agreement_score`, `msa_repairs`, `judge_choice`.

## Why this is the right shape for Lahja

- **Dialect authenticity is a 2nd-pass problem.** Single models drift; a judge or critic catches it. That's the entire moat.
- **One module = consistency.** The same MSA guard + repair loop runs for every flow. No more drift between `curriculum-chat` and `word-enrichment`.
- **Pluggable with the upcoming Dialect Rulebook.** The leak detector reads from the same approved rules table — the two systems compound.
- **Cost-aware.** Solo strategy stays for cheap stuff; council only fires for the highest-stakes outputs. Visible in the admin dashboard so you can tune.
- **Future-proof.** Adding GPT-5.5 or a new Gemini = one row in the model registry, no per-function edits.

## What this does NOT change

- The Curriculum Brain admin-approval pipeline (still required for published curriculum content).
- The ASR stack (Munsit > Soniox > Fanar > Azure > Deepgram). Speech-to-text is a different problem; not in scope.
- Image generation (visual ensemble already exists in `analyze-meme`; out of scope here).
- Subscription gating / Stripe (still queued).

## Suggested build order

1. `modelRegistry.ts` + `msaLeakDetector.ts` (foundations).
2. `aiBrain.ts` with `solo` + `ensemble` strategies + structured-output support.
3. Migrate `word-enrichment` and `generate-sample-sentences` first (silent leak bugs fixed in same edit).
4. Add `draft+critic` and `council` strategies.
5. Migrate `hf-chat`, `generate-story`, `phrase-of-the-day`, `curriculum-chat`, `analyze-meme`.
6. `llm_logs` schema additions + admin `/admin/ai-brain` dashboard.
7. Wire to upcoming Dialect Rulebook (next plan) so leak detector reads from DB.
8. Save `mem://architecture/ai-integration/ai-brain` describing strategies + when each runs.

## Sequencing with the Dialect Rulebook plan

These two plans are designed to compound. **Recommended order:** AI Brain first (this plan), then Dialect Rulebook — because the Brain's MSA guard can start with the hardcoded constants in `dialectHelpers.ts` on day 1, then swap to DB-driven rules on day 2 with zero code changes in the callers.
