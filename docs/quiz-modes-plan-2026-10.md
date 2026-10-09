# The quiz alternative to flashcards

*October 2026. Phase 1 is built (§7); the owner's decisions are recorded in
§6 and the phases still to come are designed in §8. The README section
"Reviewing as a quiz instead of flashcards" is the writeup of what ships;
this document is the design around it, and `docs/quiz-phases-2026-10.md` is
the execution roadmap — the phase list with what each needs and what done
means.*

The ask: some learners will not do flashcards. Give them a settings choice —
flashcards as they are today, or being quizzed in other ways (fill in the
blank first) that get progressively harder, still on spaced repetition, with
some game to it. The first time a learner meets a word they have saved it is
easy, a gap in a sentence; the second time much the same; then they have to
produce it themselves and say it, graded on pronunciation; later it turns up
in a short dialogue or a little animation they must put the word to, and
eventually in sentences and stories. The sentence the word was learnt in is
always available. Assets made along the way (an animation of "jump") are
kept so nobody pays to make them twice. Everything stays on brand.

---

## 1. What already existed

The inventory decided the shape: most of a quiz mode was already in the tree,
unused or used in one place.

- **Three quiz cards were built and tested.** `ReviewClozeCard` blanks the
  word out of a sentence, plays the sentence with the word cut out, and offers
  four Arabic options; My Words review rendered it on every even card, with the
  learner still self-rating afterwards. `ReviewQuizCard` (picture → Arabic)
  and `ReviewImageQuizCard` (audio → picture) were imported by nothing but
  their tests.
- **Two features already turned an answer into an FSRS grade without a
  self-rating.** The lesson quiz and the video debrief both submit
  `correct ? "good" : "again"`; `quizRating` in `src/lib/videoDebrief.ts`
  carries the rule and its reason — never "easy" when the options were on
  screen.
- **Every deck keeps two schedules.** `word_reviews`, `user_vocabulary` and
  `user_set_phrases` carry recognition *and* `production_*` FSRS columns, and
  production unlocks on a confident recognition grade. "Progressively harder"
  had a home: the ladder reads off the card's memory state.
- **Sentences were there but not loaded.** About 838 of ~949 authored track
  words carry `example_arabic` / `example_english` on `vocabulary_words`, and
  `useDueWords` selected none of them. My Words carries the sentence a word was
  saved from, and `useTranscriptCloze` mines a learner's saved transcripts.
- **Speech scoring existed.** `azure-pronunciation` returns a calibrated score
  and what it recognised; `PronunciationButton` recorded a take inline.
- **Gamification was thin and uneven.** `REVIEW_XP` was paid only by the
  curriculum deck and the lesson quiz; My Words and My Phrases paid nothing.

---

## 2. The setting

Settings → Review Preferences → **How you review**: Flashcards or Quiz. The
same switch sits in every review page's header, so a learner who finds the
flip card is not what they want today changes it there, and the change *is*
the setting.

- On the profile (`profiles.review_style`, migration
  `20261009120000_profile_review_style.sql`) so it follows the learner across
  devices, with a device-local cache under it (`src/lib/reviewStyle.ts`,
  `useReviewStyle`) read in state initialisers so no page flashes the wrong
  style while the profile loads. The profile wins when it has an answer; null
  never overrides the device.
- Until the migration is applied to the live project (CLAUDE.md on migrations
  and `types.ts`), the cache is the whole preference: the profile write fails
  quietly and the device keeps its own answer. The `typesDrift` entry names
  the migration; delete it once a types regeneration carries the column.
- Flashcards is the default, so nobody's habit changes on deploy. Under
  Flashcards, My Words serves plain flip cards: the every-other-card cloze it
  used to show lives in the quiz now, because the whole point of the choice is
  that flashcards means flashcards.

---

## 3. The ladder

`src/lib/quizLadder.ts`. The question a card is asked is a function of its
memory state on the schedule the deck served it on, never of where it falls
in the session, so a word climbs as its stability grows, drops when it
lapses, and the ordering and new-card rules in `buildReviewOrder` are untouched.

| step | when (recognition stability unless stated) | question | grades |
|---|---|---|---|
| 1 First look | new, or under a day (just lapsed) | sentence gap, four Arabic options, the meaning shown as a hint | recognition |
| 2 Fill the gap | under 4 days | the same gap, no hint | recognition |
| 3 Pick the picture | under 8 days | the word, seen and heard → four pictures | recognition |
| 4 Hear it | under 16 days | audio alone → pick the meaning | recognition |
| 5 Pick the word | under 30 days | the picture (or meaning) → four Arabic words with their recordings | recognition |
| 6 Answer the line | 30 days and up | a line of the lesson's dialogue → pick the reply that uses the word | recognition |
| 7 Say it | production card, under 14 days | the picture alone (or the meaning) → say the word; scored | production |
| 8 Say the line | production card, 14 days and up | the English line → say the Arabic sentence; scored | production |

