# Proposal: a quiz alternative to flashcards

*October 2026. Status: **proposal**, not yet agreed. §6 lists the open
questions, each with a recommended default; the rest of the document is what
the work looks like under those defaults. Nothing here is built.*

The ask: some learners will not do flashcards. Give them a settings choice —
flashcards as they are today, or being quizzed in other ways (fill in the
blank first) that get progressively harder, still on spaced repetition, with
some game to it. The flashcard setup must stay available, and a learner may
want both at hand.

---

## 1. What already exists

The inventory matters because it decides the shape: most of a quiz mode is
already in the tree, unused or used in one place.

- **Three quiz cards are built and tested.** `ReviewClozeCard`
  (`src/components/review/`) blanks the word out of a sentence, plays the
  sentence with the word cut out, and offers four Arabic options. My Words
  review already renders it on every even card and on every leech, but the
  learner still self-rates afterwards (a miss only caps the rating at Hard).
  `ReviewQuizCard` (picture → pick the Arabic) and `ReviewImageQuizCard`
  (audio → pick the picture) are imported by nothing but their tests.
- **Two features already turn an answer into an FSRS grade without a
  self-rating.** The lesson quiz (`Learn.tsx`) and the video debrief
  (`useDebriefWordReview`) both submit `correct ? "good" : "again"`;
  `quizRating` in `src/lib/videoDebrief.ts` carries the rule and its reason —
  never "easy" when the options were on screen.
- **Every deck keeps two schedules.** `word_reviews`, `user_vocabulary` and
  `user_set_phrases` carry recognition *and* `production_*` FSRS columns;
  production unlocks on a confident recognition grade (`buildReviewUpdate`,
  `src/hooks/useReview.ts`). "Progressively harder" has a home: the ladder
  can be read off the card's memory state rather than off a session counter.
- **A seeded distractor picker exists** —
  `buildWordQuiz` in `supabase/functions/_shared/videoDebriefCore.ts`, already
  imported by the client, de-duplicating meanings and falling back to recall
  when fewer than two distractors exist. Every quiz component re-rolls its own
  Fisher–Yates; there is no shared helper in `src/lib` yet.
- **Sentences are there but not loaded.** About 838 of ~949 authored track
  words carry `example_arabic` / `example_english` /
  `example_transliteration` on `vocabulary_words`, and `useDueWords` selects
  none of those columns. My Words carries `sentence_text` / `sentence_english`
  / `sentence_audio_url` from the context the word was saved in, and
  `useTranscriptCloze` mines a learner's saved transcripts for a line.
- **Answer matching helpers exist.** `normalizeArabicWord`, `sentenceHasWord`
  and `findWordSpan` (`src/lib/arabicWord.ts`); `gradeDictation`
  (`src/lib/dictation.ts`) scores a typed line word by word.
- **Gamification is thin and uneven.** `REVIEW_XP` is a flat 15 per card and
  is paid only by curriculum review and the lesson quiz; My Words and My
  Phrases pay nothing. XP goes through the `award_xp` RPC (clamped server-side),
  achievements through `grant_achievement`, celebrations through
  `celebrate()` (`src/lib/celebrations.ts`, with `SparkleBurst` and the dances).
  `review_streaks` has no writer in the repo.
- **Review preferences are device-local.** Whole-curriculum scope, leeches,
  songs and root families all follow the same localStorage pattern
  (`src/lib/curriculumDeck.ts` + `useCurriculumDeckScope`): `load`, `save` with
  a change event, `subscribe`, and a twenty-line hook. `profiles` has no jsonb
  prefs column; a synced preference means a migration, which Lovable has to
  apply before `types.ts` carries it (see `CLAUDE.md`).
- **The session is one thing.** `/review` → `/review/my-words` →
  `/review/my-phrases` is one chained session (`useReviewSession`), ordered by
  `buildReviewOrder`, with new cards blocked for beginners
  (`BEGINNER_REVIEW_THRESHOLD = 200`). The daily task "Review N words" points
  at `/review`.

---

## 2. The setting

Settings → Review Preferences → **"How you review"**, a three-way choice:

| Value | What the learner gets |
|---|---|
| `flashcards` | Exactly today's cards: flip, then Again / Hard / Good / Easy. |
| `quiz` | Every card asked as a question from the ladder (§3); the app grades. |
| `mix` | Quiz questions where the card supports one, flashcards elsewhere. |

