

## Add Pronunciation Practice to Flashcard Review

You already have **Azure Speech Services** pronunciation assessment fully set up — the `useAzurePronunciation` hook and `azure-pronunciation` edge function are ready to go. This plan integrates a "Say it" microphone button into the review flows.

### Where it goes

Both review pages will get pronunciation practice:
1. **Review** (`/review`) — In "Learn Mode" (new words), after the card is revealed, add a mic button so the user can practice saying the Arabic word
2. **My Words Review** (`/my-words/review`) — Add a mic button below the Arabic word card

### New Component: `PronunciationButton`

A reusable component (`src/components/review/PronunciationButton.tsx`) that:
- Shows a **microphone button** ("Say it 🎤")
- On tap: records audio via `MediaRecorder` (WebM/Opus), auto-stops after 3s of silence or max 5s
- Sends the recording + the Arabic word to `useAzurePronunciation`
- Displays results inline:
  - Overall score with color band (Excellent/Good/Fair/Needs practice)
  - Per-word accuracy breakdown (colored highlights)
  - "Try again" button to re-record
- Uses the existing `scoreBand()` utility for consistent color coding

### Integration Points

**Review.tsx** (curriculum review):
- In the "Learn Mode" block (lines 204-229), after the ReviewCard and before "Got it — continue", add `<PronunciationButton word={currentWord.word_arabic} />` 
- Optionally also show it after quiz answers are revealed

**MyWordsReview.tsx** (user words review):
- Below the audio buttons section (line ~225), add `<PronunciationButton word={currentWord.word_arabic} />`

### Recording Logic

```text
User taps mic → MediaRecorder starts (audio/webm;codecs=opus)
  → Auto-stop after 4s or user taps stop
  → audioBlob sent to useAzurePronunciation.assess(blob, arabicWord, 'ar-SA')
  → Display score + word breakdown
  → "Try again" resets and allows re-recording
```

### Files to create/modify
- **Create**: `src/components/review/PronunciationButton.tsx` — mic recording + score display component
- **Modify**: `src/pages/Review.tsx` — add PronunciationButton in learn mode
- **Modify**: `src/pages/MyWordsReview.tsx` — add PronunciationButton below card

### No backend changes needed
The `azure-pronunciation` edge function and `useAzurePronunciation` hook are already fully implemented with Gulf Arabic support (ar-SA default).

