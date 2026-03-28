

## Problem

Clicking a word in reading practice calls the `how-do-i-say` edge function for translation, which can error out. The passage already has line-by-line English translations available — we should use those instead.

## Plan

### 1. Replace API-based word translation with local context extraction

In `handleWordTap`, instead of calling the `how-do-i-say` edge function:
- Find which line the word belongs to
- Use that line's `english` translation as the contextual meaning
- Also check the passage's `vocabulary` array for a match (already partially done)
- This eliminates the network call and the error

### 2. Enhance the word popover with root and usage info

After the initial local translation is shown, make a single AI call (via `how-do-i-say` or a lightweight prompt) to enrich with:
- **Root** of the word (e.g. ك-ت-ب)
- **Other common uses/forms** of the word (2-3 examples)

This enrichment loads asynchronously *after* the popover opens with the instant local translation, so the user sees something immediately and gets more detail a moment later.

### 3. Update the popover UI

The popover will show:
- **