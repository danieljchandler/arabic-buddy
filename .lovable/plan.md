## Sentence Practice on Flashcards

Add a "Make a sentence" action to every flashcard. User records themselves saying a sentence that uses the target word. Munsit transcribes it, then an AI coach (lenient with non-native pronunciation) returns structured feedback in the current dialect.

### UX flow

1. On any flashcard (My Words review, My Phrases review, and the Flashcard component used elsewhere), add a subtle **"Practice a sentence with this word"** button below the card body.
2. Tapping opens a bottom-sheet / dialog:
   - Big mic button → tap to start, tap to stop (with waveform/level meter, reuse `LevelMeter`).
   - Shows the target word + English gloss at the top as a reminder.
3. On stop:
   - Upload audio → Munsit ASR (via new edge function).
   - Send transcript + target word + dialect to AI coach.
   - Show a loading state ("Listening…" → "Coaching…").
4. Feedback card displays:
   - **What we heard** — the raw transcript (tappable via `TappableArabicText`).
   - **Did you use the word?** — green check / soft warning (lenient: accepts root + morphology matches, not just exact form).
   - **Correctness** — 1-line verdict ("Makes sense" / "Almost — meaning is unclear").
   - **More natural in [Dialect]** — rewritten sentence in the active dialect (tappable, with play button using existing TTS route for that dialect).
   - **Why it changed** — 1-2 short bullets explaining the swap (grammar/word choice/naturalness).
   - **Other ways to say it** — 1–2 alternative phrasings (tappable + play).
   - **Pronunciation** — overall score + 1–2 tips (reuses `pronunciation-feedback` style; scored against the user's own transcript so non-natives aren't penalized for accent, only for intelligibility).
5. Buttons: **Try again**, **Save sentence to My Phrases** (optional), **Done**.

### Leniency rules (baked into prompts)

- Target-word check: normalize both sides (strip tashkeel, alef/ya/ta-marbuta variants) and accept any inflected form sharing the root. Don't fail on missing diacritics or minor spelling.
- Pronunciation score: grade *intelligibility*, not native-likeness. Instruct the coach to be encouraging, mention 1 concrete sound to work on, and never say "wrong."
- If ASR returns empty/very short text → friendly "we couldn't hear that clearly, try again in a quieter spot" instead of an error.

### Files to add

- `src/components/practice/SentencePracticeSheet.tsx` — the dialog UI, recorder, feedback rendering.
- `src/hooks/useSentencePractice.ts` — orchestrates record → transcribe → coach; returns `{ status, transcript, feedback, start, stop, retry }`.
- `supabase/functions/practice-sentence-coach/index.ts` — accepts `{ audioBase64, mimeType, targetWord, targetWordEnglish, dialect }`, calls Munsit for ASR, then Lovable AI Gateway (TRANSLATION lineup via `_shared/modelRegistry.ts`) for structured coaching output (JSON tool call with `usedTarget`, `correctness`, `natural`, `naturalChanges[]`, `alternatives[]`, `pronunciationTip`, `overallScore`).

### Files to modify

- `src/pages/MyWordsReview.tsx` — add the Practice button on the answer side of the card.
- `src/pages/MyPhrasesReview.tsx` — same, targeting the phrase.
- `src/components/Flashcard.tsx` — expose Practice button when a `targetWord` is present so any other flashcard surface picks it up automatically.

### Technical details

- ASR: reuse Munsit call pattern from `supabase/functions/score-set-phrase-voice/index.ts` (multipart, `x-api-key`, 25s timeout).
- Model: `MODEL_LINEUPS.TRANSLATION` (Claude Sonnet 4.5 + Gemini 3.5 Flash ensemble) via `aiBrain`, purpose `translation` (already dialect-aware and MSA-leak-guarded per project rules).
- Dialect voice for the "natural" sentence playback: reuse existing dialect TTS routing (`useAzureTTS` + Munsit Khaleeji for Gulf/Yemeni).
- Structured output via tool-calling JSON schema (no `.min/.max` bounds per `ai-sdk-agent-patterns`).
- CORS: reuse `_shared/cors.ts`.
- No new tables; the feature is transient. Optional "save to My Phrases" reuses existing `user_phrases` insert path.

### Verification

- Record a clearly-in-Arabic sentence with the target word → transcript matches, `usedTarget: true`, natural rewrite differs subtly.
- Record without the target word → warning row shown but still gives a rewrite.
- Record silence → friendly retry prompt, no crash.
- Switch dialect (Gulf → Egyptian) → natural rewrite and playback voice both change.
