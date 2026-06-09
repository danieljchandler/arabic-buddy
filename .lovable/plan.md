## What's broken

The browser console shows `WebSocket open timeout` → `ws closed 1006`. Direct tests prove:
- The token endpoint mints valid tokens.
- A raw WebSocket to Google's Live API opens successfully from outside the browser.

So the failure is in how the browser-side hook waits for `onopen`, plus a too-strict 8s deadline and a flaky preview-stage model.

## Three fixes

### 1. `src/hooks/useGeminiLive.ts` — fix the open-promise race

The current `await new Promise(...)` only resolves on `ws.onopen` and rejects on timeout. If the WS closes before opening (1006), nothing rejects until 8s elapses, so we always show the misleading "timeout" message instead of the real close code, and we never surface the real failure cause.

Change the open wait to:
- Resolve on `onopen`.
- Reject on `onclose` if `readyState` never reached OPEN, surfacing `code`/`reason`.
- Reject on `onerror` if it fires before open.
- Extend the deadline from 8s → 20s (handshake latency from constrained networks can exceed 8s).

Keep the existing `onmessage`/`onclose`/`onerror` handlers in place for the live session; the open-phase listeners just need to also signal the promise.

### 2. `supabase/functions/live-session-token/index.ts` — switch to the GA Live model

The current model is `gemini-2.5-flash-native-audio-preview-09-2025` — a dated preview that has gone in and out of availability. Switch to the GA model `gemini-2.0-flash-live-001` for stability. Native-audio voices (`Charon`, `Aoede`, `Orus`) and the `ar-XA` language code stay the same.

If the user later wants the newer native-audio preview back for higher dialect fidelity, we can add it as an opt-in.

### 3. `src/hooks/useGeminiLive.ts` — clearer error surface

When `onclose` fires with `code 1006` and no reason, replace the generic "Voice session ended (1006)" with: "Voice connection closed before opening. This usually means the network or browser blocked the WebSocket. Try a different network or browser."

## Verification

After the changes:
1. Redeploy `live-session-token`.
2. Open `/conversation` in a new window (mic blocked in Lovable's preview iframe — known constraint).
3. Tap the live-voice button. Within ~3s, status should go `connecting → live` and the tutor should greet the user in dialect.
4. If it still fails, the new error message will tell us whether it's a close-before-open (network/CSP) or a real timeout (server slow), and the console will log the close code + reason.

## Out of scope

- Two-stage architecture (Gemini text → Munsit/ElevenLabs TTS).
- Swapping providers to OpenAI Realtime or Claude.
- Changing the dialect voice mapping.
