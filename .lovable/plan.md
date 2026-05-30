
# Plan: Live Voice Simulator + Search-Grounded Souq News & Culture Guide

Two independent additions, both powered by the existing `GEMINI_API_KEY`.

---

## 1. Gemini Live API → Conversation Simulator

Today the simulator is a typed/STT round-trip: record → Munsit/Soniox ASR → `conversation-practice` text reply → Azure TTS. Latency is ~3-6s per turn and there's no barge-in. Gemini Live gives us true real-time spoken dialogue (~500ms first audio, native interruption) with dialect-conditionable voices.

### Architecture

Live API requires a persistent WebSocket. Two valid shapes:
- **(A) Browser ↔ Google directly**, using an **ephemeral token** minted by an edge function. Lowest latency, no audio relay through our infra.
- **(B) Browser ↔ Edge Function ↔ Google.** Adds a hop and Deno WS plumbing, but keeps the API key fully server-side and lets us log/moderate every turn.

**Recommended: (A) ephemeral tokens.** Standard Google pattern, ~30s session-bound tokens, key never leaves the server. We already trust the client for ASR audio uploads.

### New edge function: `live-session-token`
- `verify_jwt = false` in code, but validates Supabase JWT manually (same pattern as other functions).
- Enforces `enforceDailyCap(req, "live-session", 30, corsHeaders)` — 30 sessions/user/day.
- POSTs to `https://generativelanguage.googleapis.com/v1beta/auth_tokens:create` with `GEMINI_API_KEY`, requesting a token scoped to `models/gemini-2.5-flash-preview-native-audio-dialog` (the current Live-capable model), 60s validity, 10min session cap.
- Returns `{ token, model, expiresAt }`.

### New frontend: `LiveConversation` mode in `ConversationSimulator.tsx`
- Add a "🎙️ Live voice" toggle next to the existing chat. When on, replaces the text composer with a single push-to-talk / hands-free mic button.
- New hook `useGeminiLive(dialect, level, topic)`:
  - Fetches ephemeral token from `live-session-token`.
  - Opens WebSocket to `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`.
  - Sends `setup` message with:
    - system instruction built from `buildDialectSystemPrompt(dialect, level, topic)` (reuses `_shared/dialectHelpers.ts` — same MSA/cross-dialect guardrails as text mode).
    - `responseModalities: ["AUDIO"]`, `speechConfig.voiceConfig` picked per dialect (e.g. `Aoede` warm female for Egyptian, `Puck` for Gulf, `Charon` deeper for Yemeni — exact mapping confirmed at impl time).
    - `outputAudioTranscription: {}` so we also get the model's text for the on-screen transcript.
  - Streams 16kHz PCM mic audio via `AudioWorklet` → `realtimeInput.audio` frames.
  - Plays back returned 24kHz PCM via `AudioContext` queue. Cancels playback the moment the user speaks (Live emits `interrupted` events).
  - Surfaces user + assistant transcripts back into the existing `messages` state so the chat log, "save phrase," and corrections panel all keep working when the user ends a session.
- Reuses existing dialect picker, level, topic seeds, immersion toggles.

### Out of scope (for now)
- Pronunciation scoring on Live turns (Azure pipeline stays for the explicit Shadowing module).
- Persisting raw audio.
- Mobile Safari fallback beyond what `AudioWorklet` already gives us (will note "Chrome/Edge recommended" in UI).

---

## 2. Google Search Grounding → Souq News + Culture Guide + Ask Anything

Today these features answer from model memory or from Firecrawl-scraped pages we pass in. Adding the Gemini `googleSearch` tool gives live web results and inline citations with no extra API key.

### Souq News (`souq-news/index.ts`)
- When the request is `{ mode: "discover" }` (auto-find today's stories) rather than a user-supplied URL, add `tools: [{ googleSearch: {} }]` to the Gemini call.
- Parse `groundingMetadata.groundingChunks[].web.{uri,title}` from the response and return them alongside the article as `sources: [{ title, url }]`.
- Keep the existing Firecrawl path unchanged for user-pasted URLs.

### Culture Guide (`culture-guide/index.ts`)
- Add `tools: [{ googleSearch: {} }]` to every call. Culture questions ("what do Emiratis eat during Eid?") benefit most from live grounding.
- Append a "Sources" section to the returned markdown using `groundingMetadata`.

### Reading Practice "Ask Anything" (only if it currently has no grounding)
- Same change: enable `googleSearch` tool, surface sources.

### Frontend
- `SouqNews.tsx` and `CultureGuide.tsx`: render the new `sources` array as small chips under each answer (`<a target="_blank" rel="noreferrer">`). No layout overhaul.

### Constraint
- `googleSearch` tool is only available on Gemini 2.5 / 2.0 models — fine, we're on `gemini-2.5-flash` / `pro` already.
- Grounded calls cost slightly more, but well under the new credit.

---

## Files touched

**New**
- `supabase/functions/live-session-token/index.ts`
- `src/hooks/useGeminiLive.ts`
- `src/components/conversation/LiveVoicePanel.tsx`

**Edited**
- `src/pages/ConversationSimulator.tsx` — add Live toggle + panel mount
- `supabase/functions/souq-news/index.ts` — add `googleSearch` tool, return sources
- `supabase/functions/culture-guide/index.ts` — same
- `src/pages/SouqNews.tsx`, `src/pages/CultureGuide.tsx` — render source chips

**Memory**
- Add `mem://features/conversation-simulator/live-voice` documenting the ephemeral-token flow, voice→dialect map, and 30/day cap.
- Update `mem://architecture/ai-integration/gateway-strategy` to note that Live API + Search grounding bypass the Lovable gateway and call Google directly with `GEMINI_API_KEY`.

## Risks / open questions
1. **Voice → dialect fidelity.** Gemini Live voices are not dialect-trained the way Munsit Aisha is. The system prompt forces dialect lexicon/grammar, but accent will be a generic Arabic TTS. Acceptable for conversation practice; we keep Munsit/Azure for pronunciation-critical flows.
2. **Mobile.** `AudioWorklet` + 16kHz capture works on modern iOS Safari but is fragile. We'll show a Chrome/Edge recommendation banner on first use.
3. **Session limits.** Google currently caps Live sessions at ~15 min audio. The 10-min server cap keeps us inside that comfortably.

Proceed?
