## Diagnosis

Symptom: WebSocket opens and mic frames are sent, but the tutor never replies. That's a classic Live API "input shape / end-of-turn never detected" failure, not a mic or token problem.

Two things in `useGeminiLive.ts` + `live-session-token/index.ts` are out of date relative to the current Live API:

1. **Client sends the deprecated frame shape.** Current code:
   ```ts
   { realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data }] } }
   ```
   The current Live API expects:
   ```ts
   { realtimeInput: { audio: { data, mimeType: "audio/pcm;rate=16000" } } }
   ```
   With `mediaChunks`, newer model revisions accept frames but never fire a turn — exactly what you're seeing.

2. **No automatic VAD configured.** Setup doesn't include `realtimeInputConfig.automaticActivityDetection`, so the server has no signal that you stopped talking and never generates a reply.

3. **Model alias may be stale.** `gemini-2.5-flash-preview-native-audio-dialog` has been rotated by Google; the current native-audio preview is `models/gemini-2.5-flash-native-audio-preview-09-2025` (or `gemini-live-2.5-flash-preview` for the half-cascade variant). I'll update and verify against the upstream response.

## Changes

**`supabase/functions/live-session-token/index.ts`**
- Update `LIVE_MODEL` to `models/gemini-2.5-flash-native-audio-preview-09-2025`.
- Add `realtimeInputConfig: { automaticActivityDetection: {} }` to `bidiGenerateContentSetup` so the server auto-detects end-of-turn from the audio stream.
- Keep `inputAudioTranscription` / `outputAudioTranscription` so the chat panel keeps showing live text.
- Echo the upstream `auth_tokens` error body verbatim back to the client (already mostly there) so we never silently swallow 400s.

**`src/hooks/useGeminiLive.ts`**
- Change the mic frame send to the new singular shape:
  ```ts
  ws.send(JSON.stringify({
    realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: b64 } },
  }));
  ```
- On `ws.onclose`, log `event.code` and `event.reason` and surface them as `error` so we can see *why* the server hung up (auth, quota, bad setup).
- On the first `onmessage`, log the parsed payload at debug level once — useful for confirming setup acceptance.
- When the user taps **Mute**, send `{ realtimeInput: { audioStreamEnd: true } }` as a manual turn boundary fallback (covers the case where the user pauses without VAD triggering).
- Keep everything else (AudioWorklet capture, 24 kHz playback queue, MSA leak detection) unchanged.

**No DB / no UI / no new packages.** Pure protocol fix in two files.

## Verification

1. Open `/conversation`, enter Live mode in a new window (preview iframe blocks mic — known constraint).
2. Speak one short sentence in Gulf dialect, pause.
3. Expect: input transcript appears under "You", then tutor audio plays and assistant transcript streams under "Tutor" within ~1.5s.
4. Check `live-session-token` edge logs — should show no upstream errors.
5. Repeat for Egyptian and Yemeni to confirm the dialect→voice map still resolves.

## Out of scope (for follow-up)

- Adding OpenAI Realtime as a parallel provider — you opted to stick with Gemini.
- Migrating Live to Lovable AI Gateway — not currently proxied for WebSocket protocols.
- Pricing / billing notes on `GEMINI_API_KEY` (separate from your Lovable AI credits).
