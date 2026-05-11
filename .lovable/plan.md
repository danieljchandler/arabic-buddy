
## Goal

Replace the current scenario-based Conversation Simulator with a free-flowing chat — like talking to ChatGPT, but in the user's chosen Arabic dialect, calibrated to their CEFR level, with a push-to-talk mic, natural-sounding TTS replies, and tappable Arabic words/phrases that save to **My Words** or **Set Phrases**.

## User Experience

1. User opens the page (`/conversation` — same route, replaced).
2. Optional one-tap topic chips at the top (Coffee, Family, Work, Travel, Free Talk) just to seed the first AI message — but conversation is otherwise unconstrained.
3. AI opens with a short greeting + a question in dialect Arabic.
4. User can either type or hold the mic button to speak (push-to-talk → Munsit STT).
5. AI replies in Arabic only (English hidden by default per global immersion rule). Each reply auto-plays as audio.
6. Tap any Arabic word → bottom sheet with meaning + "Save to My Words". Long-press (or select multiple words) → "Save as Set Phrase".
7. Active-tutor behavior: if the user makes a mistake or struggles, the AI inserts a brief, friendly correction box above its next reply, then continues the conversation naturally. Periodically asks follow-up questions to keep things flowing.
8. Toggles in header: Show English, Show Transliteration, Show Tashkil (use existing global display prefs).
9. "New conversation" button resets the thread.

## Technical Design

### New edge function: `free-chat`
- Streams from Lovable AI Gateway (`google/gemini-2.5-pro` for quality + dialect nuance; falls back to `gemini-3-flash-preview`).
- Accepts: `messages[]`, `dialect`, `cefrLevel`, `topicHint?`.
- System prompt built from `_shared/dialectHelpers.ts` (strict dialect rules, no MSA, no cross-dialect leakage) + CEFR-calibrated vocabulary/sentence-length rules + "active tutor" instructions:
  - Stay in Arabic-only for the conversation line.
  - If user message contains a clear mistake, prepend a `<<correction>>...<</correction>>` block with one-line gentle fix in English.
  - Always end with a question to keep dialogue moving.
  - Match user's level: A1/A2 short simple sentences, B1/B2 mid, C1/C2 idiomatic.
- SSE streaming so words appear as typed.

### Voice
- **STT (push-to-talk)**: existing `munsit-transcribe` edge function (per ASR priority memory).
- **TTS**: dialect-aware
  - Gulf → `munsit-tts` (Aisha/emirati voice).
  - Egyptian / Yemeni → ElevenLabs `eleven_multilingual_v2` (best free-flowing Arabic prosody) via a new `elevenlabs-arabic-tts` edge function (or extend existing `elevenlabs-tts`).
- Auto-play each assistant message; replay button on every bubble.

### Tappable words & phrases
- Reuse `TappableArabicText` for word taps → save to `user_vocabulary` via existing `useUserVocabulary` hook.
- Add a "selection mode": user taps multiple adjacent words → floating "Save as Set Phrase" button → inserts into `user_phrases` (existing `useUserPhrases` hook) with the surrounding sentence as context.

### Page structure
- **Replace** `src/pages/ConversationSimulator.tsx` content with the new free-chat UI (keep route `/conversation` so existing nav links don't break).
- New components:
  - `src/components/chat/ChatMessage.tsx` — bubble with TappableArabicText, audio button, optional correction banner.
  - `src/components/chat/ChatComposer.tsx` — text input + push-to-talk mic.
  - `src/components/chat/SaveSelectionBar.tsx` — multi-word selection → save phrase.
- Persist conversation in `localStorage` (4h, per session-persistence memory) so refresh doesn't lose context. No DB persistence needed.

### Memory update
- Update `mem://features/learning/conversation-simulator` to reflect the new free-chat behavior (replaces scenarios; push-to-talk + dialect TTS + tappable saves).

## Out of Scope

- No conversation history list / saved chats (can be added later).
- No voice cloning or custom voices.
- No grading/scoring screen at the end (corrections happen inline).

## Files

**New**
- `supabase/functions/free-chat/index.ts`
- `src/components/chat/ChatMessage.tsx`
- `src/components/chat/ChatComposer.tsx`
- `src/components/chat/SaveSelectionBar.tsx`

**Edited**
- `src/pages/ConversationSimulator.tsx` (full rewrite, route preserved)
- `mem://features/learning/conversation-simulator`

**Possibly extended**
- `supabase/functions/elevenlabs-tts/index.ts` (add Arabic voice routing for Egyptian/Yemeni) — only if not already present.
