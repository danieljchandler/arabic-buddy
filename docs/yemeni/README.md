# Yemeni dialect corpus (Lisan-Yemeni)

Source: user-uploaded `Shared.zip → Yemeni.zip` (Lisan Yemeni annotated corpus).
See `license.pdf` and `ReadMe.pdf` in the full corpus folder before redistributing.

## Where the files live

The raw corpus is ~142 MB and is intentionally **not** committed to the repo.
It lives in Lovable's persistent artifact storage:

```
/mnt/documents/yemeni-corpus/
  Lisan-Yemeni-dataset.csv            # 994,413 annotated tokens
  Lisan-Yemeni RowText_sentences.csv  # 38,822 raw sentences
  tagset_translation.xlsx             # POS / affix tagset glossary
  ReadMe.pdf, license.pdf
```

**Important:** that path exists only in Lovable agent sessions. Claude Code (and
any CI job) clones the git repo alone and cannot see it. Everything an external
agent needs must be a committed artifact in this folder. If a new cut of the
data is required, ask Lovable to re-run `scripts/derive-yemeni-artifacts.py`.

## Committed derived artifacts

All four are small, deterministic, and safe to read into prompts. They are
produced in one pass by `scripts/derive-yemeni-artifacts.py`, which fails
(non-zero exit) if any self-check regresses.

| File | Contents |
| --- | --- |
| `lisan-yemeni-lexicon.json` | Top 2,000 normalized tokens by frequency: `token`, `norm`, `count`, `pos`, `gloss`, `msa`, `da`, `msa_lemma_zero_ratio`. `SPELL`/`SPLIT` annotation rows excluded. |
| `lisan-yemeni-dialect-specific.json` | 1,200 **dialect markers** in two evidence classes (see below). Highest-signal list for authoring Yemeni `dialect_rules`. |
| `lisan-yemeni-msa-pairs.json` | 1,500 MSA-lemma → attested Yemeni surface-form pairs for MSA→Yemeni bridge rules and `msa_form` fields. |
| `lisan-yemeni-allowlist.json` | 2,875 normalized forms attested in the corpus, for the `msaLeakDetector` allow-list. |
| `derivation-report.json` | Stats + the self-check results for the committed cut. |

## How dialect markers are defined (and why the old list was wrong)

The first cut documented `dialect_specific` as "tokens with no MSA lemma id".
That definition does not work: the annotators only assign `MSALemmaID` to
**open-class** words, so every function word — including plain MSA `من`, `في`,
`ما` — carries `MSALemmaID = 0`. The old list was therefore mostly a frequency
list with `من` at the top.

The corrected derivation uses two separate, explicit evidence classes, each row
tagged with `class`:

- `function_word` — POS is closed-class (pronoun, negation, demonstrative,
  relative, interrogative, particle, adverb…), `count >= 5`, and the normalized
  form is **not** in an explicit MSA closed-class stoplist. The stoplist is
  expanded automatically with `و`/`ف`-prefixed variants and
  preposition+pronoun clitics (`له`, `عليه`, `فيها`…), which are shared with MSA.
  Top of the list: `بس، اللي، مش، ايش، ده، احنا، مالك، مو، كذا، فين، الحين، وين، ليه`.
- `content_word` — POS is open-class, `count >= 3`, `MSALemmaID == 0` in **≥90%**
  of the token's occurrences, proper nouns excluded (top POS not `اسم علم`, and
  fewer than 20% of occurrences tagged `اسم علم`).

`msa_lemma_zero_ratio` is kept on every row so a consumer can re-check the claim
rather than trusting the label.

## Self-checks (enforced by the script)

The script exits non-zero unless all of these pass; `derivation-report.json`
records them:

1. No stoplist (plain MSA) member appears in `dialect_specific`.
2. No proper nouns in `dialect_specific`.
3. Every `content_word` really has `msa_lemma_zero_ratio >= 0.9`.
4. The top 10 markers contain none of `من في علي الي الله ما لا و هو هي` — this
   is the check that would have caught the original bug.
5. `content_word` overlap with the top-200 frequency list is ≤ 40 (a dialect
   list that is 80% the frequency list is a broken filter).
6. `dialect_specific` is 300–1,200 rows and contains ≥50 function words.
7. MSA pairs: source ≠ target, no clitic-only variants, ≥300 genuinely lexical
   rows.
8. All emitted tokens are Arabic-script only, ≥2 characters.

## Annotated CSV schema

`Lisan-Yemeni-dataset.csv`:
`sentenceId, wordPosition, rawToken, Token, POS, Prefixes, Stem, Suffixes,
MSALemma, MSALemmaID, DALemma, DALemmaID, Person, Gender, Number, Gloss`

- `rawToken` = as written online (noisy), `Token` = normalized + vocalized.
- `MSALemmaID = 0` on an **open-class** token is a dialect signal; on a function
  word it is meaningless (see above).
- `DALemmaID` is populated on only 1.8% of rows and is unreliable — do not use
  it as the dialect flag.
- `Gloss` is English, `|` separates senses, `;` separates near-synonyms.

## How to use the artifacts

1. Mine `lisan-yemeni-dialect-specific.json` (`class=function_word` first) for
   negation, demonstrative, interrogative and vocabulary rules; add them to the
   `dialect_rules` table (`dialect = 'Yemeni'`) with ✅/❌ examples.
2. Use `lisan-yemeni-msa-pairs.json` rows where `likely_inflection = false` as
   MSA→Yemeni transformation rules and `msa_form` values for the Bridge track.
   Rows with `likely_inflection = true` share a stem (`كان`/`كنت`) and are
   morphology, not lexical substitutions — review before using.
3. Feed `lisan-yemeni-allowlist.json` into the Yemeni `ALWAYS_ALLOWED` set in
   `supabase/functions/_shared/msaLeakDetector.ts` so attested Yemeni forms are
   not flagged as MSA leaks.
4. Raw sentences are usable as authentic reading/listening seed material, but
   the corpus is scraped social media: political and profane content is common
   (`الحوثي`, `عفاش`, `دحباشي` are among the most frequent content words).
   Filter before showing anything to learners, and do not ship the political
   vocabulary into lessons.

## Regenerating

```
python3 scripts/derive-yemeni-artifacts.py   # run from the repo root, Lovable session only
```

Deterministic: same CSV in, same JSON out. Non-zero exit means a self-check
failed — fix the derivation, never commit a failing cut.
