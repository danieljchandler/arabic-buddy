

# AI Pronunciation Coaching Feedback

## Overview
After the Azure pronunciation score is returned, send the detailed results (per-word accuracy, error types, phoneme breakdowns) to Lovable AI to generate **natural language coaching tips** in English — e.g. "Focus on softening the 'ك' sound" or "You skipped the word 'في' — try speaking slower."

## How it works

Azure already returns rich data we're not fully surfacing:
- Per-word `errorType`: `Mispronunciation`, `Omission`, `Insertion`
- Per-phoneme accuracy scores
- Overall fluency/completeness scores

We'll pass this structured data to an AI model that generates 2-3 short, actionable tips.

## Implementation

### 1. New Edge Function: `pronunciation-feedback`
- **Input**: `{ word_arabic, word_english, scores (the full PronunciationResult), dialect }`
- Uses `LOVABLE_API_KEY` + Gemini Flash to generate 2-3 short coaching tips based on the scores
- Prompt instructs the AI to focus on: mispronounced words, omitted words, low-accuracy phonemes, fluency issues
- Returns `{ tips: string[] }` — e.g. `["Try elongating the vowel in كتاب", "You missed the word في — slow down"]`

### 2. UI: Update `PronunciationButton.tsx`
- After receiving Azure results, automatically call `pronunciation-feedback` in the background
- Show a small "💡 Tips" section below the score card with the AI-generated tips
- Show a loading skeleton while tips are being generated
- Tips appear with a fade-in animation

### 3. No database changes needed
Tips are generated on-the-fly per attempt — no persistence required.

### Key Details
- Uses dialect context to tailor feedback (e.g. Gulf vs Egyptian phoneme expectations)
- Tips are concise (1 sentence each), practical, and encouraging
- Falls back gracefully — if AI call fails, the score card still shows normally without tips
- For single words: focuses on phoneme-level feedback; for phrases: includes word-level and fluency feedback