- Stored device-locally like the other review preferences (`src/lib/reviewStyle.ts`
  + `useReviewStyle`), default `flashcards` so nobody's habit changes on
  deploy. If it is later wanted across devices it becomes a `profiles` column;
  the hook's signature does not change.
- The same control sits in the review page header as a segmented switch, so a
  learner can flip for one session without visiting Settings. The header
  switch writes the same preference (there is no "session-only" state to
  explain).
- Under `flashcards`, My Words stops serving its even-card cloze — the whole
  point of the choice is that flashcards means flashcards. The cloze moves to
  `quiz` / `mix`, where it is a rung.

No new route: the quiz is a renderer choice inside the three existing review
pages, so the route manifest, reachability and Ask-AI guards are untouched.
The pages' `usePageAiContext` keep publishing the card with the answer hidden
until it is answered, as they do now.

---

## 3. The question ladder

A card's rung is chosen from its own memory state, not from where it falls in
the session. That keeps "progressively harder" inside spaced repetition: a
word climbs as its stability grows and drops when it lapses, and the ordering
and new-card rules in `buildReviewOrder` are untouched.

| Rung | When (recognition schedule unless stated) | Question | Grades |
|---|---|---|---|
| 0 Recognise | new, or stability under ~1 day (just lapsed) | Arabic + audio → pick the English (4) | recognition |
| 1 Hear it | stability 1–7 days | audio only → pick the picture, or pick the Arabic | recognition |
| 2 Fill the gap | stability 7–30 days and a sentence exists | sentence with the word blanked, sentence audio with the word cut → pick the Arabic (4) | recognition |
| 3 Build it | production unlocked, production stability under ~14 days | English (or picture) → assemble the Arabic from a letter bank | production |
| 4 Produce it | production stability 14+ days | English → type or speak the Arabic, no options | production |
| 5 Use it | recognition stability 30+ days and production mature | sentence with the word blanked, no options: type it; or "which sentence uses it right" | both |

Fallbacks, so the ladder never blocks a review:

- No sentence for a rung-2/5 card → rung 1 (audio) or rung 0.
- No image → the Arabic-option variant of rung 1.
- No audio file → Azure TTS, as the pages already do.
- No material at all → a flashcard, with the ordinary rating buttons (this is
  what `mix` means, and `quiz` degrades to it rather than skipping the card).

Thresholds are a first guess and live in one table (`src/lib/quizLadder.ts`,
pure and tested) so they can be tuned from `review_log` later. The
Arabic-script letter bank (rung 3) is the answer to "most learners have no
Arabic keyboard": a scramble of the word's letters plus two or three decoys,
which is a known and liked game shape and still a recall task.

Direction follows the rung: rungs 0–2 grade the recognition columns, 3–4 the
production columns, 5 both — the same `direction` plumbing the flashcards use.

---

## 4. Grading

The app grades in `quiz` and `mix`; the rating buttons do not appear on a quiz
card. The map:

| Outcome | Rating | Why |
|---|---|---|
| Right first time | `good` | Options on screen (rungs 0–2) never earn `easy` — the debrief's rule. |
| Right, no options, fast | `easy` | Rungs 4–5 only: a free recall answered within a few seconds is the one honest `easy`. |
| Right after a hint (first letter, sentence audio replayed) or a near miss (one letter, hamza / tā marbūṭa variant) | `hard` | Keeps the card close without calling it a lapse. |
| Wrong | `again` | Re-queued through `pushRelearn` seven cards later, at a lower rung. |

Every outcome still goes through the existing writers (`useReviewQueue` for
the curriculum deck, `useUpdateUserVocabularyReview` for My Words,
`useUpdateUserPhraseReview` for My Phrases), so offline queuing, leech
flagging, production unlock, the new-card budget and the `review_log` trigger
all behave exactly as for a flashcard. Speed affects XP (§5), never the FSRS
rating.

---

## 5. Making it fun

Game chrome rides on XP and celebration, and never on scheduling.

1. **Combo.** Consecutive correct answers build a multiplier on `REVIEW_XP`
   (1×, 1.5×, 2×, capped), shown as a small flame on the progress bar; a miss
   resets it with no penalty. `SparkleBurst` on each step up.
