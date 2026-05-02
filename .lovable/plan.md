## Goal

Add an admin-only "AI Re-segment" action in the transcript editor that asks an LLM to restructure the existing word-level transcript into clean, thought-by-thought lines, starting a new line whenever the speaker changes. Admin still reviews the proposed result in the existing diff preview before accepting.

## What exists today

- `TranscriptEditor` already has a "🤖 Suggest Breaks" button calling `useAIAssist.suggestBreaks` and a `DiffPreview` accept/reject UI.
- That feature was never wired to a real backend — `AdminTranscriptEditor` does not pass an `aiApiCall` prop, so the button silently no-ops.
- Each `Segment` carries `words[]` with per-word `start`/`end` and an optional `speaker` field, but ASR pipelines currently don't populate `speaker` for most videos.

We will (a) add a real backend for the AI call, (b) make the prompt thought-and-speaker aware, and (c) wire it through the admin editor — keeping the existing manual editing + diff approval flow as the source of truth.

## Plan

### 1. New edge function `ai-resegment-transcript`

`supabase/functions/ai-resegment-transcript/index.ts`

- POST body: `{ segments: Segment[], dialect?: string }`.
- Calls Lovable AI Gateway (`google/gemini-2.5-pro` for quality on long context; falls back to `google/gemini-3-flash-preview` for short transcripts).
- Uses **tool-calling** (structured output) to return:
  ```ts
  { lines: Array<{
      start: number; end: number;
      text: string; translation: string;
      speaker?: string; // "A", "B"… when distinguishable
      wordIndices: number[]; // indices into the FLATTENED original words[] across all input segments
  }> }
  ```
- System prompt rules:
  - Preserve every original word and its timing — do **not** invent or drop words.
  - Each line should be one complete thought / clause; aim for ~2.5–7 seconds and ~4–14 Arabic words.
  - Start a new line whenever the speaker changes, on long pauses (>0.6s gap between adjacent words), or at clear sentence/clause boundaries.
  - Avoid lines shorter than ~1.2s unless they are a true short utterance from a different speaker.
  - Detect speaker changes from existing `speaker` tags when present; otherwise infer from pause length, vocative cues ("يا", "والله"), question/answer alternation, and discourse markers.
  - Forbid MSA rewriting and cross-dialect leakage (per project dialect rules).
  - Translation must be a faithful, casual English rendering of the line.
- CORS + 429/402 handling per Lovable AI guidelines. `verify_jwt = true` (admin-only feature, must be authenticated).
- Returns `{ segments: Segment[] }` already mapped back into the editor's `Segment` shape, with `words[]` reconstructed from the original word objects via `wordIndices` so timestamps stay anchored to ASR ground truth.

Because reasoning over a long transcript can exceed 60s, the function streams progress isn't required — we just set a generous timeout and surface errors. For very long transcripts (>~250 segments) the function chunks the input into overlapping windows of ~80 segments, processes them sequentially, and stitches results.

### 2. `useAIAssist` — new `resegment` action

`src/hooks/useAIAssist.ts`

- Add `resegment(segments, apiCall)` that mirrors `suggestBreaks` but expects already-mapped `Segment[]` back from the API instead of building a prompt locally (the prompt now lives server-side).
- Keep abort/cancel + status semantics.
- Keep existing `suggestBreaks` for backward compatibility but route the toolbar button to the new flow.

### 3. Toolbar button + diff flow

`src/components/TranscriptEditor/Toolbar.tsx` and `index.tsx`

- Replace the existing "🤖 Suggest Breaks" button label with **"✨ AI Re-segment (thought-by-thought)"**.
- On click, call the new edge function via `supabase.functions.invoke('ai-resegment-transcript', …)`.
- Show a loading state ("AI rethinking timing…") with the existing Cancel button.
- On success, populate `suggestedSegments` and reuse the existing `DiffPreview` accept-all / reject-all / accept-one UI — admin still has final approval.
- Show speaker badges (A, B, …) in the diff preview rows when the AI assigned them.

### 4. Wire `aiApiCall` through `AdminTranscriptEditor`

`src/components/admin/AdminTranscriptEditor.tsx`

- Pass an `aiApiCall` adapter (or, simpler, just have `TranscriptEditor` accept an `onAIResegment?: (segs) => Promise<Segment[] | null>` prop and call the edge function directly). The edge function path is cleaner — implement option B.
- Confirm only admins (already gated by `AdminLayout` + `is_admin` RLS) can reach this UI; the edge function additionally checks `is_admin()` server-side using the caller's JWT.

### 5. Preserve manual workflow

- No changes to split/merge/edit/timestamp ripple/undo. The AI output is always proposed via `DiffPreview`; admin can accept the whole thing, accept individual lines, reject everything, or keep editing manually after accepting.
- Undo stack treats "Accept all" as a single `replaceAll` (already supported) so admins can roll back the entire AI re-segmentation with one Cmd+Z.

### 6. Config

- `supabase/config.toml`: add `[functions.ai-resegment-transcript]` with `verify_jwt = true`.

## Out of scope

- Changing the published-side viewer (Discover, Bible, etc.) — they already render whatever segments the admin saves.
- Improving ASR speaker diarization itself; we only use whatever `speaker` data is already on the segments and let the LLM infer the rest from text + timing.
- Auto-running re-segmentation on import — kept as an explicit admin action so nothing changes without approval.

## Files

- **new** `supabase/functions/ai-resegment-transcript/index.ts`
- edit `supabase/config.toml` (add function block)
- edit `src/hooks/useAIAssist.ts` (add `resegment`)
- edit `src/components/TranscriptEditor/index.tsx` (new handler + prop)
- edit `src/components/TranscriptEditor/Toolbar.tsx` (rename/restyle button)
- edit `src/components/TranscriptEditor/DiffPreview.tsx` (show speaker badges)
- edit `src/components/admin/AdminTranscriptEditor.tsx` (pass AI handler)
