

## Goal
Add dialect-accurate tashkeel (fatha, damma, kasra, sukun, shadda, tanwin, dagger alif) to every newly transcribed line, for **Gulf, Egyptian, and Yemeni** alike. Vowels must reflect what the speaker actually said in their dialect — never MSA "corrections."

## Where the fix lands
A single edge function — `supabase/functions/analyze-gulf-arabic/index.ts` — handles all three dialects (it branches on `DIALECT_MODULE`). Two prompts inside it need updating:

### 1. `getMergeOnlySystemPrompt` (Call 1 — produces `lines[].arabic`)
Add a mandatory **TASHKEEL / HARAKAT** rule block:

- Every Arabic word in `lines[].arabic` MUST be fully voweled with tashkeel matching how the speaker actually pronounces it in the active dialect — NOT MSA.
- Mark all of: fatha (◌َ), damma (◌ُ), kasra (◌ِ), sukun (◌ْ), shadda (◌ّ), tanwin (◌ً ◌ٌ ◌ٍ), dagger alif (◌ٰ).
- Drop case endings (إعراب) the speaker doesn't pronounce.
- Keep shadda on every geminated consonant actually doubled.
- Never overlay MSA vowels on a dialectal pronunciation (no `قَالَ` over a spoken `گَال` / `چَال`).

Dialect-specific examples (all three modules covered):
- **Gulf** (Kuwaiti/Saudi/Emirati/Qatari): «شِنُو» not «شَنُو»; «وِشْ» not «وَشْ»; «چِذِي» not «كَذَا»; «يَبْغَى» not «يُرِيدُ».
- **Egyptian**: «إِزَّايْ» not «كَيْفَ»; «عَايِز» not «أُرِيدُ»; «دِلْوَقْتِي» with the actual short vowels heard; «بِتْعَمِل» not «تَفْعَلُ».
- **Yemeni**: «بَيْش» / «كَيْفَش» with the actual short vowel heard; «شِي» / «شَيّ» as pronounced; preserve the characteristic Yemeni vowel qualities (e.g. final imala) rather than normalizing to MSA.

The block is dialect-agnostic in structure; the examples are injected per `DIALECT_MODULE` so each dialect gets its own concrete guidance.

### 2. `getAnalysisSystemPrompt` (Call 2 — re-emits lines for analysis)
Add: "Input lines arrive already voweled with dialect-accurate tashkeel. Preserve every diacritic exactly. Do not strip, normalize, or re-vowel toward MSA."

### 3. Farasa stays untouched
- `callFarasaDiacritize` continues running on the merged blob → stored in `diacritizedTranscript` for the ElevenLabs TTS path (TTS expects MSA-shaped vowels — leave it).
- Farasa output is **never** written into `lines[].arabic`. User-facing text stays LLM-voweled = dialect-true.

### 4. No schema, tokenizer, or response-shape changes
Tokens are derived from `lines[].arabic`; the existing tokenizer preserves tashkeel in `surface`. `stripDiacritics` is only used for fuzzy matching — leaves storage untouched.

## Coverage
- **Transcribe page** ✓ (calls analyze-gulf-arabic directly)
- **MyTranscriptions** ✓ (reads stored lines)
- **Discover videos** ✓ (`process-approved-video` → analyze-gulf-arabic)
- **YouTube/RunPod path** ✓ (receive-audio → analyze-gulf-arabic)
- All three dialect modules ✓ (single prompt, dialect-conditional examples)

## Files to change
- `supabase/functions/analyze-gulf-arabic/index.ts` — prompt edits only (merge + analysis), with Gulf, Egyptian, and Yemeni example sets.

## Out of scope
- Re-voweling already-saved transcriptions (only new transcriptions get tashkeel).
- Bible verses, Souq News, generated curriculum (separate prompts, follow-up if desired).

## Result
Newly transcribed Kuwaiti, Egyptian, and Yemeni audio all render with vowels that match what was actually heard — e.g. Kuwaiti «شِنُو رَايْچ؟», Egyptian «إِزَّايَك النَّهَارْدَه؟», Yemeni «كَيْفَشْ حَالَكْ؟» — not MSA approximations.

