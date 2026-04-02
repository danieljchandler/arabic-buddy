

# Adaptive Placement Quiz (20 Questions)

## Overview
A new `/placement` page with an AI-generated adaptive quiz that tests mixed skills (vocab, grammar, listening comprehension, reading) across difficulty tiers. The quiz starts at mid-level, gets harder on correct answers and easier on wrong ones, then outputs a CEFR level (A1–C2).

## Architecture

```text
User starts quiz
  → Edge function generates first question batch (mid-level)
  → User answers → score tracked client-side
  → After every ~5 questions, request next batch with updated difficulty
  → After 20 questions → calculate CEFR level
  → Save result to profile, update onboarding level
```

## Implementation

### 1. New Edge Function: `placement-quiz`
- **Input**: `{ action: "generate", current_difficulty: "B1", question_number: number, history: [{correct, difficulty}], dialect: string }`
- Uses `LOVABLE_API_KEY` + Gemini Flash
- Generates 5 questions per call (4 calls total for 20 questions)
- Question types: vocab matching, grammar fill-in-blank, reading comprehension snippet, sentence translation
- Each question includes: `question_arabic`, `question_english` (hidden by default per toggle pattern), `choices[]`, `correct_index`, `skill_type`, `difficulty` (A1–C2)
- Adaptive logic in the prompt: "Given the user got X/Y correct at difficulty D, generate 5 questions at difficulty [higher/lower/same]"
- Returns `{ questions: [...], suggested_difficulty: string }`
- On final call (`action: "score"`): takes full 20-answer history, returns `{ cefr_level: string, confidence: number, strengths: string[], weaknesses: string[] }`

### 2. New Page: `src/pages/PlacementQuiz.tsx`
- Clean, focused UI — one question at a time
- Progress bar (1/20 → 20/20)
- Question card shows Arabic prompt, 4 multiple-choice options
- English toggle (matches existing pattern with `showEnglish` state + Switch)
- After each answer: brief correct/incorrect feedback (1.5s), then auto-advance
- Client-side state tracks: `answers[]`, `currentDifficulty`, `questionIndex`
- Fetches questions in batches of 5 (questions 1-5, 6-10, 11-15, 16-20)
- Adaptive: after each batch, sends score summary to get next batch at adjusted difficulty

### 3. Results Screen
- Shows determined CEFR level with description
- Strengths and weaknesses breakdown (e.g., "Strong vocab, grammar needs work")
- "Start Learning" button → saves CEFR level to profile and navigates to home/learning path
- Option to retake

### 4. Database Changes
- Add `placement_level` (text, nullable) and `placement_taken_at` (timestamptz, nullable) columns to `profiles` table
- No new tables needed

### 5. Integration Points
- Link from onboarding "level" step: add a "Take Placement Quiz" option alongside the manual level selection
- Link from Settings page for retaking
- Route: `/placement` in App.tsx

### Key Details
- Questions are generated on-the-fly by AI, not stored — keeps it fresh per attempt
- The adaptive algorithm: correct → bump difficulty one CEFR level up; wrong → drop one level down; mixed → stay
- Batch approach (5 at a time) balances responsiveness with API efficiency
- Falls back gracefully if AI call fails mid-quiz (show error, let user retry from current position)
- Respects the global "English hidden by default" toggle pattern

