

## Fix: Soniox Transcription Failure

### Problem
The `soniox-transcribe` function fails after creating a transcription. The poll returns `status=error` but the code discards the error details, so we can't see the Soniox error message. The likely cause is the `translation` parameter — the admin video pipeline passes `includeTranslation: true`, which adds a translation block that may be unsupported by the current Soniox plan or model.

### Plan

1. **Add error detail logging** — When polling returns `status=error`, log the full poll response body so we can see Soniox's error reason.

2. **Make translation gracefully optional** — If the transcription creation fails with translation enabled, retry without translation. This ensures ASR still works even if the translation feature isn't available on the Soniox plan.

3. **Log the full transcription object on error** — At line 178, fetch the transcription details one more time and log them before returning the error.

### Technical Details

**File: `supabase/functions/soniox-transcribe/index.ts`**

- In the polling loop (lines 167-176), store the full `pollData` so it's available after the loop.
- At line 178-183, log `pollData` to capture `error_message`, `error_code`, or similar fields from Soniox.
- Add a retry mechanism: if `createResp` fails or the transcription errors out with translation enabled, retry without the `translation` block.

