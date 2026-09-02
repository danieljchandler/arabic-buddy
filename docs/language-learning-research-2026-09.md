# Research review: SLA evidence, SRS scheduling, speech feedback and dialect resources

*September 2026. A broad verification pass over second-language-acquisition and
spaced-repetition research, plus an inventory of dialectal-Arabic AI resources,
compared against what Hakiya actually implements. Companion to
`docs/plateau-research-2026-09.md`, which covered the plateau/output/chunk/
shadowing literature and is not repeated here.*

**Confidence labels.** Same scheme as the plateau review:
`confirmed` (primary source read and the number checked against it),
`supported-but-nuanced`, `contested`, `unverified` (extracted from a primary
source but not independently re-checked), `gap` (searched, nothing found).

**Honest note on method.** This review fanned out across 29 primary sources.
An adversarial 3-vote verification pass ran over the extracted claims but was
cut short partway through, so **14 claims carry a full 3-vote verdict** and a
further **3 were re-fetched and checked by hand** for this document. Everything
else is labelled `unverified`: it comes from a named primary source, but a
second reader has not confirmed the number. Where a claim would change a build
decision, its label says how much weight it can carry. Four claims were voted
down and are recorded in §9 rather than quietly dropped.

---

## 1. Spaced repetition: the scheduler is not where the wins are left

**`confirmed` (3-0) — FSRS-5 is two generations behind on accuracy.** On the
maintainers' benchmark over 9,999 Anki collections and 349,923,850 reviews:

| Version | Params | Log loss | RMSE(bins) | AUC |
|---|---|---|---|---|
| FSRS-7 recency | 34 | 0.3370 | 0.0593 | 0.7220 |
| FSRS-6 | 21 | 0.3460 | 0.0653 | 0.7034 |
| **FSRS-5 (ours)** | 19 | 0.3561 | 0.0742 | 0.7010 |
| FSRS-4.5 | 17 | 0.3625 | 0.0764 | 0.6891 |

Source: https://github.com/open-spaced-repetition/srs-benchmark

**`confirmed` (2-1) — but per-user parameter fitting is worth more than the
version bump.** FSRS-7 run on *stock default parameters* scores 0.3620 log loss
/ 0.0910 RMSE — **worse than per-user-optimized FSRS-5** (0.3561 / 0.0742), and
far worse than per-user-optimized FSRS-7 (0.3401 / 0.0634). An app shipping
fixed FSRS constants gives up most of the algorithm's advantage regardless of
which version it ships.

**This is the single most important finding in this document for Hakiya**, and
it inverts the obvious move. Upgrading `spacedRepetition.ts` from FSRS-5 to
FSRS-6/7 while keeping the stock weight vector buys a fraction of what fitting
19 weights per learner would buy — and we cannot fit anything, because we do not
store review histories (§7, gap 1).

**`confirmed` (3-0) — same-day reviews are exactly where the newer versions
improved.** FSRS-6 revised the same-day formula; FSRS-7 is the only version
giving realistic recall predictions for same-day reviews and the only one built
for fractional intervals. Since same-day handling is precisely why this repo
chose FSRS-5 over 4.5 (see the `CLAUDE.md` note and the relearn queue), the
same argument now points one version further on.

**`confirmed` (3-0) — high desired retention is a bad trade.** In a 5-year,
10,000-card simulation, moving desired retention from 0.90 to 0.99 raised
average memorized cards ~4.9% (6881 → 7218) while raising review load ~3.7×
(116 → 425 reviews/day) and study time ~2.9× (30.5 → 88.1 min/day). The
knowledge-per-hour ratio collapses from 13.7 to 4.6.
Source: https://github.com/open-spaced-repetition/SSP-MMC-FSRS

**`confirmed` (3-0) — and sophistication past FSRS has sharply diminishing
returns.** An MDP/stochastic-shortest-path optimal scheduler (SSP-MMC-FSRS)
does *not* dominate plain fixed-desired-retention scheduling: its
maximum-efficiency configuration (49.2 reviews/day, 18.6 min/day, 5953 cards)
is a statistical tie with simply setting DR = 0.70 (49.3 / 18.8 / 5946). A
fixed non-adaptive ladder (Memrise's 1→6→12→48→96→180 days) beat Anki-SM-2 and
matched FSRS at DR ≈ 0.87. **Do not build a cleverer scheduler.**

**`confirmed` (3-0) — Duolingo's Half-Life Regression fails the benchmark's own
bar.** HLR scores 0.4694 log loss / 0.1275 RMSE, worse than a trivial baseline
that predicts the user's average retention (0.3945 / 0.1034). Ebisu v2 and
ACT-R also fall below that baseline. FSRS-anything is the right family.

**`confirmed` (3-0), from the SLA side — spacing works, expansion does not.**
Kim & Webb's meta-analysis (98 effect sizes, 48 experiments, N = 3,411,
*Language Learning* 2022, DOI 10.1111/lang.12479) found spaced practice has a
medium-to-large effect over massed practice; short spacing matches long spacing
on immediate posttests but loses on delayed ones; and **equal-interval and
expanding schedules were statistically equivalent**. The expanding ladder that
SM-2 and FSRS are built around has no measured advantage *per se* in L2 — what
pays is spacing at all, and long enough intervals to be measured on delay.

