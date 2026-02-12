

## Speed Up Flashcard Image Generation

### Problem
Images are generated one-by-one in a loop. Each Gemini image generation call takes 5-15 seconds, so 5 words means 25-75 seconds of waiting. Retries add 2-second delays on top.

### Solution: Parallel Image Generation

Move image generation out of the sequential word-saving loop. Instead:

1. **Batch all image work upfront** -- Before the word-saving loop, kick off all image lookups and generations in parallel using `Promise.allSettled`.
2. **Use results during save** -- When saving each word, just grab the pre-resolved image URL from the batch results.

### Changes

**`src/hooks/useTutorUpload.ts`**

- Before the main word-saving loop, collect all candidates that need images.
- For each, first check `vocabulary_words` for an existing image (fast DB lookup).
- For those without a match, fire off all `generate-flashcard-image` edge function calls simultaneously using `Promise.allSettled`.
- Store results in a `Map<candidateId, imageUrl>`.
- Update progress label to show "Generating images (3 of 5)..." as promises resolve.
- In the existing word-saving loop, simply read from the map instead of calling the edge function.

### Expected Improvement

- 5 words currently: ~30-60 seconds (sequential)
- 5 words after fix: ~10-15 seconds (parallel, limited by the slowest single generation)
- Words reusing existing images resolve instantly

### Technical Details

```text
BEFORE:
  for each word:
    1. clip audio (fast)
    2. lookup existing image (fast)
    3. generate image if needed (SLOW - 5-15s)  <-- blocking
    4. save to DB (fast)

AFTER:
  Step A: parallel image batch
    - lookup all existing images at once
    - fire all missing generations in parallel
  Step B: for each word (sequential, all fast now)
    1. clip audio
    2. grab pre-resolved image URL from map
    3. save to DB
```

