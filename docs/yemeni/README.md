# Yemeni dialect corpus (Lisan-Yemeni)

Source: user-uploaded `Shared.zip → Yemeni.zip` (Lisan Yemeni annotated corpus).
See `license.pdf` and `ReadMe.pdf` in the full corpus folder before redistributing.

## Where the files live

The raw corpus is ~142 MB and is intentionally **not** committed to the repo.
It lives in persistent artifact storage, readable by any agent/CLI in this project:

```
/mnt/documents/yemeni-corpus/
  Lisan-Yemeni-dataset.csv            # 994,616 annotated tokens
  Lisan-Yemeni RowText_sentences.csv  # 38,822 raw sentences
  tagset_translation.xlsx             # POS / affix tagset glossary
  ReadMe.pdf, license.pdf
  lisan-yemeni-lexicon.json           # derived, same as the file below
```

## Committed derived artifact

`docs/yemeni/lisan-yemeni-lexicon.json` (small, safe to read in prompts):

- `tokens` — top 2,000 tokens by frequency, each with `count`, `pos`, `gloss`,
  `msa` (MSA lemma) and `da` (dialectal lemma).
- `dialect_specific` — top 1,200 tokens that have **no MSA lemma id**
  (i.e. genuinely dialectal forms, count ≥ 3). This is the highest-signal list
  for authoring Yemeni `dialect_rules` rows and MSA→Yemeni transformations.

## Annotated CSV schema

`Lisan-Yemeni-dataset.csv`:
`sentenceId, wordPosition, rawToken, Token, POS, Prefixes, Stem, Suffixes,
MSALemma, MSALemmaID, DALemma, DALemmaID, Person, Gender, Number, Gloss`

- `rawToken` = as written online (noisy), `Token` = normalized + vocalized.
- `MSALemmaID = 0` means the form is not in the MSA lexicon → dialect marker.
- `Gloss` is English, `|` separates senses, `;` separates near-synonyms.

## How to use it for Yemeni parameters

1. Mine `dialect_specific` for vocabulary/negation/demonstrative rules and add
   them to the `dialect_rules` table (dialect = `Yemeni`) with ✅/❌ examples.
2. Use `MSALemma → Token` pairs as MSA→Yemeni transformation rules and as
   `msa_form` fields for the Bridge track.
3. Use forms attested here as an allow-list when tuning the MSA leak detector
   (`supabase/functions/_shared/msaLeakDetector.ts`) so real Yemeni forms are
   not flagged as MSA.
4. Raw sentences are usable as authentic reading/listening seed material, but
   note the corpus is scraped social media — political and profane content is
   common, so filter before showing to learners.