**`confirmed` (3-0) — stacking retrieval + feedback + spacing roughly doubles
vocabulary gain.** A 17-day classroom experiment (48 Turkish learners, 64 target
words) found an optimized regimen produced 18 percentage points of accuracy gain
vs 8 for study-plus-cramming, holding identically at 1-day and 11-day delayed
posttests. Note the moderator: **the benefit was driven by high-frequency target
words**, which ties scheduling gains directly to frequency-ranked selection
(§4). Single small study — indicative magnitudes only.
Source: https://journals.sagepub.com/doi/10.1177/13621688211053525

## 2. Interleaving is not free, and may be harmful for beginners

**`confirmed` (3-0)** — In a randomized three-arm study of 107 low-achieving
adolescent L2 learners, **pure interleaved practice was actively harmful** for
acquiring new vocabulary. Interleaving acted as an *undesirable* difficulty for
this population. The author explicitly frames the result as input to scheduling
algorithm design in vocabulary software.
Source: https://onlinelibrary.wiley.com/doi/10.1111/lang.12659

**Scope limit, and an honest caveat.** The finding is scoped to low-proficiency
learners on a paired-associates task. The same paper's stronger claims — that
blocking helps *during initial encoding*, and that a blocked-then-interleaved
hybrid beats both pure schedules — **did not survive verification** (§9). So the
supportable design rule is the negative one: *do not interleave a beginner's
first exposures*. The positive prescription (block first, then interleave) is
plausible but currently unevidenced here.

`src/lib/reviewOrder.ts` interleaves both decks and is the file this lands in.

## 3. Input: mode and text type matter more than volume

**`confirmed` by hand-verification for this document** (re-fetched from the
primary source) — the incidental-vocabulary meta-analysis (24 studies, 29 effect
sizes, 2,771 participants) at
https://www.cambridge.org/core/journals/language-teaching/article/how-effective-is-second-language-incidental-vocabulary-learning-a-metaanalysis/E38E3468FD2090B1FA3051051DE8E70C:

- Pooled effect: **g = 1.14** immediate [0.86, 1.41], **g = 0.93** delayed.
- **Spaced exposure crushes massed exposure**, and the gap *widens* on delay:
  g = 1.51 vs 0.97 immediate, **g = 1.71 vs 0.58 delayed** (p = .013). This is
  meta-analytic support for spacing the *encounters with new words in content*,
  not just the flashcard reviews.
- **Pickup by input mode** (immediate / delayed):
  reading 17% / 15% · listening 15% / 13% · reading-while-listening 13% / **17%**
  · **viewing (audiovisual) 7% / 5%**.
- Pickup by depth of knowledge: form recognition 18% → 6%, meaning recognition
  15% → 17%, **meaning recall 9% → 12%**. Input yields recognition far more
  readily than production.
- Proficiency moderates hard: beyond-basic learners g = 1.40 vs basic learners
  **g = 0.70**. Narrative texts g = 1.43 vs expository **g = 0.61**.

**This is the most uncomfortable finding for Hakiya's shape.** The app is
video-first — Discover, Feed, DiscoverVideo, WordClips, the clip pipeline — and
audiovisual viewing is the *weakest* channel in this dataset, less than half the
pickup of plain reading, and the only mode whose gains fade rather than
consolidate. Reading-while-listening is the only mode that *improves* by the
delayed test.

Read it carefully rather than as "video is bad": the app already couples video
with transcripts, and that pairing *is* reading-while-listening. The finding
argues for making the transcript the primary object and the video the carrier —
not for dropping video, which does motivational work this meta-analysis does not
measure.

**`unverified` — extensive reading works and constrained beats free.** A 2025
meta-analysis (73 studies, 82 interventions) reports d = 0.41 overall, positive
across vocabulary, writing, oral proficiency and motivation. Two moderators cut
against the purist "free voluntary reading" position: **constraining text choice
to the learner's level (as graded readers do) and adding accountability both
produced larger effects than free unmonitored reading**.
Source: https://link.springer.com/article/10.1007/s10648-025-10068-6

**`unverified` — listening needs strategy instruction, not just practice.**
Explicit L2 listening strategy instruction produces d = 0.69 across 45 primary
studies / 51 samples. Teaching learners *how* to listen beats listening practice
alone. Source: https://journals.sagepub.com/doi/abs/10.1177/13621688211072981

## 4. Vocabulary selection: MSA frequency is the wrong ranking

**`confirmed` by hand-verification** — the **Arabic Vocabulary Profile (AVP)**
exists, is CEFR-aligned, covers **A1–A2 only**, uses MSA as the base form but
cross-checks dialect commonality, and is openly published in *Critical
Multilingualism Studies*:
https://cms.arizona.edu/index.php/multilingual/article/view/281
Its four selection criteria are frequency of use, multi-dialectal commonality,
linguistic complexity, and relevance to CEFR descriptors.

