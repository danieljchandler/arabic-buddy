

# AI Optimization Plan for Gulf Arabic

## Overview

Optimize all AI edge functions for Gulf Arabic accuracy while preserving the multi-model verification approach. The user's key directive: keep Qwen, Fanar, and other Arabic-strong models for verification and cultural insight, even where Gemini is the primary engine. Upgrade models where appropriate but don't remove verification layers.

---

## Changes by Function

### 1. `translate-jais` — Dynamic Dialect Support
**Problem**: Hardcoded to "Omani" dialect everywhere.
**Fix**:
- Accept `dialect` parameter from request body (default: `"Gulf"`)
- Replace all hardcoded "Omani" references in `TRANSLATION_SYSTEM_PROMPT`, `QWEN_DIALECT_CHECK_PROMPT`, and user prompt with `${dialect}`
- Keep the full Qwen + Gemini + Fanar parallel ensemble and Qwen dialect-check step exactly as-is

### 2. `conversation-practice` — Server-side Gulf Arabic Identity
**Problem**: No system prompt on backend; relies entirely on client injection.
**Fix**:
- Add a server-side Gulf Arabic wrapper prompt that prepends to whatever the client sends
- Upgrade model from `gemini-2.5-flash` to `gemini-3-flash-preview`
- Add 402/429 error handling (partially exists, but reply still falls through to "AI service unavailable" on non-402/429 errors)
- Increase `max_tokens` from 300 to 500 (too short for natural conversation)

Server-side prompt to prepend:
```
You are a native Gulf Arabic conversation partner. Always respond in Gulf Arabic (Khaliji) dialect, 
NOT Modern Standard Arabic. Use authentic vocabulary and expressions from the Gulf region (UAE, Saudi, 
Kuwait, Qatar, Bahrain, Oman). Include transliteration in parentheses for key phrases. 
Be warm, encouraging, and culturally authentic.
```

### 3. `daily-challenge` — Strengthen Gulf Arabic Prompt + Error Handling
**Problem**: Weak system prompt ("Focus on Gulf Arabic"), no 402/429 handling.
**Fix**:
- Expand system prompt to explicitly require Khaliji vocabulary, forbid MSA, specify dialectal word examples
- Upgrade model to `gemini-3-flash-preview`
- Add 402/429 error propagation before the generic throw

### 4. `listening-quiz` — Enforce Gulf Arabic + Error Handling
**Problem**: "Focus on Gulf Arabic dialect when possible" is too weak. No 402/429 handling.
**Fix**:
- Change to: "Always use Gulf Arabic (Khaliji) vocabulary and expressions. Do NOT use Modern Standard Arabic (فصحى). Use dialectal forms like شلونك، وين، هالحين instead of MSA equivalents."
- Upgrade model to `gemini-3-flash-preview`
- Add 402/429 error propagation

### 5. `reading-passage` — Prioritize Gulf Arabic + Error Handling
**Problem**: "Focus on Gulf Arabic dialect with some Modern Standard Arabic" dilutes the dialect. No 402/429 handling.
**Fix**:
- Change to: "Primarily use Gulf Arabic (Khaliji) dialect. For beginner/intermediate levels, use Gulf dialect exclusively. For advanced levels, you may introduce MSA comparisons but the primary text must be Gulf Arabic."
- Upgrade model to `gemini-3-flash-preview`
- Add 402/429 error propagation

### 6. `hf-chat` — Upgrade Model
**Problem**: Uses `gemini-2.5-flash`, system prompt is already good.
**Fix**: Upgrade to `gemini-3-flash-preview`

### 7. `generate-story` — Upgrade Model
**Problem**: Uses `gemini-2.5-flash`, prompts are already well-structured with dialect parameter.
**Fix**: Upgrade to `gemini-3-flash-preview`

### 8. `weekly-coach` — Upgrade Model + Strengthen Prompt
**Problem**: Uses `gemini-2.5-flash`, prompt says "Gulf Arabic learning coach" but doesn't enforce dialect in output.
**Fix**:
- Upgrade to `gemini-3-flash-preview`
- Add to prompt: "Use Gulf Arabic (Khaliji) dialect for all Arabic text in your response, not MSA."

### 9. `generate-learning-path` — Upgrade Model
**Problem**: Uses `gemini-2.5-flash`, prompt is already good with dialect parameters.
**Fix**: Upgrade to `gemini-3-flash-preview`

### 10. `classify-tutor-segments` — Upgrade Model
**Problem**: Uses `gemini-2.5-flash`, prompt is already Gulf Arabic focused.
**Fix**: Upgrade to `gemini-3-flash-preview`

### 11. `analyze-meme` — Fix Qwen Model + Syntax Bug
**Problem**: Uses `qwen/qwen3-5-plus` (non-standard) for audio analysis. Stray `}` on line 353 causes code to run outside try block.
**Fix**:
- Change `qwen/qwen3-5-plus` to `qwen/qwen3-235b-a22b` (matches rest of codebase)
- Fix the mismatched brace on line 353

### 12. `falcon-translate` + `translate-jais` — Documentation Headers
**Fix**: Add comment headers clarifying these functions no longer use Falcon/Jais and explaining their actual purpose and model ensemble.

### 13. `extract-visual-context` — Keep As-Is
Uses `gemini-2.5-flash` for vision/multimodal, which is correct. `gemini-3-flash-preview` may not support vision. No change needed.

### 14. `how-do-i-say` — Keep As-Is
Already has the strongest ensemble (Gemini + Qwen + Gemma + Fanar in parallel with dialect verification). Prompts are already well-structured for Gulf Arabic. No changes needed.

---

## Summary Table

| Function | Model Change | Prompt Change | Error Handling | Other |
|---|---|---|---|---|
| translate-jais | No | Dynamic dialect | Already has | Doc header |
| conversation-practice | 2.5-flash → 3-flash-preview | Add server-side identity | Improve | max_tokens 300→500 |
| daily-challenge | 2.5-flash → 3-flash-preview | Strengthen Gulf Arabic | Add 402/429 | — |
| listening-quiz | 2.5-flash → 3-flash-preview | Enforce Khaliji | Add 402/429 | — |
| reading-passage | 2.5-flash → 3-flash-preview | Prioritize Gulf Arabic | Add 402/429 | — |
| hf-chat | 2.5-flash → 3-flash-preview | No | Already has | — |
| generate-story | 2.5-flash → 3-flash-preview | No | Already has | — |
| weekly-coach | 2.5-flash → 3-flash-preview | Minor strengthen | Already has | — |
| generate-learning-path | 2.5-flash → 3-flash-preview | No | Already has | — |
| classify-tutor-segments | 2.5-flash → 3-flash-preview | No | Already has | — |
| analyze-meme | qwen3-5-plus → qwen3-235b-a22b | No | Already has | Fix syntax bug |
| falcon-translate | No | No | Already has | Doc header |
| how-do-i-say | No | No | Already has | — |
| extract-visual-context | No (vision needs 2.5) | No | — | — |

**13 files edited. No database changes. No new functions.**

