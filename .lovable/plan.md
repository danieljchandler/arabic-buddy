

## Further Speed Optimizations for Tutor Upload

Images are now generated in parallel, but there are two more bottlenecks worth addressing:

### 1. Parallelize Audio Clipping and Storage Uploads

Currently, audio clips (word + sentence) are created and uploaded **one candidate at a time** in a sequential loop (Step B). Each upload is a network round-trip. With 5-10 approved candidates, this adds up.

**Fix:** Batch all audio clipping (CPU-bound, fast) first, then upload all clips in parallel using `Promise.allSettled`. Finally, do all DB inserts in a single batch or parallel set.

### 2. Overlap Image Generation with Audio Decoding

Right now, audio decoding (`decodeAudioFile`) happens first, then image generation starts. Since audio decoding takes 1-2 seconds and is independent of image work, we can start both at the same time.

**Fix:** Use `Promise.all` to run audio decoding and the image resolution batch concurrently.

---

### Changes (all in `src/hooks/useTutorUpload.ts`)

**A. Start audio decode and image resolution simultaneously**
- Wrap `decodeAudioFile(file)` and the image resolution block in a single `Promise.all` so they overlap.

**B. Parallelize audio clip uploads**
- After images and audio buffer are ready, clip all audio segments in a fast CPU loop (no await needed -- `clipToWav` is synchronous).
- Then upload all WAV blobs to storage in parallel with `Promise.allSettled`.

**C. Batch database inserts**
- After all uploads resolve, collect the resulting URLs and insert all rows at once using a single `.insert([...array])` call instead of one insert per candidate.

### Expected Improvement

- Audio decode + image gen overlap saves ~1-2 seconds
- Parallel clip uploads save ~2-5 seconds (was sequential network calls)
- Single batch insert saves ~1-2 seconds vs N sequential inserts
- Combined with existing parallel image gen: total time reduced by another 30-50%

