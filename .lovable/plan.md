# Pipeline Overhaul — ASR Timing, Multimodal Translation, 3-Tier Fallback

Synthesis of my audit + Gemini's spec, updated to route Tier 2/3 through OpenRouter with top-tier Claude Opus and Qwen models.

## Current architecture (recap)

```text
audio ──┬─ Munsit / Soniox / Fanar / Azure / Deepgram (parallel)
        ▼
    waterfall picker  →  primaryText
    Deepgram words    →  alignLinesToAudio (proportional by char length)
        ▼
    analyze-gulf-arabic
      ├─ Gemini 2.5 Pro → fallback Qwen 235B
      ├─ Fanar-Sadiq / Fanar-C (metadata + validate)
      ├─ CAMeL (dialect classifier)
      └─ Claude 4.5 + Gemini 2.5 Flash (vocab enrichment)
        ▼
    falcon-translate (per-line, redundant)
```

## Scope

### 1. ASR timing + quality (`process-approved-video`)

1. **Preserve native timestamps.** Capture Soniox v4 `tokens[]` (already merged into `words[]` shape in `soniox-transcribe`) and Munsit word array inside `runPipeline`.
2. **New `alignLinesToAudio` source of truth.**
   - Soniox primary → Soniox tokens
   - Munsit primary → Munsit words
   - else → Deepgram words → finally proportional char allocation.
3. **Quality-weighted primary picker.**
   ```text
   candidates = non-empty texts from {Munsit, Soniox, Fanar}
   median = median(len(c))
   valid  = [c for c in candidates if len(c) >= 0.5 * median]
   primary = longest(valid); tie-break Munsit > Soniox > Fanar
   ```
   Azure + Deepgram remain alternates only.
4. **Fix analyzer payload.** Send `transcript = primaryText` plus `primaryEngine` and `primaryWords`. Deepgram + others as `alternates.*`.

### 2. Unified multimodal translation (`analyze-gulf-arabic`)

5. **Remove redundant `falcon-translate` from ingestion.** Keep the function deployed for the on-demand "translate one line" UI button only.
6. **Native audio multimodality (Tier 1 only).** Forward signed URL from `video-audio` storage (or base64 if ≤20 MB) as `audioRef`. Tier 1 calls Google's API directly with `GEMINI_API_KEY` (already a secret) so we can attach `inline_data`/`file_data` audio parts — Lovable Gateway's chat-completions surface doesn't expose Gemini audio parts today.
7. **Context-driven prompt.** Inject CAMeL classifier output (city-level dialect code + confidence) and Fanar-Sadiq metadata into a `<dialect_anchor>` block before the text alternates.

### 3. 3-tier sequential fallback (translation only)

Single shared JSON schema. Sequential — try Tier 1, on failure / empty / non-conforming JSON, fall through.

| Tier | Model | Path | Notes |
|---|---|---|---|
| 1 | `google/gemini-3.1-pro-preview` | Direct Google API (`GEMINI_API_KEY`) | Multimodal audio+text. Enable `thinkingConfig.thinkingBudget` for deliberation on regional idioms. |
| 2 | `anthropic/claude-opus-4.1` | **OpenRouter** | Best Claude reasoning model for tone/cultural nuance. Enable extended thinking (`reasoning: { max_tokens: ... }`). Text-only. |
| 3 | `qwen/qwen3-max` | **OpenRouter** | Alibaba's flagship; best Qwen for Arabic dialectal translation. Open-weight safety net. Text-only. |

OpenRouter routing rules:
- Both Tier 2 and Tier 3 go through the existing `OPENROUTER_API_KEY` secret — no new keys needed.
- If `claude-opus-4.1` is unavailable on OpenRouter at call time, auto-fall to `anthropic/claude-sonnet-4.5` (which is already used in enrichment).
- If `qwen3-max` is unavailable, auto-fall to `qwen/qwen3-235b-a22b` (current model).
- These intra-tier fallbacks happen silently and do NOT consume the tier counter.

Vocab enrichment + Fanar validation stay as-is (parallel, inside Tier 1 success path). The 3-tier loop wraps **translation only**.

### 4. Database + hygiene

8. Keep `EdgeRuntime.waitUntil` background pattern.
9. **Expanded `engines_used` JSONB** (backward-compatible):
   ```json
   {
     "asr": [
       { "name": "Munsit", "chars": 1240, "latencyMs": 4100, "won": true },
       { "name": "Soniox", "chars": 1198, "latencyMs": 7200, "won": false }
     ],
     "translation": {
       "tierWon": 1,
       "tiers": [
         { "name": "google/gemini-3.1-pro-preview", "via": "google-direct", "latencyMs": 6400, "status": "ok" },
         { "name": "anthropic/claude-opus-4.1", "via": "openrouter", "status": "skipped" },
         { "name": "qwen/qwen3-max", "via": "openrouter", "status": "skipped" }
       ]
     },
     "analysis": "analyze-gulf-arabic"
   }
   ```
10. **No migration.** `engines_used` is already `jsonb`. Update `MyTranscriptions.tsx` parser to read `engines_used.asr[].name` while still tolerating the old flat-array shape.

## Out of scope
- ElevenLabs Scribe in the ASR ensemble
- Touching CAMeL / Fanar metadata calls
- Curriculum or other AI brain pipelines
- UI redesign beyond a small badge parser tweak

## Implementation order
1. Inline Soniox + Munsit word capture in `runPipeline`.
2. `pickPrimaryText` helper + new `alignLinesToAudio` signature.
3. Send `primaryText` / `primaryWords` / `primaryEngine` to `analyze-gulf-arabic`; drop Deepgram-first.
4. Remove `falcon-translate` from ingestion path.
5. Add `audioRef` (signed URL) to analyzer payload.
6. Refactor translation into `runTranslationTier(tier, payload)`; sequential 1→2→3 with intra-tier model fallback.
7. Expand `engines_used` write; update `MyTranscriptions.tsx` parser.
