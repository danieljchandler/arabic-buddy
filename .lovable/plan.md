

# Plan: Update Azure Secrets & Fix Build Error

## 1. Add AZURE_SPEECH_ENDPOINT secret
Store `https://ai-danieljchandler1453ai677904905773.cognitiveservices.azure.com/` as `AZURE_SPEECH_ENDPOINT`. Both the TTS and pronunciation functions already read this env var.

## 2. Update AZURE_SPEECH_KEY secret
Update the existing key to: `4bktEFkWQyO5ocFYilZlMH7Q0M68kHNs1LSYlGzHiSmCwJ9OlkTxJQQJ99CBACHYHv6XJ3w3AAAAACOG3YJ9`

## 3. Fix deno.lock build error
The `check-subscription/index.ts` imports `npm:@supabase/supabase-js@2.57.2` which fails due to an incompatible `deno.lock`. Fix by either:
- Deleting `deno.lock` so it regenerates, or
- Switching the import to use `esm.sh` like other functions do

I'll change line 3 of `check-subscription/index.ts` to use the esm.sh import pattern consistent with the rest of the codebase.

## 4. Redeploy affected functions
Redeploy `check-subscription` after the import fix.