2. **Rung badge on the card.** A five-step mark (seed → sprout → leaf → tree →
   fruit, or Ink-brand equivalents) shows where the word is on the ladder.
   Answering right at the top of a rung shows "moves up next time"; the
   session summary counts promotions ("4 words climbed").
3. **Session summary.** Accuracy, best combo, words promoted, words that
   dropped, and a "practice the misses now" button (which re-serves the
   misses as flashcards, no FSRS write — a second look, not a second grade).
4. **Lightning round.** Optional 60-second round after the session over
   cards answered right today — rung 0/1 questions, score and time only,
   nothing written to the schedule. Reuses the `VocabBattles` question shape
   and could seed a battle challenge from the same set.
5. **Boss card.** The leech with the most lapses opens the session at rung 0
   with its mnemonic and image, framed as the day's boss; clearing it is a
   celebration tier.
6. **Why-not.** On a wrong multiple-choice pick, one tap on the chosen
   distractor asks the tutor (existing `AskAISentence`) why that word does not
   fit — the feedback the research says retrieval needs.
7. **XP parity.** My Words and My Phrases start paying the same flat
   `REVIEW_XP` as the curriculum deck, in both modes; today they pay nothing,
   which reads as an oversight rather than a decision.

Copy stays honest: no "learn faster", no streak pressure on the card itself.

---

## 6. Open questions (with recommended defaults)

1. **Which decks?** Default: curriculum and My Words in the first cut (both
   have sentences, images and audio); My Phrases is production-only and gets
   rungs 3–4 only, later.
2. **Where does the preference live?** Default: device-local, like the other
   Review Preferences, with the header switch. A synced `profiles` column
   means a migration Lovable must apply; do it only if learners ask.
3. **Who grades a quiz card?** Default: the app, per §4; no rating buttons on
   a quiz card. The alternative — quiz then self-rate, as My Words' cloze does
   today — keeps the flashcard burden the mode exists to remove.
4. **What drives difficulty?** Default: the card's memory state (§3). The
   alternative, a session that gets harder as it goes, feels more like a game
   level but asks a weak card a hard question; the combo and lightning round
   carry that feeling instead.
5. **Typing Arabic.** Default: letter bank at rung 3; free typing *or*
   speaking at rung 4 (the pronunciation path exists). Transliteration input
   is not accepted as Arabic.
6. **How much game?** Default for the first cut: combo, rung badge and session
   summary (items 1–3). Lightning round, boss card and why-not follow.
7. **Mode name.** "Flashcards / Quiz / Mix" in Settings; the header switch
   says "Flip" and "Quiz".
8. **Keep My Words' current cloze under Flashcards?** Default: no, it moves
   to Quiz; Flashcards means plain cards.

---

## 7. Phasing and the guards each phase meets

**Phase 1 — the choice and the recognition rungs.**
`src/lib/reviewStyle.ts` + `useReviewStyle` + Settings row + header switch;
`src/lib/quizLadder.ts` (rung from memory state, pure); `src/lib/quizGrading.ts`
(outcome → rating, pure); `useDueWords` selects the example columns; a
`QuizCardFrame` in `src/components/review/` that picks `QuizCard`-style
English options, `ReviewImageQuizCard`, `ReviewQuizCard` or `ReviewClozeCard`
by rung, with a shared seeded distractor helper lifted from `buildWordQuiz`;
`Review.tsx` and `MyWordsReview.tsx` branch on the style; combo + summary.
Guards: `libCoverage` / `hookCoverage` (co-located tests), the component
thresholds, `settings.spec.ts` for the row, `review.spec.ts` and
`my-words.spec.ts` for a quiz session end to end, `reviewUpdate.test.ts`
unchanged (the writers are unchanged).

**Phase 2 — production rungs.** Letter bank (rung 3), typed/spoken rung 4,
rung 5 cloze without options; near-miss grading via `normalizeArabicWord`;
My Phrases joins. Guards: the same, plus `useReviewKeyboard` keeps the number
keys harmless on a quiz card.

**Phase 3 — the rest of the game.** Lightning round, boss card, why-not, a
"ladder climbs this week" stat beside XP on the leaderboard.

Out of scope on purpose: a cleverer scheduler (the research review's
conclusion stands — FSRS with fitted weights is the ceiling worth reaching),
model-generated questions in the hot path (every rung above is built from
data already on the card), and a separate quiz route.
