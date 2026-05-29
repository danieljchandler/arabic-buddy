# Add streaming support to the AI Brain

Bring the three streaming chat endpoints (`free-chat`, `conversation-practice`, `how-do-i-say`) under the AI Brain umbrella without losing token-by-token UX or current behavior.

## What's wrong today

- `free-chat` streams from `google/gemini-2.5-pro` directly via raw `fetch` — no dialect identity injection from the Brain, no MSA leak guard.
- `conversation-practice` is non-streaming and hits `gemini-3-flash-preview` directly; no Brain features.
- `how-do-i-say` runs its own multi-model ensemble (Fanar + others) that predates the Brain and duplicates a lot of logic.
- The Brain's `askBrain()` is response-complete only, so streaming flows can't use it.

## Plan

### 1. Extend `_shared/aiBrain.ts` with `streamBrain()`

Add a new exported function that mirrors `askBrain` but returns an SSE stream:

```ts
export interface StreamBrainTask extends Omit<BrainTask, 'tool' | 'strategy'> {
  // Streaming is single-model only; ensemble/council can't stream coherently.
  model?: string;
}

export async function streamBrain(task: StreamBrainTask): Promise<Response>
```

Behavior:
- Builds the same dialect identity + vocab rules system prompt as `askBrain` (reuses `buildSystem`).
- Calls the Lovable gateway with `stream: true`.
- Pipes the upstream SSE body straight through to the caller (preserves Vercel-AI-style chunk format).
- Optional `onComplete(fullText)` callback so callers can fire-and-forget an MSA leak log after the stream ends (no repair pass — would defeat streaming UX).
- Returns a `Response` with `text/event-stream` so callers can `return streamBrain(...)` directly.

No changes to existing `askBrain` signatures.

### 2. Migrate `free-chat`

- Replace the inline system-prompt builder with `streamBrain({ purpose: 'free_chat_turn', dialect, systemPromptExtra: <level + correction rules + topic hint> })`.
- Drop the manual gateway `fetch` block; keep the 429/402 error mapping by letting `streamBrain` throw `BrainHttpError` and mapping in a `try/catch`.
- Keep streaming response shape identical so the client doesn't need changes.

### 3. Migrate `conversation-practice`

- Switch to `streamBrain` (this also upgrades it from non-streaming to streaming).
- Use `systemPromptExtra` for the difficulty/level instructions.
- Keep `enforceDailyCap` and 30s abort logic.
- Client today expects JSON `{ reply }` — to avoid breaking it, keep a `?stream=0` fallback that buffers the stream server-side and returns JSON. Default new behavior is SSE.

### 4. Refactor `how-do-i-say`

- Replace its bespoke ensemble (Fanar + others + custom critic) with a single `askBrain({ purpose: 'how_do_i_say', strategy: 'council', tool: emit_translation })`.
- Define an `emit_translation` tool schema that captures the existing output fields (dialect Arabic, transliteration, literal English, notes, alternatives).
- Add an `arabicTextPath` so the MSA scanner sees only the Arabic field.
- Keep the existing Supabase persistence and response shape unchanged.
- This one stays non-streaming (it's a structured lookup, not a chat).

### 5. Verify

- `supabase--deploy_edge_functions` for the three functions plus _shared.
- `supabase--curl_edge_functions` smoke tests:
  - `free-chat`: one Gulf turn, confirm SSE chunks arrive and Arabic-only output.
  - `conversation-practice`: one Egyptian turn, confirm streaming response.
  - `how-do-i-say`: one Yemeni phrase, confirm tool output structure matches old shape.
- Check `supabase--edge_function_logs` for `[aiBrain]` warnings.

## Files touched

- `supabase/functions/_shared/aiBrain.ts` — add `streamBrain` + small internal refactor to share `buildSystem`.
- `supabase/functions/free-chat/index.ts`
- `supabase/functions/conversation-practice/index.ts`
- `supabase/functions/how-do-i-say/index.ts`
- Memory: update `mem://architecture/ai-integration/ai-brain` to document `streamBrain`.

## Not in scope

- Client-side AI SDK migration (chat client still consumes raw SSE).
- Repair pass on streamed output (incompatible with streaming UX — leak logging only).
- `bible-passage` migration (deferred earlier; keep as-is).