The climb within recognition goes from form to meaning (gap, picture, audio)
to meaning to form (pick the word) to use (answer the line); production goes
from the word to the line. The reply step is built from the lesson's authored
dialogue (`src/lib/quizDialogue.ts`), not generated: the reply is the first
line that uses the word, the prompt the line before it, the wrong replies the
dialogue's other lines topped up from the deck's other lessons.

Fallbacks, so the ladder never blocks a review: no sentence → ask the meaning
(the word shown on a first look, heard afterwards); no picture or too few
other pictures → hear it; no dialogue → pick the word; too few other words for
four options → the flip card; a device that cannot record → the flip card for
production cards, never a choice question, because the rating lands on the
production schedule. A saved phrase keeps one schedule, so its direction is
read off its stability: under 8 days it is asked for its meaning, from 8 days
it is asked to be said.

The decks unlock production on the first Good and serve the production card
the moment it is due — for the flashcards, on the refetch after the last card
of the same session. The quiz holds it until recognition stability reaches
the picture step (`holdsProduction`), so "say it" is the third encounter or
so; the production schedule is untouched, the card waits.

The thresholds are a first guess and live in `LADDER_THRESHOLDS` so they can
be tuned from `review_log` once the quiz has history.

Nothing is typed. Most learners have no Arabic keyboard, and saying the word
is the skill: the speaking steps record a take (`useTakeRecorder`) and score
it with `azure-pronunciation` against the target, showing what was recognised
beside the calibrated score. The sentence a word was met in is always a tap
away, with the word cut out on a speaking step; opening it before a choice
answer counts as help.

---

## 4. Grading

`src/lib/quizGrading.ts`. The app grades; the rating buttons do not appear on
a quiz card.

| outcome | rating | why |
|---|---|---|
| right choice | Good | options on screen never earn Easy — the debrief's rule |
| right choice, with help | Hard | keeps the card close without calling it a lapse |
| wrong choice | Again | relearn re-queues it a few cards later, a step down |
| spoken, score ≥ 85 / 70 / 55 | Easy / Good / Hard | the calibrated score, banded |
| spoken, a different word | Again | the assessment scores sounds against the reference even when the wrong word was said; the transcript is what says so |

Every rating goes down the page's existing path — the offline queue on the
curriculum deck, `useUpdateUserVocabularyReview` and
`useUpdateUserPhraseReview` on the personal decks — so relearn, leeches,
production unlock, the new-card budget and the `review_log` trigger behave
exactly as for a flashcard. `QuizCardFrame` is the one place the ladder, the
cards and the grading meet; the pages hand it a card and get a rating back.

---

## 5. The game

All of it rides on XP and celebration, never on scheduling.

- **Combo.** Consecutive right answers; a miss resets it and costs nothing.
  Milestones at 5, 10 and 20 pay 10, 25 and 50 XP once (`COMBO_MILESTONES`),
  small next to the flat 15 XP a card pays.
- **Step badge.** Five dots and the step's name on every quiz card, with the
  combo beside it from two up.
- **Session summary.** On the deck's end screen: accuracy, best run, words
  that climbed a step, words that dropped.
- **XP parity.** A graded answer on My Words or My Phrases pays the flat
  review XP and bumps the weekly review count, which those decks' flip cards
  never did.

Later (§8): the lightning round, the boss card, "why not this one?".

---

## 6. Decisions

Asked on 2026-10-09; the owner's answers, as built.

1. **Decks:** the curriculum (the words a learner has studied, which is what
   reaches the deck) and My Words; My Phrases joins in the same format.
2. **Where the preference lives:** on the profile, synced across devices.
3. **Who grades:** flashcards keep their buttons; a quiz card is graded by the
   app.
4. **Difficulty:** from the card's memory state.
5. **Typing:** none. Speaking only, scored by the speech path.
6. **How much game in the first cut:** combo, step badge, session summary.
7. **Saved phrases:** included, in the same format.
8. **My Words' old cloze under Flashcards:** moved into the quiz; Flashcards
   means plain cards.

---

## 7. Phase 1 — built

- `src/lib/reviewStyle.ts`, `useReviewStyle`, the migration and its
  `typesDrift` entry; the Settings row; `ReviewStyleSwitch` in the three
  review pages' headers.
