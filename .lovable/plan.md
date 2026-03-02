

# Wire TranscriptEditor into Admin Video Form

## Problem
The new `TranscriptEditor` component (with gap indicators, Enter-to-split, duration labels, keyboard shortcuts, ripple timestamps) exists at `src/components/TranscriptEditor/` but is never rendered. The admin edit page at `src/pages/admin/AdminVideoForm.tsx` (line 790) still uses the old `EditableTranscript` component.

## Solution
Create a lightweight adapter component that bridges the data format gap, then swap it into AdminVideoForm.

## Key Data Mapping

```text
TranscriptLine (admin)     ->  Segment (editor)
  id                           id
  arabic                       text
  translation                  translation
  startMs (milliseconds)       start (seconds) = startMs / 1000
  endMs (milliseconds)         end (seconds) = endMs / 1000
  tokens                       words (map surface -> word, gloss preserved via round-trip)
```

## Changes

### 1. New file: `src/components/admin/AdminTranscriptEditor.tsx`
- Accepts `lines: TranscriptLine[]`, `onChange: (lines: TranscriptLine[]) => void`, `audioUrl?: string`
- Converts `TranscriptLine[]` to `Segment[]` on mount/update (ms to seconds, arabic to text, tokens to words)
- Passes `onSave` callback to `TranscriptEditor` that converts `Segment[]` back to `TranscriptLine[]` and calls `onChange`
- Preserves token glosses through round-tripping by storing them in a ref map keyed by segment ID
- Memoizes the conversion to avoid unnecessary re-renders

### 2. Edit: `src/pages/admin/AdminVideoForm.tsx`
- Replace import of `EditableTranscript` (line 16) with `AdminTranscriptEditor`
- Replace `<EditableTranscript lines={transcriptLines} onChange={setTranscriptLines} audioUrl={stableAudioUrl} />` (line 790) with `<AdminTranscriptEditor lines={transcriptLines} onChange={setTranscriptLines} audioUrl={stableAudioUrl} />`

### Trade-offs
- Inline gloss editing (clicking individual Arabic tokens to set English glosses) is not available in the new editor. Token data is preserved on save but cannot be edited inline. This is acceptable since the transcript structure features (split, merge, ripple timing, gap indicators) are far more valuable for the admin workflow.
- The `TranscriptEditor` includes a two-column video player layout -- when no `videoUrl` is passed, it renders the segment list full-width, which works well for the admin form's existing layout.

