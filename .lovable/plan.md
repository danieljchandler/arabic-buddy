

# Fix Build Errors

There are two issues breaking the preview:

## 1. Merge conflict markers in `src/App.tsx`

Git merge conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) are present at lines 38-42 and 178-184. These need to be resolved by keeping the branch content (the `LlmLogs` and `CurriculumBuilder` imports and routes).

**Line 38-42** — resolve to:
```typescript
import LlmLogs from "./pages/admin/LlmLogs";
import CurriculumBuilder from "./pages/admin/CurriculumBuilder";
```

**Lines 178-184** — resolve to:
```typescript
              <Route path="llm-logs" element={<LlmLogs />} />
              <Route path="curriculum-builder" element={<CurriculumBuilder />} />
              <Route path="curriculum-builder/:sessionId" element={<CurriculumBuilder />} />
```

## 2. Edge function type error in `azure-pronunciation/index.ts`

Deno's strict typing rejects `new Blob([audioBytes])` when `audioBytes` is `Uint8Array`. Fix by converting to `ArrayBuffer` first:

```typescript
body: new Blob([audioBytes.buffer]),
```

Both fixes are straightforward — resolving the merge conflicts restores the app, and the edge function fix resolves the deployment type check.

