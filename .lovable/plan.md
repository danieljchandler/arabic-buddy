
## Goal
Swap the broken Gemini Live voice in `/conversation` for OpenAI's Realtime API ("ChatGPT live"), keeping the same UI but routing each dialect (Gulf / Egyptian / Yemeni) to its own tailored system prompt and voice.

## Why OpenAI Realtime
- Battle-tested low-latency voice (same engine as the ChatGPT app's Advanced Voice).
- Current documented WebRTC flow through `/v1/realtime/calls`, keeping the OpenAI key server-side.
- Strong dialect adherence when given a strict system prompt.

## What changes

### 1. Secret
Add `OPENAI_API_KEY` (your existing OpenAI key) so the edge function can mint ephemeral Realtime tokens. Never shipped to the browser.

### 2. New edge function: `realtime-session-token`
Replaces `live-session-token`. Each call:
- Reads `dialect`, `difficulty`, `topicHint` from the request.
- Builds a per-dialect system prompt using the existing Dialect Rulebook helpers (`getDialectIdentity`, `getDialectVocabRules`) — so Gulf/Egyptian/Yemeni each get their own identity, vocab rules, MSA-forbidden guidance, plus a "spoken dialogue, short turns" voice-call addendum.
- Picks a voice per dialect (initial mapping; tunable later):
  - Gulf → `ballad` (warm, grounded)
  - Egyptian → `shimmer` (bright, expressive)
  - Yemeni → `verse` (measured)
- Calls `POST https://api.openai.com/v1/realtime/calls` with `model: gpt-realtime-2`, the browser SDP offer, and the system prompt/session config in a server-side multipart request.
- Returns OpenAI's SDP answer to the browser; no OpenAI token or client secret is exposed.
- Keeps the existing daily usage cap (`enforceDailyCap('live-session', 30)`).

### 3. New hook: `useOpenAIRealtime`
Replaces `useGeminiLive`. Same exported shape (`status`, `error`, `turns`, `muted`, `setMuted`, `start`, `stop`) so the UI panel needs almost no changes. Implementation:
- Use **WebRTC** (OpenAI's recommended browser path): create `RTCPeerConnection`, add the mic track, attach a remote `<audio>` sink for the model's voice, open a data channel for events, then send the SDP offer to `realtime-session-token` for server-side exchange with OpenAI.
- On the data channel:
  - Stream user partials from `conversation.item.input_audio_transcription.delta/.completed`.
  - Stream assistant partials from `response.audio_transcript.delta` and finalize on `response.audio_transcript.done` / `response.done`.
  - Run the same client-side MSA leak detector and flag drift turns (`hasDialectDrift`) so the existing "used MSA" badge keeps working.
- Mute = disable the mic `RTCRtpSender` track; end = close peer connection + stop tracks.

### 4. `LiveVoicePanel`
- Swap `useGeminiLive` → `useOpenAIRealtime` (one-line change).
- Footer text: "Voice powered by ChatGPT Realtime."

### 5. Cleanup
- Delete `supabase/functions/live-session-token/` and `src/hooks/useGeminiLive.ts` once the new path is verified.
- Keep `GEMINI_API_KEY` secret in place (used elsewhere in the app).

## Technical notes
- Browser uses WebRTC (not raw WebSocket) — gives us echo cancellation, jitter buffer, and built-in audio playback element instead of hand-rolled PCM queueing.
- The SDP exchange is proxied through the edge function so the browser never receives OpenAI credentials.
- Dialect prompt assembly reuses your existing rulebook so admin edits to `dialect_rules` automatically flow into live voice.
- Per-dialect difficulty addendum (beginner/intermediate/advanced) is unchanged.

## Out of scope
- No changes to the rest of Conversation Simulator (text mode, topic picker, history saving).
- No new UI screens; just the existing live panel, now backed by OpenAI.

## Files touched
- add: `supabase/functions/realtime-session-token/index.ts`
- add: `src/hooks/useOpenAIRealtime.ts`
- edit: `src/components/conversation/LiveVoicePanel.tsx`
- delete (after verification): `supabase/functions/live-session-token/index.ts`, `src/hooks/useGeminiLive.ts`
- secret: add `OPENAI_API_KEY`

## Open question
Confirm voice choices per dialect (Gulf=ballad, Egyptian=shimmer, Yemeni=verse) or pick from OpenAI's set: alloy, ash, ballad, coral, echo, sage, shimmer, verse. I'll proceed with the defaults above unless you say otherwise.