**`unverified` but load-bearing — MSA corpus frequency is a poor proxy for
dialectal usefulness.** The AVP authors' own examples: نافِذة is frequent in
written MSA but uncommon in dialects, where شبّاك dominates; صحيفة outranks
جريدة in both MSA frequency dictionaries, yet only جريدة is widespread across
urban dialects, so the AVP places جريدة at A1 and defers صحيفة. They also report
raw dialect-instance counts from the Manchester Dialect Database (محلّ 20,
دكّان 10, حانوت 2).

**`gap` — frequency lists for most urban Arabic dialects do not exist.** The AVP
authors could not compare word frequencies across varieties at all; they could
only compare presence/absence via the MDD and MADAR. Both prior CEFR-Arabic
word-list attempts (the KELLY project, and Khallaf & Sharoff's merge of
Buckwalter & Parkinson 2011 with Al-Kitaab vocabulary) **deliberately excluded
dialectal items**. There is no off-the-shelf frequency-ranked dialect list to
import.

**`unverified` — how little transfers between varieties.** From MADAR
(https://aclanthology.org/L18-1535.pdf): measured on parallel travel-domain
sentences, Arabic city dialects share on average only **~26% of vocabulary with
each other**, and even the dialect closest to MSA (Muscat, Gulf) overlaps MSA on
just **37.5%**. A concept inventory of only **1,045 concepts** gives ~85–88%
lemma-token coverage of that travel corpus, with each concept averaging 45
dialectal word forms across 25 cities.

**`unverified` — MADAR is directly usable.** 2,000 travel sentences translated
into 25 city dialects (Cairo, Doha, Riyadh, Muscat, Jeddah, **Sana'a**), plus
10,000 more for five cities. Its lexicon pairs every dialectal form with a
**CAPHI phonological transcription** and a CODA orthography — a ready-made source
of dialect-specific pronunciation targets, which matters because dialectal
Arabic has no standard orthography.

**`unverified`, and a direct warning about our own pipeline** — eliciting
dialect from an MSA source measurably biases output toward MSA. MADAR's authors
deliberately translated from English/French rather than MSA, attributing an
earlier corpus's inflated dialect-similarity scores to exactly that priming
effect. Anywhere Hakiya generates or translates dialect *from* MSA, this applies.

**`unverified` — morphology should be taught in context, not as paradigm
tables.** A PRISMA review of Arabic *sarf* instruction (2010–2025) finds
meaning-oriented morphology instruction outperforms rule-memorization on
morphological awareness, vocabulary, reading comprehension and proficiency. It
reports **no effect sizes and no study count**, so treat the direction as
suggestive only. The AVP applies the same principle in sequencing: it prefers
مُدَرِّس over the more frequent مُعَلِّم partly because the root د-ر-س yields
other A1 words (مَدْرَسة, يَدْرُس).

## 5. Speech: what ASR feedback actually buys

**`confirmed` by hand-verification** — the ASR pronunciation meta-analysis
(15 studies, 38 effect sizes, 2008–2021) at
https://www.cambridge.org/core/journals/recall/article/effectiveness-of-automatic-speech-recognition-in-eslefl-pronunciation-a-metaanalysis/A915444CF252B61D14961D2FE733822D:

| Moderator | Effect |
|---|---|
| **Overall vs non-ASR** | g = 0.69 [0.31, 1.08] |
| Explicit corrective feedback | **g = 0.86** |
| Indirect feedback (e.g. ASR dictation) | g = 0.50 |
| **Segmental** (phoneme) targets | **g = 0.82** |
| **Suprasegmental** (stress/rhythm/intonation) | **g = 0.37** |
| Duration 1–4 weeks | **g = 0.07** |
| Duration 5–8 weeks | g = 1.01 |
| Duration 9+ weeks | g = 0.72 |
| Practice alone | g = 0.44 |
| Practice with peers | g = 0.89 |
| Learners 18+ | g = 1.20 |
| Beginners | g = 1.33 |

Three consequences, one of them awkward:

1. **Name the error.** Explicit feedback nearly doubles indirect feedback's
   effect. A mismatched transcript is the weak form; "your ع came out as a
   glottal stop" is the strong one.
2. **Nothing happens in under five weeks** (g = 0.07). Pronunciation training is
   a retention feature before it is a pedagogy feature — a learner who churns at
   week three got nothing measurable.
3. **This partly cuts against our shadowing framing.** `docs/plateau-research-2026-09.md`
   concluded, correctly for *shadowing*, that feedback should sit on fluency and
   prosody rather than phonemes. But the ASR literature says the opposite about
   *ASR feedback*: segmental is where it works (0.82) and suprasegmental is where
   it doesn't (0.37). These are compatible — they are different interventions —
   and the resolution is to keep shadow mode on fluency/closeness while making
   the Azure word/sentence practice mode give explicit, named, segmental
   feedback. That is where reference-matched reading makes phoneme claims valid,
   which is what `shadowScoring.ts` already argues.

**`unverified`, and a hard ceiling — Arabic mispronunciation detection is not
reliable yet.** QuranMB.v1 (2025) is the *first* public Arabic MDD test set
(98 verses, 18 speakers, ~2.2h). Best baseline: **18.70% precision**, 29.88% F1
at 74.29% recall. Roughly **four in five flagged "errors" are false alarms.**
It targets MSA/Qur'anic recitation with a 68-phoneme inventory; the authors name
dialectal standardization as unsolved. **There is no dialectal-Arabic
pronunciation benchmark at all.** This vindicates the caution already encoded in
`pronunciationScoringCore.ts` and argues against ever surfacing confident
per-phoneme diagnoses for Gulf/Egyptian/Yemeni.

**`unverified` — dialect ASR is much worse than MSA ASR, and scale doesn't fix
it.** From Arab Voices (https://arxiv.org/pdf/2601.13319) and Casablanca
(https://arxiv.org/abs/2410.04527):
- Best system: ~10.19 WER on MSA vs ~34.8 Egyptian, ~28.77 Ta'izzi-Adeni Yemeni.
- Zero-shot whisper-large-v3 on spontaneous dialect averaged **69.49 WER**
  across eight dialects (59.11 Egyptian, 62.31 Emirati).
- **Dialect-relatedness beats data scale**: Whisper fine-tuned on MGB-2
  (1,200h MSA/dialect blend) was the *worst* model at 102.20 average WER — worse
  than emitting nothing — while whisper-egyptian, fine-tuned on a ~16-hour
  Egyptian set, was the best overall at 70.74.
- Code-switching is catastrophic: 90.89 WER, and forcing the decoder to a
  language made it worse (English 131.54, Arabic 103.57) than auto-detection.
- Datasets labelled "dialectal" are often substantially MSA — 24.5% of MGB-2
  utterances score above the ALDi threshold for *only little* dialectal content.
  Filter corpora by **measured** dialectness, not by dataset name.

**`unverified` — automatic audio-quality filtering is unsafe for Arabic.**
PESQ / SI-SDR (TorchAudio-SQUIM) do not track human quality judgments on Arabic
speech and penalize expressive or religious recordings listeners rate highly.

## 6. AI tutors: real, moderate, and thinly evidenced

Four independent syntheses agree on the direction and roughly on the size:

| Synthesis | Effect | Base |
|---|---|---|
| GenAI chatbots & SLA (2023+) | **g = 0.576** [0.385, 0.768] | 41 studies, 48 ES, 3,515 participants |
| Conversational chatbots | **g = 0.608** | 31 studies, 41 ES |
| Chatbot conversation practice | **g = 0.484** | 28 studies, 70 ES (RVE) |
| Mondly 6-week speaking study | between-group η² = 0.11 | quasi-experiment, n = 60 |

All `unverified`. Three caveats matter more than the point estimates:

- **The largest chatbot effects came from 1–7 day interventions** — a novelty/
  duration confound. Nothing demonstrates these gains persist over months.
- The base is thin: the most comprehensive meta-analysis rests on 28 primary
  studies. Authors of two syntheses explicitly caution against blanket claims.
- What moderates the effect is **design** — modality, interface, interaction
  capability, accessibility, learner proficiency — not chatbot use per se.
- **Vocabulary is the objective with the strongest chatbot effect**, and effects
  were *larger* for target languages other than English, which is mildly good
  news for Arabic.

**`unverified`, and the most product-relevant result in this section — the
anxiety effect is bigger than the skill effect.** In the Mondly study, the AI
group's speaking-anxiety reduction was d = 0.76 (control d = 0.22), between-group
η² = 0.17, p = 0.007 — versus η² = 0.11 for speaking skill. The benefit was
strongly moderated by baseline anxiety: high-anxiety learners dropped 6.12 points
on the 19-item scale vs 3.21 (moderate) and 2.14 (low). Dosage was 540 minutes
over 6 weeks (three 30-minute sessions/week), *substituting for* self-study
rather than adding to it.

**`unverified` — an app can match a classroom for beginners.** In a 16-week
quasi-experiment (183 beginner French learners), Duolingo-only was statistically
indistinguishable from classroom-only on overall proficiency, grammar, vocabulary
and communicative competence. The blended condition won on exactly one measure:
**pragmatic competence** (the tu/vous formality distinction). Absolute gains were
modest for a full semester — ~9–10 C-test points, 13–16 additional unique word
types.
Source: https://www.cambridge.org/core/journals/studies-in-second-language-acquisition/article/comparing-the-effectiveness-of-duolingo-classroom-instruction-and-classroom-duolingo-instruction-conditions-on-beginnerlevel-french-language-development/68C0E7E296669798089C84CDC7F3BB9E

That study also hands us a **reusable outcome battery**: C-test proficiency,
picture-description productive vocabulary (types and tokens), an error-correction
grammar test, a pragmatics measure, and a multimedia discourse completion task.

**`unverified` — corrective feedback timing.** In L2 writing, synchronous
feedback given *while composing* outperformed asynchronous post-submission
feedback in both studies that compared them. The immediate advantage disappears
when explicit instruction precedes the treatment, under ceiling effects, or when
the target structure has low salience — consistent with the plateau review's
Nassif (2019) finding that **salience, not production, is the active ingredient**.

## 7. Diglossia and dialect ordering: an update, and a dissent

`docs/plateau-research-2026-09.md` §6 concluded that integration doesn't damage
MSA and that no study shows MSA-first producing better spoken outcomes. That
still stands, and Al-Batal's *Arabic as One Language* remains the anchor. Two
additions:

**`unverified` — the evidence base is even thinner than we said.** As of that
volume's publication (Dec 2017), essentially *no* empirical evidence existed on
the effectiveness of integrating dialect into the curriculum; the volume was
assembled specifically to supply it. A West Point longitudinal study tested the
standard objection (that teaching dialect degrades *written* proficiency)
empirically. Multiple long-running programs report outcomes, including 25 years
of BYU data, and beginner programs producing diglossic speaking "without mixing".

**`unverified` — and a genuine dissent worth recording.** A PRISMA review of 101
studies on Arabic diglossia (eight databases, grey literature, 1970–2021)
recommends **increasing Standard Arabic exposure early**, integrating simplified
MSA into early childhood education. That is a recommendation for *L1 Arabic
children's literacy*, not for adult L2 dialect learners, so it does not directly
contradict Hakiya's premise — but it is the largest synthesis in the area and it
points the other way, and the review's own authors note the literature is
disproportionately authored from outside the Arab world. Do not cite "the
research supports dialect-first" without this caveat.

## 8. Dialect-fidelity tooling

**`unverified` — AL-QASIDA gives us a better MSA-leak metric than we built.**
(https://arxiv.org/abs/2412.04193) Its **ADI2** score multiplies **ALDi** — a
continuous 0-to-1 MSA↔dialect scale — by dialect-identification confidence. That
is a reproducible, published metric where `_shared/msaLeakDetector.ts` is a
hand-rolled word-list heuristic. It confirms the repo's existing bet: LLM
weakness in dialect is *willingness*, not competence, and **few-shot
demonstrations raise dialect adherence across tasks, genres and dialects** —
exactly what `getDialectDemonstrations` does.

**Coverage warning:** AL-QASIDA's eight varieties are Kuwaiti, Saudi, Syrian,
Palestinian, Sudanese, Egyptian, Algerian and Moroccan. **Gulf is represented
only by Kuwaiti and Najdi Saudi; Yemeni is absent entirely.** Most models score
below a 20% ADI2 threshold even on well-served dialects. We cannot benchmark our
third dialect against it.

**Resource inventory for the three target dialects** (all `unverified`):

| Resource | What it gives Hakiya |
|---|---|
| **Casablanca** (48h, human-transcribed, 8 dialects incl. **Emirati** and **Yemeni**) | First annotated speech for previously zero-resource Emirati and Yemeni. Per-segment transcription, gender, dialect, code-switching. https://www.dlnlp.ai/speech/casablanca |
| **Arab Voices** | Unified access to 31 datasets / 14 dialects — Gulf (afb), Egyptian (arz), Yemeni Sanaani (ayn) and Ta'izzi-Adeni (acq) — with harmonized metadata |
| **MADAR** | 25-city parallel corpus incl. Doha/Riyadh/Muscat/Jeddah/Cairo/**Sana'a**; lexicon with CAPHI phonetic transcriptions |
| **AVP** | The only CEFR-aligned, dialect-aware Arabic word list (A1–A2) |
| **Fanar** (already integrated) | Arabic-centric 7B/9B models, dialect-supporting ASR, region-tuned TTS. Its SOTA claim names no benchmarks — verify against AL-QASIDA before trusting it |
| **QuranMB.v1** | First Arabic MDD benchmark — MSA/Qur'anic only, useful as a ceiling estimate, not as a dialect tool |

## 9. Claims that did not survive verification

Recorded rather than dropped, because two of them are ones we might otherwise
have acted on:

1. **"Optimal retention in FSRS is the output of a numerical optimization
   (Brent's method), so hardcoding 0.9 is not implementing FSRS's optimal
   retention"** — voted down 0-3. The optimizer exists; the framing that a fixed
   default is therefore *wrong* did not hold up. Our fixed 0.9 default is
   defensible.
2. **"Blocked practice facilitates initial encoding"** — 1-2.
3. **"A blocked-then-interleaved hybrid beats both pure schedules"** — 0-3. See
   §2: only the negative finding is usable.
4. **"Explicit instruction produces d = 1.07 within / d = 0.81 between across 28
   reports (N = 3,754)"** — 0-2. Two votes only, on a paywalled source, so this
   reads more like *inaccessible* than *false*. Treat explicit instruction's
   effect size as **unresolved**, not refuted; the moderator finding (that
   instruction type and paired practice modality both moderate the effect)
   remains `unverified`.

## 10. Gaps: searched explicitly, nothing found

1. **Frequency lists for spoken Gulf, Egyptian or Yemeni Arabic.** The AVP
   authors hit the same wall. Presence/absence via MDD and MADAR is the ceiling.
2. **Any dialectal-Arabic pronunciation-assessment benchmark.** QuranMB is MSA.
3. **Yemeni in any dialect-fidelity benchmark.** Absent from AL-QASIDA.
4. **CEFR-aligned dialect vocabulary above A2.** The AVP stops there.
5. **Long-run (multi-month) evidence for AI conversational tutors.** The
   strongest effects are 1–7 day interventions.
6. Everything already listed in `docs/plateau-research-2026-09.md` §7 — dialect-only
   acquisition, Gulf/Yemeni as L2 targets, dialect chunk inventories, dialectal
   shadowing, Arabic utterance-fluency norms — remains a gap.

---

# Part 2 — Comparison with what Hakiya implements

Verified by inspection of the codebase at `656283f`.

| Research finding | Hakiya today | Verdict |
|---|---|---|
| Per-user FSRS fitting > version bump (§1) | FSRS-5 with stock 19 weights; `useFsrsCalibration` applies a single heuristic multiplier from windowed retention | **Biggest gap.** Not fittable — no review log exists |
| Spacing beats massing; expansion no better than equal (§1) | FSRS expanding intervals, ±5% fuzz | Fine. No change needed |
| DR 0.99 costs 2.9× time for +4.9% cards (§1) | `DEFAULT_RETENTION = 0.9`, clamped [0.7, 0.97] | Well-chosen. Surface the trade-off in Settings |
| Don't build a cleverer scheduler (§1) | Doesn't | Correct call, now evidenced |
| Pure interleaving harms low achievers (§2) | `reviewOrder.ts` interleaves both decks from first exposure | **Gap** — beginners' first exposures should block |
| Viewing is the weakest input mode, 7%/5% (§3) | Video-first: Discover, Feed, WordClips, clip pipeline | **Reframe needed** — transcript-primary, video-as-carrier |
| Reading-while-listening is the only mode that improves on delay (§3) | Exists (transcripts + audio) but isn't the default vocabulary surface | Promote it |
| Narrative ≫ expository; beginners gain half as much (§3) | Stories, DailyStory, ReadingLibrary all narrative | Already right |
| Constrained text choice + accountability beat free reading (§3) | `comprehension.ts` bands at **≥0.9 comfortable / ≥0.7 stretch** | **Recalibrate** — 70% is below any comprehension threshold in the literature |
| Listening *strategy* instruction d = 0.69 (§3) | ListeningPractice = dictation \| comprehension \| speed. No strategy layer | Gap |
| MSA frequency ≠ dialect usefulness (§4) | **No frequency data anywhere** (zero hits for `frequency_rank`/zipf) | **Gap** |
| Retrieval gains driven by high-frequency words (§1) | New-card order is not frequency-ranked | Compounds the above |
| Don't elicit dialect from MSA (§4) | `convert-to-fusha`, `translate-story-dialect`, `fushaBridge` | **Audit needed** — check direction of elicitation |
| Explicit ASR feedback g = 0.86 vs indirect 0.50 (§5) | Azure per-phoneme detail exists in word/sentence modes | Make the feedback *name* the error |
| Segmental 0.82 ≫ suprasegmental 0.37 for ASR (§5) | Shadow mode deliberately avoids phoneme claims | Correct for shadowing; keep segmental in Azure modes |
| Nothing happens under 5 weeks (§5) | No retention mechanic tied to pronunciation streaks | Framing/retention issue |
| Arabic MDD precision 18.7% (§5) | `pronunciationScoringCore.ts` recalibrates and never exposes raw Azure | **Already right**, now strongly vindicated |
| Anxiety effect > skill effect for AI speaking (§6) | ConversationSimulator, free-chat, realtime voice all exist | Positioning opportunity, and an onboarding argument |
| Chatbot design moderates the effect, not use per se (§6) | `askBrain` + learner profile + dialect validation | Ahead of the field |
| Salience, not production, is the active ingredient (§6) | Coaches give `natural_rewrite` + salience notes | Already right |
| — | **`conversation-practice`, `free-chat` and realtime voice record zero `learner_errors`** | **Gap** — richest production source feeds nothing |
| ADI2/ALDi as a reproducible dialect metric (§8) | Hand-rolled `msaLeakDetector.ts` word lists | Worth adopting as a second signal |
| Few-shot demonstrations raise dialect adherence (§8) | `getDialectDemonstrations` in the cached prefix | **Already right** |
| Yemeni/Emirati speech resources now exist (§8) | Soniox/Munsit/Deepgram/Fanar, no in-domain fine-tune | Opportunity |
| Fine-tuning on 16h in-domain beat 1,200h MSA-blend (§5) | — | Strong argument for the training-data flywheel |
| Reusable outcome battery exists (§6) | LearningAnalytics shows XP, streak, accuracy, study minutes | **No proficiency measurement at all** |
| — | Placement runs once, never revisited | Gap (already known as product-audit C4) |
| — | `useTodayQueue` has **no speaking task** | Gap |

---

# Part 3 — Recommendations, in priority order

Priority = evidence strength × leverage × inverse cost. Each names the drift
guards it must clear (see `CLAUDE.md`).

## P0 — Log reviews. Everything else in the SRS stack is blocked on this.

`word_reviews` stores only current card state. Across 216 migrations there is no
review-event table. Consequence: we cannot fit FSRS parameters per learner
(§1 — worth more than two algorithm generations), cannot measure true retention
curves, cannot calibrate the monologue/shadowing thresholds the plateau plan
explicitly defers to "our own data", and cannot evaluate any change we make here.

**Build:** a `review_log` table — `user_id`, `card_id`, `deck`, `direction`,
`rating`, `state_before` (S, D, R), `elapsed_days`, `scheduled_days`,
`duration_ms`, `reviewed_at`. Owner-read RLS; written on the same path that
writes the schedule. Append-only, never updated.

**Cost:** one migration plus a write in the review mutation. **Do this first
regardless of what else is chosen** — it is cheap, and it is the only item whose
absence makes other work unmeasurable. Note it must be in place for *months*
before an optimizer has data, which is the argument for landing it now rather
than alongside the optimizer.

Guards: migration replay, regenerated types, emulator factory support.

## P1 — Fit FSRS parameters per learner, then consider FSRS-6

**Sequence matters and is counterintuitive.** Ship the log (P0) → wait for data
→ fit per-user weights → *then* consider the version bump. Bumping to FSRS-6/7
on stock weights buys less than fitting FSRS-5 (§1). Replace the single
`calibrationMultiplier` scalar with real weight fitting once ~1–2k reviews per
learner exist; keep the multiplier as the cold-start path, which is what it is
already good at.

When the bump does come, FSRS-6 is the right target: its 21 parameters include
the optimizable forgetting-curve flatness, and its revised same-day formula
extends exactly the reasoning that put this repo on FSRS-5.

## P2 — Put speaking in the daily loop, and lead with the anxiety benefit

`useTodayQueue` is entirely receptive plus flashcards and drills. Monologue,
shadowing and conversation are reachable only through the "speak" surface.
Meanwhile the largest measured effect of AI speaking practice is **anxiety
reduction (η² = 0.17), larger than the skill effect (η² = 0.11)**, concentrated
in the most anxious learners (§6).

- Add a `speaking` TodayTask rotating monologue / shadow reps / chunk-in-situation.
- Dose it from the evidence: **~30 minutes, 3×/week** is what produced the
  measured effects — and it *substituted for* other study rather than adding to
  it, so it should displace a receptive task, not stack on one.
- Position it in onboarding for anxious learners specifically. This is the
  clearest, best-evidenced product claim available: not "you'll learn faster"
  but "you'll stop dreading speaking".

Guards: `TodayTask` + route reachability; the surfaces already exist.

## P3 — Capture learner errors from open conversation

`recordLearnerErrorsForRequest` is called from `writing-coach`,
`practice-sentence-coach`, `score-monologue`, `practice-chunk-coach`,
`score-set-phrase-voice` and `score-shadow-attempt` — but **not** from
`conversation-practice`, `free-chat`, or the realtime voice session. The app's
richest source of authentic learner production feeds nothing into the
fossilization loop that `mistake-drill` and `/mistakes` exist to close.

Add a post-turn extraction pass on those three. Needs a `learner_errors.source`
CHECK migration (`conversation`, `voice`) — batch with any other source additions.

## P4 — Frequency- and dialect-commonality-ranked vocabulary

There is no frequency signal anywhere in the app, and retrieval-practice gains
are moderated by frequency (§1). MSA frequency is the wrong ranking (§4), and
dialect frequency lists don't exist (§10, gap 1) — so this has to be built, in
descending order of cost-effectiveness:

1. **Import the AVP** for A1–A2 ordering — it is free, CEFR-aligned, and already
   applies dialect-commonality and morphological-family criteria.
2. **Derive our own frequency counts** from what we already hold — `caption_lines`
   and reviewed `discover_videos.transcript_lines` are a real dialect corpus and
   the only source of genuine *dialect* frequency anywhere in this project.
3. **Cross-check commonality against MADAR** for multi-dialect usefulness.

Then rank new-card admission by it in `reviewOrder.ts`. This also feeds the
chunk-mining work the plateau plan deferred.

## P5 — Recalibrate comprehension bands and don't interleave beginners

Two small, evidence-driven corrections:

- `comprehension.ts:175-177` bands at ≥0.9 comfortable / ≥0.7 stretch. Nothing in
  the coverage literature supports 70% as a productive zone. Raise the stretch
  floor substantially and rename the bottom band so it reads as "too hard" rather
  than as a recommended challenge. Constrained, level-matched text choice
  outperforms free choice (§3) — the bands are the mechanism, so they should bind.
- `reviewOrder.ts` interleaves from first exposure. Block a card's first
  exposures, then interleave (§2). Only the negative finding is evidenced, so
  keep the change minimal: don't interleave *new* cards, leave mature scheduling
  alone.

## P6 — Make the transcript the primary object, not the video

Audiovisual viewing is the weakest input mode measured (7% immediate, **5%
delayed** — the only mode that decays), while reading-while-listening is the only
one that *improves* by delay (13% → 17%) (§3). Hakiya is video-first by
architecture.

This is a reframing, not a teardown — the app already pairs video with
transcripts, and that pairing *is* reading-while-listening. Make it the default:
transcript visible and central during playback rather than opt-in, with word
focus, and count transcript-read time rather than watch time. Keep video for
motivation and authenticity, which this literature doesn't measure.

Also worth noting for expectation-setting: **incidental input yields meaning
*recall* at only 9%** (§3). Input alone will not produce production. That is the
quantitative case for the deliberate output work the plateau plan already built.

## P7 — Make pronunciation feedback explicit, and be honest about its ceiling

- In the Azure word/sentence modes, **name the error** rather than showing a
  score or a mismatched transcript: explicit feedback g = 0.86 vs indirect 0.50
  (§5). Segmental is where ASR feedback works (0.82 vs 0.37 suprasegmental), and
  reference-matched reading is where phoneme claims are valid.
- Keep shadow mode on fluency/prosody/closeness. The two literatures point
  opposite ways because they are different interventions; §5 explains why both
  can be right.
- **Don't over-trust it.** Best-in-class Arabic mispronunciation detection runs
  at 18.7% precision (§5). `pronunciationScoringCore.ts`'s existing caution is
  now strongly vindicated — but a "5-week minimum before this helps" expectation
  belongs in the UI, given g = 0.07 for sub-5-week programs.

## P8 — Add perception training (currently absent entirely)

`ListeningPractice` offers dictation, comprehension and speed. Nothing anywhere
drills the contrasts that actually gate Arabic listening for L2 learners —
ع/ء, ح/ه, ق/ك, and emphatic-vs-plain (ص/س, ط/ت, ض/د). Every ingredient exists:
`WordClips`, native audio, per-dialect word lists, and MADAR's CAPHI phonetic
transcriptions as a source of contrast pairs (§4).

Evidence label, stated honestly: the ASR meta-analysis supports *segmental*
training generally (§5), but I did not verify a high-variability-phonetic-training
meta-analysis in this pass, so treat the specific HVPT design as a reasoned
inference rather than a verified prescription.

## P9 — Measure proficiency, not just activity

`LearningAnalytics` reports XP, streak, accuracy, mastered words and estimated
study minutes — all activity, no proficiency. Placement runs once and is never
revisited. The Duolingo SSLA study hands us a ready outcome battery (§6): C-test,
picture-description productive vocabulary, error correction, and a discourse
completion task for pragmatics.

Recurring placement plus even two of those instruments would let Hakiya answer
"is this working?" — which no app teaching a spoken Arabic dialect can currently
answer for itself (`plateau-research` §7, gap 7), and which is the precondition
for any efficacy claim in marketing.

## P10 — Dialect fidelity: adopt ADI2, and mind the Yemeni hole

- Add **ALDi/ADI2** (§8) as a second, reproducible signal alongside
  `msaLeakDetector.ts`'s word lists, and log both. A published continuous metric
  is a better gate than a hand-maintained list, and it makes
  `scripts/eval-dialect-live.ts` comparable to outside work.
- **Yemeni is absent from AL-QASIDA entirely**, and Gulf appears only as Kuwaiti
  and Najdi. We cannot benchmark two of our three dialects against the standard
  suite. Our own golden set stays the only instrument for Yemeni — worth saying
  out loud in `docs/testing.md`.
- **Casablanca and Arab Voices** now provide annotated Emirati and Yemeni speech
  where there was none. Given that a 16-hour in-domain fine-tune beat a 1,200-hour
  MSA-heavy one (§5), this is the strongest available argument for the
  training-data flywheel in `docs/improvement-plan-2026-08.md`.
- **Audit MSA-sourced elicitation.** MADAR's authors found that translating from
  MSA measurably biases output toward MSA (§4). `convert-to-fusha`,
  `translate-story-dialect` and `fushaBridge` should be checked for which
  direction they elicit in.

## Sequencing

```
P0 (review log) ──► P1 (per-user FSRS fitting) ──► FSRS-6 bump
P2 (speaking in daily loop) ──► P3 (error capture from conversation)
P4 (frequency ranking) ──► P5 (bands + beginner blocking) ──► chunk mining
P6, P7, P8 — independent
P9 (outcome measurement) — gates any efficacy claim
P10 — independent, cheap
```

**If only one thing ships: P0.** It is a single migration, it unblocks the
highest-value SRS work, and it needs months of accumulated data before it pays —
so every week it is not shipped is a week added to when P1 can happen.