- `src/lib/quizLadder.ts`, `quizGrading.ts`, `quizSession.ts`,
  `quizDistractors.ts` (seeded, de-duplicated options), each tested.
- `QuizChoiceCard` (meaning / listen), `QuizSpeakCard` (word / line) over
  `useTakeRecorder`, `QuizCardFrame`, `QuizRungBadge`, `QuizSessionSummary`;
  a `hintEnglish` prop on `ReviewClozeCard`.
- `useQuizPool`: wrong options drawn from the wider deck (the dialect's
  curriculum, everything the learner saved) so a session of two cards still
  gets four options; read only while the quiz is on.
- `useDueWords` selects the example sentence and transliteration; My Words
  selects the transliteration it was hard-coding to null.
- `Review.tsx`, `MyWordsReview.tsx`, `MyPhrasesReview.tsx` branch on the
  style; the rating keys are off on a quiz card and the frame takes Enter and
  Space to move on.
- Playwright: the quiz on `/review` and `/review/my-words`, the header
  switch, the Settings row.

---

## 8. What comes next

### Phase 2 — the asset store

Every picture, animation, sentence recording or line of dialogue made for a
word should be made once. Today curriculum images and audio are shared on
`vocabulary_words`, but a My Words image or jingle is generated per learner
and stored on their own row, so two learners who save "jump" pay twice.

- **Table `word_assets`** (service-role writes, public read):
  `id`, `concept_key text` (the normalised Arabic plus the dialect for
  dialect-bound assets, or the English concept for language-neutral ones
  such as an animation of jumping), `kind text` (`image`, `animation`,
  `sentence_audio`, `dialogue`, `story_line`), `dialect text null`,
  `url text`, `meta jsonb` (prompt, model, style version, duration),
  `source text` (`generated` / `authored` / `reviewed`), `approved_at`,
  `created_at`; unique on `(concept_key, kind, dialect, style_version)`.
- **One edge function, `word-asset`**, with `get` (look up by key and kind)
  and `ensure` (look up, else generate under the current style version and
  store). Every generator that makes a per-word asset — the My Words image
  dialog, `persist-word-audio`, the jingle functions when a word is shared —
  calls `ensure` first and only generates on a miss. Writes are service-role
  so a learner cannot plant an asset under a shared key.
- **On brand.** Generation goes through the Brain's image lineup
  (`IMAGE_MODEL_IDS`) with the Ink style prompt the illustration script in
  `scripts/` already carries, and `style_version` is part of the key so a
  brand refresh regenerates rather than mixes.
- **Guards:** a `_test/` file for the function, a `sharedModuleCoverage`
  entry for any new shared module, a `typesDrift` entry until the migration
  is applied.

### Phase 3 — the upper steps

Built on the asset store, each one an extra format the frame can render and
the ladder can place above step 8:

- **Act it out.** For a verb or an action noun, the animation of the concept
  (made once, shared) replaces the picture as the "say it" prompt: the
  learner says the word for what they see. `kind: "animation"`, keyed on the
  English concept, so every dialect's "jump" shares one.
- **Say the reply.** The spoken form of step 6: the line plays, the learner
  says the reply rather than picking it, scored against it with the word
  required. For words whose lesson has no usable dialogue, a two-line
  exchange the Brain writes in the dialect (`kind: "dialogue"`, keyed on the
  word and dialect, run through `askBrain` with the native validator and
  stored once) supplies both this and step 6.
- **In a story.** The word in a short passage from the reading library or a
  generated one (`kind: "story_line"`): a gap to say, or a comprehension
  question about the line, graded like the others.
- **Pictures for every word.** Step 3 and the picture prompts of steps 5 and 7
  only fire for words that have a picture, and the authored tracks ship
  without them; the asset store's `ensure` for `kind: "image"` is what fills
  that in, on brand, once per word.

Each new format is a `QuizFormat` value, a rung in `rungForMemory`, a card
component, and a row in the README table. The frame and the grading do not
change.

### Also later

- **Lightning round** after the session over today's right answers: score
  and time only, nothing written to a schedule.
- **Boss card:** the leech with the most lapses opens the session at step 1
  with its mnemonic and picture.
- **"Why not this one?"** on a wrong choice, through the existing
  `AskAISentence`.
- **Tune the thresholds** in `LADDER_THRESHOLDS` from `review_log` once the
  quiz has a few weeks of ratings.

Out of scope on purpose: a cleverer scheduler (FSRS with fitted weights is the
ceiling worth reaching), model-generated questions in the hot path (every step
is built from data already on the card or an asset made once), and a separate
quiz route.
