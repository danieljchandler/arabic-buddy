## Alphabet Journey — thorough fix

Three real bugs and a data audit, all scoped to the alphabet feature.

### 1. Spot-the-Letter marks correct answers as wrong

`wordContainsLetter` in `src/components/alphabet/SpotTheLetterGame.tsx` does a raw `word.includes(letter.isolated)`. Arabic has multiple visually-related codepoints that must be treated as the same base letter:

- ا ↔ أ إ آ ٱ ى (alif family)
- ي ↔ ى ئ (ya family)
- و ↔ ؤ (waw family)
- ه ↔ ة (ha / ta marbuta)
- Diacritics (tashkil `\u064B–\u0652`, tatweel `\u0640`) should be stripped

Result today: "أب / أم / أرنب" all read as *not containing* alif, so users who correctly tap them are told they're wrong (exactly what the user hit).

**Fix:** Add a `normalizeArabicChar` helper and compare normalized strings. Apply it inside `wordContainsLetter` and to the target letter's isolated form.

### 2. Alif "missing the hamza"

Data-wise, alif's isolated glyph is `ا` (correct), but every example word in the seed list uses hamza-carrier alif (`أب`, `أم`, `أرنب`). In the "Meet the letter" step the user sees a bare `ا` while the examples on the next screen are all `أ…`, which reads as inconsistent.

**Fix in `src/data/arabicAlphabet.ts`:**
- Add an optional `variants?: string[]` field to `ArabicLetter`.
- For alif: `variants: ["ا", "أ", "إ", "آ"]` with a one-liner hint that the hamza sits on/under alif.
- Similar variant hint for ya (`ي / ى`) and ta marbuta note on ha.

**Fix in `src/pages/AlphabetLetter.tsx` (Meet step):** when `letter.variants` exists, render the variants row under the big glyph (small muted line, e.g. `ا  أ  إ  آ` with the label "also written as"). No layout changes elsewhere.

### 3. Sound Match plays letters that haven't been learned yet

`AlphabetLetter.tsx` already passes `learnedPool` to `SoundMatchGame`, but the game's audio button doesn't reliably re-autoplay on letter change, and there's no `key` guaranteeing a fresh mount. On top of that, `LetterAudioButton`'s `autoplayedRef` never resets, so after the first round the wrong (cached) audio can play or nothing plays at all — which is likely why the user heard sounds that felt out of place.

**Fixes:**
- In `src/components/alphabet/LetterAudioButton.tsx`: reset `autoplayedRef` in a `useEffect` keyed on `text` so autoplay works each time the letter changes.
- In `src/components/alphabet/SoundMatchGame.tsx`: give the `<LetterAudioButton>` a `key={round.target.code}` (matches the pattern used in `AlphabetCheckpoint.tsx`) so it fully remounts per round and can't play stale audio.
- Sanity-check: distractors are already scoped to `pool` (learnedPool). Confirmed correct — no logic change needed there.

### 4. Letter-form data audit

Walk through all 28 entries in `ARABIC_LETTERS` and verify the four forms use the correct joining behavior:

- Non-connectors on their left (ا د ذ ر ز و) must have `medial` and `final` starting with the joiner `ـ` only when a preceding letter connects — current data is correct for these.
- Ha (ه) medial should be `ـهـ` (correct).
- Kaf (ك) medial `ـكـ` is correct; final form `ـك` is correct.
- Ta marbuta is not its own letter — leave alone but mention in ha's hint (see item 2).

If any single-entry glyph is wrong I'll correct it in the same pass. No expected changes beyond the alif variant addition, but this is the pass to catch anything the user noticed as "doesn't look right".

### Files touched

- `src/data/arabicAlphabet.ts` — add `variants`, add alif/ya variants, minor hint tweaks; verify all 28 forms.
- `src/components/alphabet/SpotTheLetterGame.tsx` — normalization helper + updated `wordContainsLetter`.
- `src/components/alphabet/SoundMatchGame.tsx` — `key` on the audio button.
- `src/components/alphabet/LetterAudioButton.tsx` — reset autoplay ref on text change.
- `src/pages/AlphabetLetter.tsx` — render variants row on Meet step when present.

No backend, DB, or edge-function changes. No changes to checkpoints, tracer, or four-faces panel logic.