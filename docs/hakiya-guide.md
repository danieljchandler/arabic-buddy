# Hakiya — The Complete Guide

*A single reference for the whole product: how it teaches, what it does, what it
is built from, how content gets checked, and how it is positioned.*

**Last inventoried:** 5 September 2026, against the `main` branch.
**Scale at that date:** 122 routes · 110 screens · 117 backend functions ·
119 database tables · 229 database migrations · 547 automated test files ·
~286,000 lines of TypeScript.

This document has three parts:

- **[Part One](#part-one--the-plain-english-guide)** is written for anyone —
  no app-building or language-teaching background assumed. Read this if you
  want to understand what Hakiya is and why it works the way it does.
- **[Part Two](#part-two--technical-reference)** is the engineering reference.
  It lives in the repo so the details survive; most readers can skip it.
- **[Part Three](#part-three--marketing-portfolio)** is the brand and marketing
  pack: voice, colours, features-to-benefits, personas, and ready-to-use copy.

---

## Table of contents

### [Part One — The plain-English guide](#part-one--the-plain-english-guide)

1. [Hakiya in one page](#1-hakiya-in-one-page)
2. [The methodology](#2-the-methodology)
   - [2.1 Spoken dialect, never textbook Arabic](#21-spoken-dialect-never-textbook-arabic)
   - [2.2 Real media is the raw material](#22-real-media-is-the-raw-material)
   - [2.3 Evidence-led, including when the evidence says no](#23-evidence-led-including-when-the-evidence-says-no)
   - [2.4 The app knows what you know](#24-the-app-knows-what-you-know)
   - [2.5 Native speakers check the machine](#25-native-speakers-check-the-machine)
   - [2.6 Honest numbers](#26-honest-numbers)
   - [2.7 The daily loop](#27-the-daily-loop)
3. [Every feature, and how it works](#3-every-feature-and-how-it-works)
   - [3.1 Getting in: invite, sign-up, onboarding, placement](#31-getting-in-invite-sign-up-onboarding-placement)
   - [3.2 The home feed and the daily plan](#32-the-home-feed-and-the-daily-plan)
   - [3.3 Listen](#33-listen)
   - [3.4 Read](#34-read)
   - [3.5 Speak](#35-speak)
   - [3.6 Write](#36-write)
   - [3.7 Vocabulary and memory](#37-vocabulary-and-memory)
   - [3.8 Set phrases (chunks)](#38-set-phrases-chunks)
   - [3.9 Grammar](#39-grammar)
   - [3.10 The Ask AI tutor](#310-the-ask-ai-tutor)
   - [3.11 Bring your own material](#311-bring-your-own-material)
   - [3.12 The two structured paths](#312-the-two-structured-paths)
   - [3.13 The MSA bridge and the Fusha row](#313-the-msa-bridge-and-the-fusha-row)
   - [3.14 Your mistakes, and drilling them out](#314-your-mistakes-and-drilling-them-out)
   - [3.15 Progress, analytics and gamification](#315-progress-analytics-and-gamification)
   - [3.16 Social features](#316-social-features)
   - [3.17 The Bible track](#317-the-bible-track)
   - [3.18 Settings, offline use and notifications](#318-settings-offline-use-and-notifications)
   - [3.19 The staff side](#319-the-staff-side)
   - [3.20 Plans and billing](#320-plans-and-billing)
4. [The tools we use, and why](#4-the-tools-we-use-and-why)
   - [4.1 The app itself](#41-the-app-itself)
   - [4.2 The backend](#42-the-backend)
   - [4.3 The AI models](#43-the-ai-models)
   - [4.4 Hearing: speech recognition](#44-hearing-speech-recognition)
   - [4.5 Speaking: text to speech](#45-speaking-text-to-speech)
   - [4.6 Arabic-specific tools](#46-arabic-specific-tools)
   - [4.7 Content sourcing](#47-content-sourcing)
   - [4.8 Money, analytics, hosting](#48-money-analytics-hosting)
   - [4.9 What we deliberately do not use](#49-what-we-deliberately-do-not-use)
5. [The transcription pipeline](#5-the-transcription-pipeline)
6. [The check process](#6-the-check-process)
   - [6.1 Checks the AI runs on itself](#61-checks-the-ai-runs-on-itself)
   - [6.2 Checks people run](#62-checks-people-run)
   - [6.3 Checks on the code](#63-checks-on-the-code)
   - [6.4 Checks on the live site](#64-checks-on-the-live-site)
   - [6.5 What is watched after release](#65-what-is-watched-after-release)

### [Part Two — Technical reference](#part-two--technical-reference)

7. [Architecture at a glance](#7-architecture-at-a-glance)
8. [Repository layout](#8-repository-layout)
9. [Frontend reference](#9-frontend-reference)
10. [Data model](#10-data-model)
11. [Edge function catalogue](#11-edge-function-catalogue)
12. [AI orchestration internals](#12-ai-orchestration-internals)
13. [The transcription pipeline in detail](#13-the-transcription-pipeline-in-detail)
14. [Scheduling: FSRS-6](#14-scheduling-fsrs-6)
15. [Access control and roles](#15-access-control-and-roles)
16. [Spend, caps and abuse controls](#16-spend-caps-and-abuse-controls)
17. [Testing and CI reference](#17-testing-and-ci-reference)
18. [Configuration and secrets](#18-configuration-and-secrets)
19. [Known gaps and pinned baselines](#19-known-gaps-and-pinned-baselines)
20. [Operational runbooks](#20-operational-runbooks)

### [Part Three — Marketing portfolio](#part-three--marketing-portfolio)

21. [Brand foundations](#21-brand-foundations)
22. [Brand voice](#22-brand-voice)
23. [Visual identity](#23-visual-identity)
24. [The product story](#24-the-product-story)
25. [Features to benefits](#25-features-to-benefits)
26. [Who it is for](#26-who-it-is-for)
27. [Why an Arabic learner chooses Hakiya](#27-why-an-arabic-learner-chooses-hakiya)
28. [Competitive positioning](#28-competitive-positioning)
29. [Pricing and the offer](#29-pricing-and-the-offer)
30. [Proof points](#30-proof-points)
31. [Ready-to-use copy](#31-ready-to-use-copy)
32. [Claims to avoid](#32-claims-to-avoid)

### [Recommendations](#recommendations)

33. [What I would add](#33-what-i-would-add)

---
---

# Part One — The plain-English guide

## 1. Hakiya in one page

**Hakiya** (from حكاية — *a story*) is a web app for learning **spoken Arabic**:
the Arabic people actually talk in, rather than the formal written Arabic
taught in most courses. It covers three dialects — **Gulf (Khaliji)**,
**Egyptian**, and **Yemeni** — and everything in it is built around one
principle: if a native speaker of that dialect would not say it, it does not
ship.

Practically, that means:

- You watch and listen to **real clips** — TikToks, YouTube videos, podcasts,
  news — spoken by real people, not studio actors reading a script.
- Every clip has been through a **transcription pipeline** that runs six
  separate speech-recognition engines over the audio, has AI models argue about
  the result, and then puts it in front of a **paid native speaker** to correct.
- Words and phrases you save go into a **flashcard system** that schedules them
  using the same memory algorithm Anki uses (FSRS-6), so you review each item
  at the moment you are about to forget it.
- An **AI tutor** sits on every screen. It can see the page you are on, the
  whole document you are inside, where you are in it, what words you know, and
  what you have been getting wrong. You can talk to it by voice or by text.
- The app watches for **Modern Standard Arabic leaking into the output** and
  repairs it, because that is the single failure mode that would make the whole
  product pointless.

It is a web app that installs on a phone like a native app, works partly
offline, and is currently in **closed beta** (sign-up needs an invite code).

**Why the name.** حكاية means "a story". The old working name was *Lahja*
(لهجة — "dialect"), which is still visible inside the code in a few internal
names. Hakiya is the name that ships.

---

## 2. The methodology

### 2.1 Spoken dialect, never textbook Arabic

Arabic has a split personality. There is **Modern Standard Arabic** (MSA, or
فصحى / *fusha*) — the written, formal, news-broadcast language — and there are
the **dialects** people actually speak at home, in shops and on the phone. They
differ enough that a learner who has done three years of MSA can land in Kuwait
and understand almost nothing of an ordinary conversation.

Almost every Arabic course teaches MSA. Hakiya teaches the dialects. That
decision drives more of the engineering than anything else, for a specific
reason: **AI language models are biased toward MSA.** Ask a model for Gulf
Arabic and it will drift back toward formal Arabic, not because it cannot do
the dialect but because it has been trained to be "correct" and formal. The
research literature calls this out directly (AL-QASIDA, arXiv:2412.04193) and
finds that the fix is *demonstration* rather than *instruction* — showing the
model worked examples of the dialect works where telling it "use dialect" does
not.

So the app has three layers of defence against MSA:

1. **Worked examples in every prompt.** Each dialect carries a set of
   demonstration sentences that ride along with every AI request. These are the
   cheap, front-line fix.
2. **An MSA leak detector.** After the AI answers, its Arabic is scanned
   against a list of words that are unambiguously formal-only for that dialect
   (الآن, لماذا, هذا, سوف, ليس, الذي…). The scan normalises spelling first, so
   variant spellings still match.
3. **A repair pass.** If a leak is found, the answer goes back to the model
   with the specific offending words named, and is rewritten.

On top of that, an optional **native-speaker validator** scores the output 1–5
for authenticity using a strong model, with an Arabic-native model as a second
opinion and Fanar (Qatar's sovereign Arabic model) as a tie-breaker when they
disagree.

The rules those checks use are not hardcoded — they live in a **Dialect
Rulebook** in the database that content staff edit and approve, with drafts,
approvals and retirements. Adding a rule about Yemeni negation updates every
generator in the app within five minutes.

### 2.2 Real media is the raw material

Most language apps write their own content. Hakiya mostly does not. Its core
library is **real Arabic media** — social clips, YouTube videos, podcasts,
news — that has been ingested, transcribed, translated, levelled, and checked.

This matters for a reason that is easy to state and hard to fake: authored
content sounds like authored content. Speed, overlap, filler words, the way
people trail off, the borrowings, the swallowed vowels — that is what makes
real Arabic hard, and it is exactly what a scripted lesson removes. A learner
who is fluent in textbook dialogue and lost in a WhatsApp voice note has been
taught the wrong thing.

Where the app *does* generate content (stories, news retellings, reading
passages, drills), it generates it **on top of** what the learner already
knows, and it runs through the same dialect checks as everything else.

### 2.3 Evidence-led, including when the evidence says no

The feature roadmap is grounded in a documented research pass over the
second-language-acquisition and spaced-repetition literature
(`docs/language-learning-research-2026-09.md`,
`docs/plateau-research-2026-09.md`). Claims are labelled by how well they are
verified — *confirmed*, *supported-but-nuanced*, *contested*, *unverified*,
*gap* — and several of them changed or blocked planned work.

The interesting part is what the evidence *stopped*:

- **Speaking practice was not marketed as an accelerator.** AI speaking
  practice has a solid, replicated effect on *speaking anxiety* (effect sizes
  0.39–0.76). Its effect on actual speaking skill compared to alternatives is
  weak to null. So the app's speaking copy promises practice and comfort, never
  speed — and speaking tasks *compete* for slots in the daily plan rather than
  being added on top, because the evidence is for speaking that substitutes for
  other study, not that stacks on it.
- **The scheduling algorithm was not upgraded first.** Running a newer
  algorithm on stock settings scores *worse* than an older algorithm fitted to
  the individual learner. So the priority was logging every review so weights
  can be fitted per learner later — not chasing a version number.
- **A fine-tuning corpus was dropped.** The Casablanca dialect corpus is
  licensed for non-commercial use only, which killed a planned fine-tune.
- **Sound-perception training was promoted.** Training the ear to *hear* the
  Arabic contrasts (ص/س, ق/ك, ح/ه) has the best evidence of anything on the
  list — a large effect that was still there 2.3 months later — so it shipped
  as its own finite programme rather than being folded into listening practice.

Where the honest answer is "nobody has studied this for Arabic dialects", the
app says so and stores the raw measurements rather than inventing a score. That
is the design behind the fluency features: there are no published fluency norms
for spoken Arabic, so learners are shown **their own trend over time**, never a
number claiming to place them against other people.

### 2.4 The app knows what you know

Every piece of generated content is conditioned on a **learner profile** built
on the server from real data — never from anything the browser claims. It
carries:

- Words you know, words you are mid-learning, and words you keep failing —
  drawn from your actual flashcard state across both decks.
- Your CEFR level, from the placement quiz.
- Your stated interests, from onboarding.
- The grammar structures you are weak on.
- The set phrases you have matured, offered to the generator for verbatim
  reuse, and the ones due for speaking, with an explicit instruction to create
  a natural moment for them.

So a reading passage generated for you is not "an A2 passage" — it is a passage
that reuses words you are about to forget, avoids ones you have never met, and
models the grammar you have been missing. A weak *word* and a weak *structure*
are passed as separate lines, because they want different treatment: a shaky
word wants another exposure in context, a shaky structure wants the correct
form modelled.

### 2.5 Native speakers check the machine

No amount of model orchestration replaces a person who grew up speaking the
dialect. Hakiya employs native speakers as **transcribers** and **content
reviewers**, and gives them a purpose-built workspace inside the admin area
(see [6.2](#62-checks-people-run)).

Two details make this real rather than decorative:

- **The audit trail cannot be authored by its own subject.** All review writes
  go through a server function that computes the difference against what is
  *actually stored*, and records who made it from their login token — not from
  anything the browser sent.
- **A tick can go stale.** When a reviewer approves a line, the exact Arabic and
  English they approved are stored with the tick. If the line later changes, the
  tick is shown as stale rather than silently vouching for words nobody read.

Reviewers who have no email address they read — which turns out to be common
for the people best qualified to do this work — get an **ID number and a
password** issued by an admin over WhatsApp or in person, and sign in with
those.

### 2.6 Honest numbers

A recurring theme in the code: when a measurement cannot support a claim, the
app declines to make the claim.

- **Pronunciation scores are recalibrated, not raw.** The underlying service
  averages a word's sounds, so one sound said completely wrong barely moves the
  score — ح produced as ه, the single most common English-speaker error, comes
  back around 85. Hakiya rescores each word on its *worst* sound as well as its
  average, lets fluency and completeness only ever subtract, and stretches the
  compressed top of the scale. It is still deliberately forgiving: a learner who
  gives up is worse off than one who is flattered.
- **Shadowing is scored as "closeness to the clip", not pronunciation.** Speech
  recognition snaps what it hears onto real words, so a clean transcript proves
  you chose the right words, not that you said them well. Where the clip's audio
  cannot be fetched for acoustic comparison, the score is capped — an honest
  ceiling on a measurement that cannot see the thing being measured.
- **A pipeline stage that "succeeded" while filling 3 of 40 lines is recorded
  as a failure**, because a learner sees the 37 empty ones.
- **Audio that is not Arabic produces an empty transcript, not a best guess.**
  Every recognition engine is pinned to Arabic, so handed an English song they
  will write Arabic-shaped nonsense. A gate catches this; the video still
  publishes with its on-screen text intact and a note saying why the transcript
  is empty.

### 2.7 The daily loop

The app's daily plan (`/today`) assembles a short queue from what is actually
due, and each item is skippable:

| Task | Appears when |
| --- | --- |
| Flashcards | Cards are due |
| Daily challenge | Once a day |
| Daily story | A short story built from your due vocabulary |
| Reading | Level-matched passage |
| Listening | Dictation drill |
| Souq News | A headline retold in your dialect |
| Set phrases | Phrases due on recognition or speaking |
| Fix a stuck mistake | Three or more unresolved recurring errors have piled up |
| Speaking | Rotates daily between monologue, phrase-in-a-situation, and say-a-line |
| Placement | You have never placed, or it is time to re-place |

The daily goal is a fixed *count of tasks*, so nothing is ever added on top —
tasks compete for the same slots.

---

## 3. Every feature, and how it works

### 3.1 Getting in: invite, sign-up, onboarding, placement

- **Invite code.** Sign-up requires a beta invite code, checked before the
  account is created and redeemed after. Admins mint and track codes.
- **Sign-up.** Email and password with email confirmation, or Google sign-in.
  There is a password reset flow.
- **ID login** (`/login/id`). A separate door for native-speaker reviewers who
  have no usable inbox. An admin issues an ID number and a one-time-displayed
  password; behind the scenes this is an ordinary account mapped onto an
  address at a domain that receives no mail, so sessions, permissions and audit
  trails all work normally.
- **Onboarding.** A short wizard: pick your dialect, your level, your goals and
  your interests. All of it feeds the learner profile. Google sign-ins are
  bounced through it too, so nobody skips it by using the OAuth button.
- **Placement.** Two instruments. `/placement` is a 20-question adaptive quiz
  that produces a CEFR level. `/placement/c-test` is a C-test — a passage with
  the second half of every second word deleted, which you restore — taken from
  a level-matched passage the app already generates. The C-test returns a
  percentage rather than a level, and is stored beside the placements so both
  can be watched moving over time.

### 3.2 The home feed and the daily plan

- **`/` — the Feed.** The app opens on content, not a dashboard: a vertically
  scrolling feed of real dialect clips, filtered by the dialect chip at the
  top. Tapping a clip opens the full player *in place* rather than navigating,
  so there is nothing between the tap and the first frame. Swiping left opens
  the chooser.
- **`/today` — the daily plan.** The dashboard: the task queue described above,
  a goal ring, streak, and the dialect switcher.
- **`/choose` — the chooser.** Four skills (Listen, Read, Speak, Write), three
  verbs that apply to whatever is in front of you (Upload, Ask, Games), and two
  structured paths (Alphabet Journey, Curriculum). This replaced three hub
  screens carrying 44 entries between them.
- **`/skills/:id` — skill pages.** Each skill opens onto its own activities, so
  the five different reading surfaces all have a door.
- **`/me` — your hub.** Your numbers first, then your library (saved words,
  phrases, transcriptions, liked videos), then everything else as labelled
  icons.

### 3.3 Listen

| Surface | What it is |
| --- | --- |
| **Listening Practice** (`/listening`) | Dictation drills pitched at your level — listen, write what you heard, check |
| **Sound Pairs** (`/alphabet/sounds`) | Perception training on the contrasts that gate Arabic listening (ص/س, ق/ك, ح/ه). Identification, not discrimination; text labels, not pictures; a finite programme with a known plateau (~400 minutes) rather than an endless drill |
| **Episodes** (`/listen`) | Generated graded audio — podcast-style two-host conversations and other formats — taken a sentence at a time |
| **Video Library** (`/discover`) | Every clip in the app, filterable by dialect and level |

**The video player** (`/discover/:videoId`) is the app's centrepiece. It shows
the clip with a synchronised transcript that has real per-word timings. You can
tap any word to see it and save it, capture a whole phrase into your phrase
deck, slow the audio down, play a single line on a loop, read the English, read
the same line converted to formal Arabic, see any text that was burned into the
video frame (memes, POV captions, title cards) in its own section, and switch
to a **Shadow** tab that runs about five repetitions of the same clip with a
score trace so you can hear yourself converging on it.

### 3.4 Read

| Surface | What it is |
| --- | --- |
| **Reading Practice** (`/reading`) | Passages generated for your level and dialect; tap any word; ask the tutor about the passage |
| **Reading Library** (`/reading-library`) | Graded authentic stories imported and translated into your dialect |
| **Souq News** (`/souq-news`) | Real headlines retold in your dialect, with a comprehension quiz |
| **Interactive Stories** (`/stories`) | Branching choose-your-own-adventure stories with illustrated scenes and audio |
| **Daily Story** (`/today/story`) | A short story built from the vocabulary you have due today |
| **Bible Reading** (`/bible`) | Passages side by side with English — role-gated |

### 3.5 Speak

| Surface | What it is |
| --- | --- |
| **Pronunciation Practice** (`/pronunciation`) | Say a line, get per-sound scoring and specific feedback on what to fix |
| **Conversation Simulator** (`/conversation`) | Free-form chat with a tutor that only speaks your dialect — by text, or as a live voice call |
| **Monologue** (`/monologue`) | Talk freely to a prompt for a level-scaled stretch: short paired prompts for beginners, a couple of minutes at intermediate, the 3–5 minute free-form ask only at advanced. Your speech rate, articulation rate, run length and pause pattern are measured and trended against your own history |
| **Native Feedback** (`/native-feedback`) | Send a recording to an actual native speaker and get a written response. Runs on credits |
| **Word Clips** (`/clips`) | The beginner track: every word taught by a 5–10 second authentic clip of a real speaker in a real scene |

### 3.6 Write

| Surface | What it is |
| --- | --- |
| **Writing Practice** (`/write`) | Write to a prompt, get it corrected with explanations |
| **Grammar Drills** (`/grammar`) | Targeted drills on the structures you keep missing |

### 3.7 Vocabulary and memory

The memory engine is **FSRS-6** — the current release of the algorithm Anki
ships. Instead of a fixed "ease factor", it models each card's **stability**
(how many days until you would be down to a 90% chance of recall) and
**difficulty**, and schedules accordingly.

Three things about the implementation are worth knowing:

- **Same-day reviews are modelled properly.** Older versions had no same-day
  formula at all, which produced the notorious bug where Hard, Good and Easy
  minutes after a review all give the identical next interval.
- **Forgetting can only ever lower the estimate.** Post-lapse stability is
  capped strictly below the pre-lapse value.
- **The 21 weights are meant to be fitted per learner.** Every review is logged
  by a database trigger (not by the app, so no future writer can forget), and
  the intent is to fit each learner's own weights from their history. Until
  there is enough history, a single calibration multiplier does the cold-start
  job. The research is explicit that per-learner fitting is worth more than an
  algorithm version bump.

Around that:

- **`/my-words`** — every word you have saved, filterable and searchable, with
  Anki import, audio, images, and a "find roots" enrichment that groups words by
  their Arabic root.
- **`/review`** and **`/review/my-words`** — the review sessions. Audio plays,
  an image shows, you recall, you self-rate.
- **`/analytics`** — includes the **speaking gap**: how many words are mature
  when you *recognise* them versus mature when you have to *produce* them. That
  gap is the intermediate plateau, measured rather than asserted.
- **Vocab Games** (`/vocab-games`) and **Vocab Battles** (`/battles`) — quick
  matching and speed rounds, and head-to-head duels against other learners.

### 3.8 Set phrases (chunks)

Formulaic phrases — the things fluent speakers say as single units — get their
own deck (`/set-phrases`) and their own schedule. Recognition and *production*
are scheduled separately: answering a multiple-choice question grades
recognition, and a confident recognition answer is what unlocks the speaking
track; speaking the phrase grades both.

The quiz's new picks deliberately prefer occasions you have saved least from.
That is a counterweight to what the literature calls the "phrasal teddy bear" —
learners cling to a handful of safe phrases and never expand.

The deck is sourced from the app's own reviewed content: no published
formulaic-phrase list exists for any Arabic dialect, so the phrase marks native
reviewers leave in transcripts are the inventory. An admin page mines them,
ranks them by how often reviewers marked each one, deduplicates across spelling
variants, and promotes candidates to drafts — with a separate editorial pass
still deciding what ships.

### 3.9 Grammar

Vocabulary had a full memory system; grammar had nothing. Now grammar
structures have their own mastery ladder. When you finish a drill, each answer
is folded into a per-concept mastery record. One rule is non-obvious and
deliberate: **a wrong answer never promotes you.** Strength is derived from
cumulative accuracy, so without that rule a learner sitting just under a
threshold could cross it by getting a question wrong. A miss demotes one rung
and makes the concept due immediately.

Both writers that tag content with grammar concepts go through a single shared
taxonomy, so free-text model output and the mastery ladder agree on one set of
keys — otherwise content gets tagged with concepts no learner's record can join
to.

### 3.10 The Ask AI tutor

A floating button on every screen. It answers by text (streamed) or as a live
voice call. What makes it different from a generic chatbot is **what it can
see**, in five independent layers:

1. **The page.** Not a blob of text — a structured payload with the line in
   focus, the *whole* document it sits inside, editorial metadata (level,
   dialect, vocabulary, grammar points, cultural notes), and your position
   ("line 12 of 48, 0:47 of 3:10"). Long documents are **windowed, not
   truncated** — the window grows outward from the line you are looking at, and
   it explicitly marks what it dropped (`… 14 lines omitted …`) so the model
   never reads two non-adjacent lines as consecutive and explains a transition
   that never happened.
2. **Retrieval.** It can search the app's whole library semantically, filtered
   to your dialect, with a similarity floor — because a nearest-neighbour lookup
   always returns *something*, and without a floor the tutor reports the closest
   row in the library as related.
3. **Tools.** It can read the original web page a piece of content came from,
   search the library, and check a word's review history. The "read the source
   page" tool is deliberately locked to exact addresses your own screen points
   at, never to domains or prefixes — that is the reasoning an injected
   instruction would reach for.
4. **What is on screen.** Text burned into video frames is read with its
   timings, and the player resolves the current moment as playback advances.
5. **Memory between sessions.** Short notes about what keeps confusing you and
   which kind of explanation lands, written by a small model after the answer
   has streamed. These are the least reliable thing in the prompt, so they are
   framed as hints and dropped the moment you contradict them. Settings shows
   you exactly what is remembered and lets you erase it. Nothing the browser
   sends can write to that memory.

During a live voice call, the instructions are minted once (so the dialect
rulebook and your profile stay stable), and position changes are pushed as
notes over the open channel — without that, the tutor would be frozen at
whatever was on screen when the call connected.

### 3.11 Bring your own material

| Surface | What it does |
| --- | --- |
| **Transcribe** (`/transcribe`) | Drop in audio, video, a TikTok or a YouTube link and get a word-by-word transcript with translations, dialect notes and tappable vocabulary |
| **Translate** (`/translate`) | Paste Arabic and get a sentence-by-sentence breakdown — literal, natural, and cultural notes |
| **How Do I Say…** (`/how-do-i-say`) | Type English, get the natural dialect way to say it — not a dictionary swap |
| **Meme Analyzer** (`/meme`) | Paste an Arabic meme and get the text, the joke, and the dialect cues explained |
| **Learn from X** (`/learn-from-x`) | Drop an X/Twitter post URL; the Arabic is extracted, translated, and turned into flashcards |
| **Tutor Upload** (`/tutor-upload`) | Upload a recording of a lesson with your human tutor; it is cut into flashcards with audio, translations and images |
| **Dialect Compare** (`/dialect-compare`) | See how one word or phrase shifts across dialects |
| **Culture Guide** (`/culture-guide`) | Customs, etiquette and context |

**Share into the app.** On an installed phone app, Hakiya appears in the
Android share sheet. Share a voice note, a screenshot, a link or some text from
any other app, and it is screened by AI and routed automatically: a voice note
to Transcribe with the file pre-loaded; a chat screenshot to Translate with the
Arabic already extracted; an English "how do I say…" to How Do I Say; an X link
to Learn from X. If the screening call fails, the share still lands somewhere
sensible rather than vanishing.

### 3.12 The two structured paths

- **Alphabet Journey** (`/alphabet`) — 28 letters in four stages, each closed by
  a checkpoint quiz. The page is set like a type specimen, because the
  letterforms are the point: no icons, state carried entirely by ink weight and
  colour, and locked letters still legible because seeing what is coming is half
  the reason to show it.
- **Curriculum** (`/curriculum`) — stages and lessons, each with vocabulary, a
  sound spotlight, a lesson sequence and real-world prompts, ending in a quiz.
  Lesson plans are imported from spreadsheets. **Gating is deliberately soft**:
  exactly one lesson is marked "Next up", the unlock guidance is shown as
  guidance, and anything can be opened.

### 3.13 The MSA bridge and the Fusha row

For learners arriving from years of Modern Standard Arabic, two features build
the bridge in both directions:

- **The Fusha row.** Every transcript line can show a third rendering: the same
  sentence rewritten in MSA. This is a *conversion*, not a translation — the
  row stays in Arabic and only the dialect-specific parts move (شلونك → كيف
  حالك, يبغى → يريد, ما راح أروح → لن أذهب), so you can see exactly which pieces
  the dialect changed. Turning "Formal Arabic (MSA)" on once — in Settings, on a
  transcript, on a video — turns it on everywhere.
- **The Bridge** (`/bridge`). A study surface for the transformation rules
  themselves: sound shifts, pronouns, verb prefixes and vocabulary swaps that
  take an MSA form to your dialect.

### 3.14 Your mistakes, and drilling them out

Every pronunciation miss, shadowing gap, sentence-coach failure and phrase
mismatch is recorded. `/mistakes` groups them by target rather than listing them
raw — six misses on one word is one problem, not six — ranked by how often and
how recently. Each entry shows what you were aiming for, what came out, and
lets you hear it correct.

The page also carries a **fossilization drill**. Errors persist precisely
because they rarely impede communication enough to get corrected, so the drill
puts your *own recorded production* next to the correct form as a forced choice,
then asks you to produce it yourself. Only the production resolves the
underlying error — checked server-side — and a failed production records a fresh
error. Once three distinct unresolved targets pile up, "Fix a stuck mistake"
joins your daily queue.

### 3.15 Progress, analytics and gamification

XP, levels, achievements with Arabic names, daily and weekly XP tracking,
review streaks, weekly goals, and a **Daily Challenge** with a streak multiplier.
`/analytics` shows your card stages, a forecast of what is due, time spent,
weak spots, and the receptive/productive gap.

### 3.16 Social features

`/leaderboard` (weekly XP), `/friends` (follow other learners, see streaks),
`/battles` (real-time head-to-head vocabulary duels), `/profile` (achievements
and badges), and a referral programme.

### 3.17 The Bible track

A separate, role-gated track: Arabic scripture with verse-by-verse translations
and tappable vocabulary (`/bible`), plus guided lessons built from biblical
passages (`/bible/lessons`). Access is granted per-user by an admin.

### 3.18 Settings, offline use and notifications

- **Display preferences** — dialect, formal-Arabic row on/off, diacritics,
  transliteration, root families, hints.
- **Installable.** The app installs to a phone home screen and caches its own
  shell and card audio for offline use. It deliberately never caches the
  database, so login, decks and AI calls always go to the network.
- **Push notifications.** Optional and off unless configured. When on, reminders
  fire only inside your local evening, at most once a day, and only when enough
  cards are genuinely due.
- **Your data.** You can export it and delete your account. You can see and
  erase what the tutor remembers about you.
- **Themes.** A light "warm sand" theme and a dark "night majlis" theme, with
  the brand colours re-tuned for the dark theme rather than ported across.

### 3.19 The staff side

35 admin screens, covering: the video library and review queue, vocabulary
topics and words, curriculum stages and lesson import, an AI-assisted
curriculum builder, stories and the reading library, chunk mining, the dialect
rulebook, invite codes, ID logins, Bible and role grants, error logs, feature
metrics, learner feedback, the YouTube channel corpus and clip pipeline,
trending videos, and the social-trends review queue.

**Trending** deserves a note: it harvests what the Arab world is posting right
now — X trend topics per country, public Telegram channel posts, and Reddit
country subreddits — under a hard constraint of **zero API spend**, since X's
API moved to pay-per-use. Every post is screened for dialect by AI, but **a
human publishes; the AI only triages.** Triage is deliberately generous —
"mixed" register and low-confidence calls go to the review queue, only clear
formal Arabic and non-Arabic are binned — because with a person deciding, a full
queue beats a strict auto-publisher that starves a dialect.

### 3.20 Plans and billing

| Plan | Price | What you get |
| --- | --- | --- |
| **Free** | $0 | Full lesson library and flashcard review · Discover feed in all three dialects · every AI tool with daily free limits · 30 minutes of voice practice a month |
| **Standard** | $5/mo or $50/yr | No daily limits on AI tools · 2 hours/month of live AI voice · more AI images and jingles daily · unlimited Transcribe, Meme Analyzer and How Do I Say |
| **All-In** | $15/mo or $150/yr | Everything in Standard · 5 hours/month of live voice · highest allowances · early access to new features |

Annual is two months free and is the default selection. There is a 7-day
money-back guarantee rather than a time-boxed trial, since the free plan is
permanent. All three dialects are on every plan including Free. Progress is tied
to the account, not the plan — nothing is locked or deleted on a downgrade.

Billing runs on Stripe with a customer portal for upgrades, downgrades and
cancellations. There is also a **complimentary** role for investors, partners
and press that grants top-tier access without a subscription.

---

## 4. The tools we use, and why

### 4.1 The app itself

| Tool | Why |
| --- | --- |
| **React + TypeScript** | The mainstream choice for an app this interactive; TypeScript catches a whole class of bug before anyone runs the code |
| **Vite** | Fast development server and small production builds |
| **Tailwind CSS + shadcn-ui** | Tailwind keeps the design system in one place (colours are tokens, not scattered hex codes, which is what let the dark theme be built by redefining tokens rather than rewriting hundreds of screens). shadcn-ui gives accessible components we own the source of, rather than a dependency we cannot change |
| **Radix UI** | The accessibility layer under every menu, dialog and dropdown — keyboard navigation and screen-reader behaviour done properly |
| **TanStack Query** | Manages every piece of server data: caching, refetching, loading and error states |
| **React Router** | Routing across 122 routes |

### 4.2 The backend

| Tool | Why |
| --- | --- |
| **Supabase (Postgres)** | One managed service covering the database, authentication, file storage and serverless functions. Critically it gives us **Row-Level Security** — access rules enforced by the database itself, so a bug in app code cannot leak another learner's data |
| **Deno edge functions** | 117 small server functions, each doing one job, running close to users. Anything involving a secret key, spending money, or writing a score runs here, never in the browser |

The most important pattern in the backend: **reads and writes are deliberately
asymmetric.** For scores, mistakes, grammar mastery, tutor memory and review
sign-offs, you can read your own rows directly under database rules — but all
writes go through a server function with elevated permissions. So nobody can
post themselves a score, plant a fake memory, or forge an audit entry.

### 4.3 The AI models

Model IDs are **centralised in one file** and never hardcoded in feature code —
a test enforces this in both directions. Which company's API serves each model
is a separate decision, made by the vendor prefix on the model name.

| Model | Role | Why |
| --- | --- | --- |
| **Claude Sonnet 5** | Co-lead drafter, critic, and the tutor's chat model | Strongest instruction-following of the set; also cheaper than the model it replaced |
| **Gemini 3.7 Flash** | Co-lead drafter, and the workhorse for most learner-facing Arabic | Measured at 92 on the Arabic index, second only to Gemini Pro; half the price of the version it replaced |
| **Gemini 3.1 Pro** | Heavy reasoning; the native-speaker validator's judge | The dialect quality ceiling |
| **Qwen** | Third-leg verifier at lower weight | An independent house style, to stop an ensemble being two models agreeing with themselves |
| **Mistral Saba** | Arabic-native second opinion in the validator | A 24B Arabic-focused model, roughly an order of magnitude cheaper than the Pro judge for a single-snippet check |
| **GPT-5.6 Luna** | Second drafter for story generation | A non-Google, non-Anthropic voice |
| **Fanar (QCRI)** | Dialect validation tie-breaker, merge fallback, curriculum chat, Arabic MT | Qatar's sovereign Arabic model — dialect-tuned and validated by native testers. Used sparingly because its daily quotas are small |
| **Gemini / GPT image models** | Flashcard and story illustrations | Gemini first because the house illustration style was tuned on it |

Notably, the cheapest tier is *deliberately not used* for anything that writes
Arabic. The evidence is that models under-produce dialect out of reluctance, and
that this gets worse as models get smaller and more aligned — so saving a few
cents per million tokens on the app's highest-volume dialect path is the wrong
side of that trade.

**Routing and fallback.** Google models go to Google, OpenAI models to OpenAI,
Fanar to QCRI, and everything else through **OpenRouter**. OpenRouter is also
the safety net: if a vendor's key is missing, or its API returns certain error
codes, the *same model* is retried once through OpenRouter. That is a provider
swap, never a model swap — you never silently get a different model's answer.

**The orchestrator.** Every function that generates or judges Arabic goes
through a shared "Brain" rather than calling a model directly. The Brain layers
on dialect identity, worked dialect examples, the MSA leak scan, a repair pass
and the optional validator, and picks one of four strategies per task:

- **solo** — one model, one shot (classification, extraction)
- **ensemble** — several models in parallel, results clustered and voted on
- **draft_critic** — one model drafts, another critiques and rewrites
- **council** — three models, for the hardest tasks

The stable half of every prompt (dialect identity, rulebook, worked examples)
is placed before the volatile half (your profile) specifically so it can be
cached and billed once per dialect rather than once per call.

### 4.4 Hearing: speech recognition

Six engines, run **in parallel** on the same audio, because no single engine is
reliable on dialectal Arabic:

| Engine | Role |
| --- | --- |
| **Soniox** | Word-level timings, speaker separation, and a parallel English translation. Handles code-switching |
| **Munsit** | Arabic-native engine; often the longest and best transcript. Long files are split on real frame boundaries and stitched back |
| **ElevenLabs Scribe v2** | Top-ranked Arabic/code-switching engine with usable word timings; replaced a generalist engine whose Arabic word boundaries were never trusted |
| **Fanar (QCRI)** | Arabic-native, text only. Metered against a small daily quota |
| **Azure Speech** | Routed to the right locale per dialect (ar-SA / ar-EG / ar-YE) |
| **Cohere Transcribe Arabic** | Pilot leg; skipped entirely when its key is unset |

The winner is not picked by a fixed priority list. The Arabic-aware engines'
outputs are compared by length, anything under half the median is dropped as a
failed run, and the longest survivor wins — with priority only as a tie-break.
This exists because an earlier fixed waterfall let a 3-character response from a
preferred engine beat a complete transcript from another.

### 4.5 Speaking: text to speech

Every voice in the app comes from **Munsit's Faseeh model**, with ElevenLabs
surviving as an Egyptian-specific fallback and Azure as the emergency floor.

Clients ask for a **dialect**, never a voice — voice IDs come only from server
config. That is what lets a cloned voice be switched on with a config change
rather than a deploy, and it means there is no caller-supplied voice ID to
police.

**Yemeni is deliberately read by a Gulf voice**, rotated so Gulf and Yemeni
never lead with the same speaker. This looks like a bug and is a decision that
reverses an earlier one: the app was moved onto genuine Yemeni-locale voices,
and they sounded markedly worse. On listening quality the Gulf voice — wrong
accent family and all — is closer and far more natural. A cloned Yemeni voice
can be switched on with one config value when one exists.

### 4.6 Arabic-specific tools

| Tool | Why |
| --- | --- |
| **Farasa (QCRI)** | Adds the vowel marks (tashkeel) to Arabic text — Arabic is normally written without them, and beginners need them |
| **CAMeL Lab dialect ID** | The only *non-AI-model* check on which dialect a clip is actually in — runs alongside the model's own verdict |
| **ALDi (dialectness scoring)** | Log-only for now: a continuous 0–1 measure of how dialectal a sentence is, being compared against the word-list detector before either becomes a gate |

### 4.7 Content sourcing

| Tool | Why |
| --- | --- |
| **YouTube Data API** | Enumerating curated channels for the beginner clip pipeline |
| **Supadata** | Fetching YouTube caption tracks without local tooling |
| **Firecrawl** | Reading a source web page for the tutor's "read the source" tool |
| **Jina Reader** | Free route to X trend topics and post text |
| **Telegram public previews / Reddit API** | Free social harvest for the trending feed |
| **Cobalt / RapidAPI** | Media download for the ingestion pipeline |

### 4.8 Money, analytics, hosting

**Stripe** for subscriptions and the customer portal, **PostHog** for product
analytics (optional — nothing fires without a key), and a static build
deployable to Netlify or Vercel with the backend on Supabase.

### 4.9 What we deliberately do not use

- **A hosting provider's AI gateway.** Every model call goes to a named vendor
  or OpenRouter. This is stated as a rule in the code.
- **The cheapest model tier for Arabic generation** — see [4.3](#43-the-ai-models).
- **Client-supplied context about the learner.** "Here is what I know" from a
  browser is a prompt-injection surface with a database behind it.
- **The Casablanca corpus** — licensed non-commercially, so a planned fine-tune
  was cancelled rather than quietly done anyway.

---

## 5. The transcription pipeline

This is the single most involved process in the app: turning a link or a file
into a checked, levelled, learner-ready transcript. There are ten stages.

**1 — Ingestion.** A video enters from an admin pasting a link, uploading a
file, sharing a link into the app from a phone, or the trending harvester. The
row is created and the media is downloaded and staged privately.

**2 — Six engines in parallel.** The audio goes to all six recognition engines
at once (see [4.4](#44-hearing-speech-recognition)). Each has its own timeout;
each reports its own failure with a reason, so "the key is missing", "the API
errored" and "it returned seven characters for a two-minute clip" are three
distinguishable outcomes in the record rather than one silent zero.

**3 — Is this even Arabic?** A gate decides whether the audio contains Arabic
speech at all. Two independent signals: whether the engines wrote Latin script
(meaning they gave up), and the model's own verdict during the merge. If neither
is sure, the transcript is kept. Arabic *singing* is not a failure — someone
studying an Arabic song wants the lyrics. A refused video still publishes, with
its on-screen text intact and a note explaining the empty transcript.

**4 — Pick a primary.** The Arabic-aware engines' outputs are length-compared,
outliers dropped, longest survivor wins. Word timings are taken from whichever
engine has the best ones.

**5 — Merge.** A model reads all six transcripts side by side and produces one
clean Arabic transcript, split into sensible lines. It is not asked to produce
word-level output — that payload explodes in size and gets truncated into
invalid JSON. Words are generated on the server from the sentence text instead.

**6 — Translate, by committee.** Three models translate the merged transcript
in parallel. For each line, their candidate translations are clustered by how
much vocabulary they share and a winner is chosen by weighted vote — the two
lead models agreeing always wins. Lines where the vote never reached a winning
weight are marked as disputed. Those disputed lines are then arbitrated by a
dedicated Arabic-to-English translation model, batched to respect its small
daily quota.

**7 — Enrich, in parallel.** Several things happen at once, none of which can
break the others:

- **Vocabulary and grammar extraction** — the words and structures worth
  teaching, with per-word English glosses for *every* token, not just the
  highlighted ones.
- **Formal Arabic conversion** — the Fusha row, run as its own model call
  precisely so its failure costs the transcript one optional row rather than its
  translations. Anything that comes back without Arabic script is dropped
  (otherwise a second English translation appears wearing Arabic's clothes), and
  a short answer pads rather than shifting (a model returning nine renderings for
  ten lines has merged two, and sliding them into place files every later line's
  formal Arabic under the wrong sentence).
- **Dialect validation** — Fanar judges the transcript against its own dialect's
  norms, not Gulf norms, and returns a structured issue list.
- **CAMeL dialect identification** — the non-model check on the dialect label.
- **Diacritization** — Farasa adds vowel marks.
- **On-screen text extraction** — the video's frames are read for burned-in text
  (memes, POV captions, title cards), with timings, and stored **separately from
  the transcript**. Mixing them in used to make a caption indistinguishable from
  something a person said: line-by-line playback would seek to audio that was
  never recorded, and the tutor would answer "what did they say" with text nobody
  spoke.

**8 — Timing alignment.** The merged Arabic no longer matches the recognition
engines' word stream word-for-word, because the merge rewrote it. So the two
streams are aligned: both are normalised, anchored on words unique to both, kept
in order, and the gaps filled by exact, fuzzy and split/merge matching before
anything left over is interpolated between its neighbours. Each line's start and
end come from the words that actually matched — which is what keeps a pause a
pause instead of smearing it as cumulative drift across every following line. If
too few words match, the pipeline falls back to a proportional split: wrong in
detail but bounded, and it deliberately leaves behind no word-times that could
be mistaken for real ones.

**9 — Level and finalise.** The clip is rated for CEFR level, thumbnails are
copied to our own storage (platform thumbnail URLs are *signed* and expire in
about 48 hours, so storing the platform's answer verbatim gives you a picture
until the weekend), and the row is marked complete.

**10 — Human review.** A native speaker corrects the result — see
[6.2](#62-checks-people-run).

### Surviving its own infrastructure

The pipeline is cut into **stages with checkpoints** because of a specific
platform behaviour: the server's time limit belongs to the *worker*, not the
request. A worker keeps serving requests until it hits the limit and is then
torn down with whatever is still running inside it, and nothing catchable is
raised. So a run starting on a worker warmed by an earlier upload — the second
video of the afternoon — has an unknown fraction of the budget left.

The old single-task design died between two database writes in exactly that
case, leaving a row spinning until a cleanup job failed it twelve minutes later.
That is the "I uploaded it and then nothing happened" report.

Now each stage writes what it produced before handing over, and three
independent things can pick a stalled run back up: the function itself, the
analysis step calling back when its results land, and the admin pages noticing a
row has stopped moving. A resume **never repeats paid work** — it reads the
checkpoint and continues. Live runs touch the row every 30 seconds, so "two
minutes without a change" is a dead worker, not a slow engine.

The pipeline also writes a plain-language progress line onto the row — the
stage, a note in the admin's own words ("waiting for the analysis (90s)"),
whether the analysis has been restarted, and a marker naming which deployed
build is running. Three readings and what each rules out:

- **An unfamiliar build marker, or no line at all** → the deploy did not land.
- **"running without stage checkpoints"** → every hand-off is being refused, so
  the run has degraded to the single long task this design replaced.
- **A named step whose "last moved" keeps advancing** → the run is alive and
  merely slow, and the step says where to look.

---

## 6. The check process

Quality is checked in five distinct places. Nothing here relies on one gate.

### 6.1 Checks the AI runs on itself

| Check | What it catches |
| --- | --- |
| **Worked dialect examples** | Prevention rather than detection — the front half of the MSA fight, and the cheap one. Every dialect's examples are themselves tested to be leak-free under the detector's own rules, because a leak inside a demonstration is *taught*, not caught |
| **MSA leak detector** | Formal-Arabic words that do not belong in the target dialect, matched on normalised text so spelling variants cannot slip past. Each dialect also has an always-allowed list, so an admin pasting a full formal sentence as a bad example cannot poison the detector against neutral words |
| **Repair pass** | The offending words are named back to the model and the answer rewritten |
| **Native-speaker validator** | A strong model scores authenticity 1–5 against the approved rulebook; an Arabic-native model gives a second opinion; Fanar breaks ties. Optional by design — it degrades to "unknown" rather than failing the request behind it |
| **Ensemble voting** | Where several models answer, agreement decides — and disagreement is *recorded* as disagreement rather than hidden behind a confident single answer |
| **Arabic speech gate** | Audio that is not Arabic |
| **Dialect ID cross-check** | CAMeL Lab's non-model verdict against the model's own |
| **Structural guards** | Non-Arabic in an Arabic-only field; a short answer array being slid into place instead of padded; a stage that "succeeded" on 3 of 40 lines |

### 6.2 Checks people run

**The transcript review workspace.** Native speakers work on the Manage Videos
pages. The video list doubles as the review queue and sorts by how much is left
rather than by date; each video's edit page carries the whole workspace.

What a reviewer does:

- **Tick a line** as correct. The tick stores the exact Arabic and English it
  approved, so it can be shown as **stale** the moment the line changes. This
  matters more than it sounds: merging two lines keeps the left one's ID, so
  without that snapshot a tick would silently carry onto words nobody read.
- **Correct the Arabic and the English.** An Arabic edit rewrites the line's
  word list, not just its text, using a longest-common-subsequence alignment —
  so words the edit did not touch keep their real recognised timings, and a word
  someone typed is interpolated into the gap its neighbours leave.
- **Split, merge and re-time lines**, nudging timings by keyboard.
- **Play a single line**, loop it, or slow it down. The speed is the reviewer's
  own and never touches the published video.
- **Re-translate one line** on demand.
- **Comment** per line or per video — a note, a concern, or a proposed better
  translation that carries the proposed English in its own field so it can be
  applied in one click.
- **Re-sync timings** by forced alignment once the text is corrected, since at
  that point the text is ground truth and the timing is not. The function
  refuses audio that does not fit the transcript rather than writing a confident
  mistake, and refuses timings a player cannot use — a line ending before it
  starts, a timeline running backwards.
- **Classify the sub-dialect.** The country label ("Saudi") is roughly the
  resolution of a passport, not of a dialect — a Jeddah clip and a Riyadh clip
  land on the same one. A second dropdown, dependent on the first, offers the
  varieties under that country (Najdi, Qassimi, Ḥijāzi, Eastern Province…), kept
  to two levels so no list is more than about seven long — a dropdown a reviewer
  has to scroll is one they leave on its default.
- **List what marks the clip as that variety** — a sound, a borrowing, an
  intonation, a word that means something else one border away. Deliberately
  kept separate from the grammar taxonomy, because most of what places a speaker
  is not grammar. The field that earns the section is *contrast*: "uses شنو" is a
  fact; "uses شنو where Riyadh says وش and Cairo says إيه" is what builds an ear.

Everything a reviewer does is **drafted on their device first**, with a visible
"auto-saved to this device, not published" state, and an explicit Save is what
writes it and the revision log. That distinction is the whole design: a reviewer
who reads "saved" as "live" walks away believing learners have their
corrections, which is a quieter and worse failure than losing the work.

**Other human review queues:**

| Queue | What it gates |
| --- | --- |
| **Social trends** | Every harvested post — AI triages generously, a content manager approves or rejects |
| **Trending videos** | Candidate clips before ingestion |
| **Clip candidates** | Beginner-curriculum clips, verified before publication |
| **Channels** | Which YouTube channels may be mined at all |
| **Dialect rules** | Draft → approved → retired, and only approved rules reach the AI |
| **Concept realizations** | Per-dialect surface forms for curriculum concepts, native-review gated |
| **Set phrases** | An editorial pass decides what ships from the mined candidates |
| **Curriculum builder** | AI-drafted curriculum needs approval |
| **Content reports** | Learners can report any content |
| **Beta feedback** | Learner feedback with screenshots, triaged by staff |

### 6.3 Checks on the code

Four independent jobs run on every push and pull request, so a failure names its
own kind:

1. **Typecheck, lint, unit tests and a production build.**
2. **Edge functions typechecked and run** under Deno — the runtime gate, not
   just a compile one. This one is a clean gate with zero tolerated debt; its
   first three runs found eight real defects, including one that made *every*
   response from one function throw.
3. **Migration replay** — every database migration replayed against a stock
   Postgres, answering "can this schema be rebuilt from scratch?" A migration
   set that only works against the one database it grew on is invisible until
   someone tries to recreate it.
4. **End-to-end browser tests**, sharded four ways.

Five test layers sit under those jobs: unit, component, end-to-end, edge
runtime, and schema contract. In total 370 unit and component test files, 84
browser specs and 93 edge-function test files.

Three things about the setup are unusual and deliberate:

- **The lint check is a ratchet, not a clean gate.** The repo carries a few
  hundred pre-existing errors, so requiring zero would make every build red and
  train everyone to ignore CI. It fails only when the count goes *up*, and
  prints the new number when you bring it down. **Test code, by contrast, is
  held to a stricter standard than the app** — no loose types, and a stray
  "run only this test" marker is an error, because at this suite's size it
  silently reduces thousands of tests to one and CI still reports green.
- **There are drift guards that fail when you *add* code, not when you break
  it.** Every backend function must be named by a test file; every module in the
  core logic directories must be named by some test; every route must be in a
  manifest and must have a link somewhere in the app or an allow-listed written
  reason for not having one. These checks are deliberately shallow — a name in a
  test file is a claim that someone looked at it — and depth is what review is
  for.
- **A misconfigured test run would talk to the production database and still go
  green.** Four independent layers prevent it, and a fifth test asserts all four
  are still in place.

There is also a **dialect fidelity evaluation script** that measures a model
against a frozen golden set through the exact prompt the app builds. Two flags
carry its reason for existing: comparing two models' leak rates per dialect
before a model upgrade ships, and running with and without the worked examples
to check they still earn their tokens. It needs real provider keys, so it is a
deliberate manual tool rather than an automatic gate.

Note one honest gap: for **Yemeni**, the published dialect-fidelity benchmark
does not cover the dialect at all, so the app's own golden set is the only
instrument that exists. A Yemeni regression there is the whole evidence, not a
hint.

### 6.4 Checks on the live site

Separately from the hermetic test suite, there is a **live QA harness** that
runs against the real production project:

- A **crawl** of every route: load it, screenshot it, record every failure, then
  click every safe control and record what happened — including controls that do
  **nothing**, which is a failure mode no error log catches. Controls that would
  spend money are listed as "needs live API test" and never clicked.
- A **resilience pass** that injects a server error, a network drop and a 4-second
  delay on every backend call for the key routes, and records whether the UI
  shows an error, spins forever, or silently renders a plausible empty state.
- A **media pass** that opens a YouTube clip and a TikTok clip and checks the
  player and transcript timings.
- A generated **QA map** (`QA_MAP.md`) tying every route to the tables, backend
  functions and storage buckets it touches, annotated with the access policy
  that governs each and what an anonymous visitor actually gets from production.
  A screenshot gallery with a verdict per page is generated alongside it.

### 6.5 What is watched after release

Four fire-and-forget recorders log what happened: model usage and cost, dialect
violations, training examples, and feature metrics. They swallow their own
errors so they can never fail the request they are attached to — which also
means they can stop working silently, and that is a known trade-off. Client-side
errors are logged to an admin page, learner feedback comes in with screenshots,
and a digest of dialect violations is produced for the content team.

---
---

# Part Two — Technical reference

*This half assumes engineering context. It is the in-repo reference; nothing in
it is intended for a general audience.*

## 7. Architecture at a glance

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser — Vite + React 18 + TypeScript                          │
│  shadcn-ui / Radix · Tailwind · TanStack Query · React Router    │
│  Service worker (app shell + card audio, never Supabase)         │
└───────────────┬──────────────────────────────────────────────────┘
                │ supabase-js (anon key, RLS-scoped)
┌───────────────▼──────────────────────────────────────────────────┐
│  Supabase                                                        │
│   Postgres (119 tables, RLS everywhere) · Auth · Storage buckets │
│   117 Deno edge functions                                        │
└───────────────┬──────────────────────────────────────────────────┘
                │
   ┌────────────┼──────────────┬───────────────┬──────────────┐
   ▼            ▼              ▼               ▼              ▼
 aiGateway   ASR fan-out    TTS routing     Stripe       Content APIs
 (Google/    (Soniox,       (Munsit →       (checkout,   (YouTube, Supadata,
  OpenAI/     Munsit,        ElevenLabs →    portal,      Firecrawl, Jina,
  QCRI/       Scribe,        Azure)          webhookless  Telegram, Reddit,
  OpenRouter) Fanar,                         polling)     Cobalt/RapidAPI)
              Azure, Cohere)
```

**The two invariants that shape everything:**

1. **Model IDs are centralised** in `_shared/modelRegistry.ts`. `_shared/aiGateway.ts`
   picks the provider off the vendor prefix. `src/test/modelRegistry.test.ts`
   fails both on a new hardcoded id and on a stale allow-list entry.
2. **Reads and writes are asymmetric** for anything a client must not author:
   `learner_errors`, `user_concept_mastery`, `learner_ai_memory`,
   `transcript_line_*`, `access_credentials`. Client SELECT under RLS;
   service-role INSERT/UPDATE through an edge function.

## 8. Repository layout

| Path | Contents |
| --- | --- |
| `src/` | React app. 75 pages + 35 admin pages, 337 components, 100 hooks, 85 lib modules |
| `src/lib/` | Pure domain logic with co-located `*.test.ts`. Nothing with side effects |
| `src/hooks/` | Most of the app's decisions; covered by Vitest under a coverage threshold |
| `src/pages/` | Route components — exercised by Playwright, excluded from coverage thresholds |
| `src/test/` | Shared harness, drift guards, tests for `_shared/*` Deno modules, and `support/` (the in-memory Supabase backend) |
| `src/integrations/supabase/` | Generated types and the client |
| `supabase/functions/` | 117 edge functions, `_shared/` (76 modules), `_test/` (93 test files + harness) |
| `supabase/migrations/` | 229 migrations, applied in filename order |
| `contract/` | Migration replay against stock Postgres, plus `prelude.sql` supplying the `auth`/`storage` objects |
| `e2e/` | 84 Playwright specs + `support/` (fake auth session, same in-memory backend) |
| `qa/` | Live pre-production harness (crawl, resilience, media, map/report/gallery builders) |
| `curriculum/` | Source lesson spreadsheets |
| `docs/` | Planning, research, audits, branding assets |
| `scripts/` | Lint ratchet, corpus derivation, illustration generation, training-data export, `eval-dialect-live.ts` |

## 9. Frontend reference

**Build.** Vite 5 + `@vitejs/plugin-react-swc`. `vite.config.ts` uses
`envDir: ".vite-env"` (an empty directory), so a root `.env` is ignored for the
app build and the Supabase client vars are injected via `define` from
`process.env`, **falling back to the real production project when unset**. This
is the single most dangerous configuration fact in the repo — see
[17](#17-testing-and-ci-reference).

**Design tokens.** All colour is HSL custom properties in `src/index.css`,
surfaced through `tailwind.config.ts`. The `.dark` block redefines the tokens
rather than porting them, because deep terracotta on near-black fails contrast
badly (`text-primary` measured 3.07:1). Accents invert: light theme uses deep
inks with white foreground, dark theme uses light accents with warm-ink
foreground, chosen as the lowest lightness clearing 4.5:1 against `--card`.
`e2e/contrast.spec.ts` guards this.

**Navigation model.** `src/lib/surfaces.ts` is the whole navigation model in one
file: `SKILLS` (4, each owning its `activities`), `VERBS` (3), `PATHS` (2).

**State.** TanStack Query for all server state. `DialectContext` carries the
active dialect. Auth via `useAuth`. No global store beyond that.

**Notable client-side subsystems:**

| Module | Job |
| --- | --- |
| `src/lib/spacedRepetition.ts` | FSRS-6, 21 weights, per-learner weight vector support |
| `src/lib/fsrsFit.ts` | Fits weights from `review_log` |
| `src/lib/transcriptOps.ts` | Split/merge/retokenize with LCS alignment |
| `src/lib/transcriptDraft.ts` | Per-video `localStorage` drafts, never overwritten while offered back |
| `src/lib/transcriptShortcuts.ts` | The keyboard map, read by both the resolver and the help panel |
| `src/lib/acousticSimilarity.ts` | MFCC + DTW in the browser for shadowing |
| `src/lib/shadowScoring.ts` | Combines transcript and acoustic signals; caps transcript-only takes |
| `src/lib/pageAiContext.ts` | The structured assistant context payload |
| `src/lib/videoFrameExtractor.ts` | Frame sampling for OCR at upload time |
| `src/lib/audioChunk` / `audioToWav` / `audioClipper` | Client audio handling |
| `src/lib/ankiImport/` | Anki `.apkg` import via `sql.js` |
| `src/lib/parseLessonXlsx.ts` | Lesson spreadsheet import |
| `src/lib/rbac.ts` | `MANAGED_ROLES`, admin path allow-lists |
| `src/lib/serviceWorker.ts` | Registers `public/sw.js` in production builds only |

## 10. Data model

119 tables, 2 views, 12+ RPCs. Grouped:

| Domain | Tables |
| --- | --- |
| **Identity & access** | `profiles`, `user_roles`, `pending_role_grants`, `access_credentials`, `invite_codes`, `invite_redemptions`, `institutions`, `subscribers`, `referral_codes`, `referral_redemptions` |
| **Vocabulary & SRS** | `vocabulary_words`, `user_vocabulary`, `word_reviews`, `review_log`, `topics`, `user_difficulty`, `anki_import_batches`, `dialect_word_frequency`, `vocab_concepts`, `concept_realizations` |
| **Phrases** | `set_phrases`, `set_phrase_occasions`, `user_set_phrases`, `set_phrase_quiz_attempts`, `user_phrases` |
| **Curriculum** | `curriculum_stages`, `lessons`, `lesson_progress`, `lesson_clips`, `curriculum_concepts`, `curriculum_generation_log`, `curriculum_chat_*`, `learning_paths`, `content_concept_links` |
| **Video & transcripts** | `discover_videos`, `video_likes`, `video_ratings`, `video_views`, `processed_videos`, `trending_video_candidates`, `saved_transcriptions`, `transcript_line_reviews`, `transcript_line_revisions`, `transcript_line_comments`, `asr_engine_corrections` (view) |
| **Clip pipeline** | `content_channels`, `channel_videos`, `caption_lines`, `clip_candidates`, `published_clips` |
| **Content** | `authentic_stories`, `authentic_story_lines`, `interactive_stories`, `story_scenes`, `story_progress`, `reading_passages`, `daily_vocab_stories`, `listen_episodes`, `listen_line_audio`, `listen_episode_plays`, `meme_posts`, `picture_scenes`, `picture_scene_hotspots`, `bible_lessons`, `conversation_scenarios`, `content_requests`, `content_import_logs` |
| **Dialect quality** | `dialect_rules`, `dialect_rule_violations`, `dialect_corpus_sentences`, `dialect_native_reviews`, `msa_transformation_rules` |
| **Learner model** | `learner_errors`, `learner_ai_memory`, `user_concept_mastery`, `placement_results`, `placement_history`, `content_embeddings` |
| **Assessment & practice** | `grammar_exercises`, `listening_exercises`, `monologue_attempts`, `shadow_attempts`, `user_perception_progress`, `user_letter_progress`, `user_checkpoint_progress`, `user_picture_scene_progress` |
| **Gamification & social** | `user_xp`, `achievements`, `user_achievements`, `challenges`, `daily_challenges`, `daily_challenge_completions`, `review_streaks`, `weekly_goals`, `weekly_recommendations`, `user_follows`, `vocab_battles`, `vocab_game_sets`, `leaderboard_profiles` (view) |
| **Social harvest** | `social_content_sources`, `social_posts`, `trending_topics` |
| **Ops** | `llm_usage_logs`, `feature_metrics`, `feature_alerts`, `client_errors`, `beta_feedback`, `training_examples`, `usage_counters`, `voice_usage`, `daily_new_card_counts`, `human_review_requests`, `native_feedback_requests`, `native_feedback_credits`, `push_subscriptions`, `audio_files` |

**Key RPCs:** `has_role`, `is_grantable_role`, `is_access_id_role`,
`admin_grant_role_by_email`, `admin_list_managed_roles`,
`admin_list_pending_role_grants`, `admin_find_user`, `match_content`,
`record_checkpoint`, `search_caption_lines`, `increment_usage_counter`,
`increment_listen_play_count`.

**Triggers worth knowing:** `review_log` is trigger-populated (never
client-written); `on_auth_user_created_apply_roles` claims matching
`pending_role_grants`; `guard_admin_role_removal` is a `BEFORE DELETE` on
`user_roles` refusing an interactive caller revoking their own admin row or the
last remaining one (service-role callers and account-deletion cascades are
deliberately exempt); `reap_stuck_video_transcriptions` is the pipeline's last
resort.

**Storage buckets:** `video-audio` (private, staged pipeline audio +
checkpoints), `flashcard-audio`, `flashcard-images` (includes
`video-stills/`), `listen-audio` (public), `avatars` (public),
`tutor-audio-clips`, `meme-uploads`, `feedback-screenshots`.

## 11. Edge function catalogue

117 functions. By domain:

**AI orchestration & assistant (9):** `assistant-chat`, `assistant-tools`,
`free-chat`, `curriculum-chat`, `hf-chat`, `realtime-session-token`,
`how-do-i-say`, `culture-guide`, `dialect-compare`

**Transcription & video pipeline (16):** `process-approved-video`,
`analyze-gulf-arabic`, `download-media`, `soniox-transcribe`,
`munsit-transcribe`, `deepgram-transcribe`, `fanar-transcribe`,
`discover-video-audio`, `ai-resegment-transcript`, `resync-transcript-timing`,
`extract-visual-context`, `reextract-on-screen-text`, `rate-video-cefr`,
`persist-video-thumbnail`, `ingest-shared-video`, `discover-trending-videos`

**Review & content quality (8):** `transcript-review`,
`record-transcript-corrections`, `draft-dialect-rules`,
`dialect-violations-digest`, `vet-corpus-sentences`, `mine-dialect-corpus`,
`report-content`, `screen-shared-content`

**Translation & language tools (9):** `translate-text`, `translate-phrase`,
`ask-translation`, `convert-to-fusha`, `backfill-literal-translations`,
`translate-story-dialect`, `camel-analyze`, `farasa`, `derive-word-frequency`

**Speech (8):** `azure-pronunciation`, `azure-tts`, `elevenlabs-tts`,
`munsit-tts`, `tts-speak`, `pronunciation-feedback`, `score-shadow-attempt`,
`score-monologue`

**Content generation (24):** `generate-story`, `generate-story-cover`,
`generate-story-full-audio`, `generate-story-preview-audio`,
`generate-story-video`, `generate-story-video-full`,
`generate-suggested-story-text`, `edit-story-scene-image`,
`generate-daily-story`, `import-authentic-story`, `suggest-stories`,
`generate-listen-script`, `generate-listen-audio`,
`generate-listen-line-audio`, `reading-passage`, `reading-qa`, `souq-news`,
`souq-news-quiz`, `daily-challenge`, `phrase-of-the-day`,
`generate-sample-sentences`, `generate-flashcard-image`, `generate-mnemonic`,
`pregenerate-daily`

**Practice & assessment (12):** `grammar-drill`, `record-grammar-outcome`,
`listening-quiz`, `placement-quiz`, `writing-coach`,
`practice-sentence-coach`, `practice-chunk-coach`, `monologue-prompts`,
`mistake-drill`, `generate-set-phrase-quiz`, `score-set-phrase-voice`,
`request-situation-phrases`

**Vocabulary & enrichment (8):** `word-enrichment`, `enrich-word-roots`,
`suggest-flashcards`, `persist-word-audio`, `seed-set-phrases`,
`extract-concepts`, `extract-grammar-points`, `draft-concept-realizations`

**Clip pipeline (5):** `harvest-channel-videos`, `index-channel-captions`,
`mine-clip-candidates`, `verify-clip-candidate`, `publish-verified-clips`

**Learner model (4):** `extract-learner-errors`, `embed-content`,
`learn-from-metric`, `classify-tutor-segments`

**Social & discovery (4):** `harvest-social-trends`, `scrape-x-post`,
`discover-feed`, `analyze-meme`

**Jingles & audio extras (2):** `generate-word-jingle`,
`generate-phrase-jingle`

**Access, billing, ops (8):** `access-credentials`, `create-checkout`,
`check-subscription`, `customer-portal`, `referral`, `bible-passage`,
`native-feedback`, `notify-due-reviews`

### Shared modules (`_shared/`, 76 files)

| Module | Job |
| --- | --- |
| `aiBrain.ts` | The orchestrator: `askBrain()` / `streamBrain()`, four strategies, latency budget, repair pass |
| `aiGateway.ts` | Provider routing off vendor prefix; `chatFetch` / `chatFetchDetailed` / `generateImage`; OpenRouter fallback on 400/401/403/404/408/5xx (**not** 429); `canFallBack` encodes that Fanar has no OpenRouter twin |
| `modelRegistry.ts` | `MODEL_IDS`, `MODEL_LINEUPS` (TRANSLATION/CONTENT/UTILITY/REASONING), `IMAGE_MODEL_IDS`, `MODEL_WEIGHTS` |
| `msaLeakDetector.ts` | Normalisation + hardcoded leak lists + rulebook-derived forbidden tokens + per-dialect always-allowed |
| `dialectHelpers.ts` | Dialect Rulebook cache (5-min TTL), identity prompt, vocab rules, few-shot examples, forbidden tokens; hardcoded fallbacks on cache miss |
| `dialectValidator.ts` | Gemini Pro judge + Mistral Saba Arabic second opinion + Fanar tie-breaker |
| `dialectSubvarieties.ts` | Country → sub-variety taxonomy |
| `grammarTaxonomy.ts` | Canonical grammar concept keys shared by both writers |
| `conceptMasteryCore.ts` / `conceptMastery.ts` | Pure mastery ladder + IO |
| `learnerProfile.ts` / `learnerProfileCore.ts` | Server-assembled learner profile |
| `learnerMemory.ts` / `learnerMemoryCore.ts` | Cross-session notes |
| `pageContextCore.ts` | Assistant context rendering, budgeting, `windowDocument` |
| `contentRetrieval.ts` / `contentRetrievalCore.ts` | Embedding retrieval with similarity floor |
| `assistantTools.ts` / `assistantToolsCore.ts` / `assistantToolRouter.ts` | Tool definitions and the chat pre-flight router |
| `visualTimelineCore.ts` / `onScreenText.ts` | On-screen overlay timing and the transcript split |
| `arabicSpeechGate.ts` | The not-Arabic gate |
| `transcriptTimingAlign.ts` | Anchored LIS alignment between merged text and ASR word stream |
| `transcriptDiffCore.ts` / `transcriptRevisionCore.ts` | Training pairs vs. structural audit trail |
| `fushaBridge.ts` | Fusha prompt, parsing, alignment, change comparison |
| `pronunciationScoringCore.ts` | Azure rescoring |
| `fluencyMetricsCore.ts` | Speech/articulation rate, mean length of run, pause inventory |
| `usageCap.ts` / `voiceBudget.ts` / `voiceBudgetCore.ts` | Caller resolution, tier, daily caps, voice minutes |
| `cors.ts` | `ALLOWED_ORIGINS` allow-list — never `*` |
| `accessCodeCore.ts` | ID↔address mapping + credential generation, imported verbatim by browser and function |
| `ttsVoiceRouting.ts` / `ttsVoiceRoutingCore.ts` | Dialect→voice chain |
| `thumbnailUrlCore.ts` / `thumbnailMirror.ts` | Signed-URL detection and mirroring |
| `llmUsageLogger.ts`, `msaViolationLogger.ts`, `trainingExampleLogger.ts`, `featureMetrics.ts` | Fire-and-forget sinks; swallow their own errors |
| `camelDialect.ts`, `farasa.ts`, `aldiSignal.ts`, `arabicMatch.ts`, `arabicDiacritics.ts`, `arabicRoot` | Arabic NLP |
| `audioChunk.ts` | `planAsrPayloads` — frame-boundary splitting for size-limited engines |
| `requireRole.ts`, `requireEnvVars.ts`, `safeFetch.ts`, `errorResponse.ts`, `logError.ts` | Cross-cutting guards |

## 12. AI orchestration internals

**`askBrain(task)`** flow:

1. `buildSystemParts()` splits the system prompt at its cache boundary: dialect
   identity + Rulebook + demonstrations (stable, cacheable) **strictly before**
   `systemPromptExtra` (volatile, per-learner). Anything volatile placed earlier
   invalidates the cache on every call.
2. Strategy from `task.strategy` or `pickStrategy(purpose)`.
3. Per-call timeouts plus a whole-task wall-clock deadline that retries, critic
   passes and repair passes check before starting. A **timeout** jumps straight
   to the fallback chain (re-rolling a model that just ran out of clock buys
   nothing); a **malformed response** re-rolls the same model once with lower
   temperature and a nudged prompt first.
4. `scanLeaks()` over the produced Arabic; on a leak, one `runRepair()` pass
   naming the offending tokens.
5. Optional `validateDialect()`.

**Strategies:** `runSolo`, `runEnsemble` (weighted Jaccard clustering),
`runDraftCritic`, `runCouncil`.

**`streamBrain(task)`** is the SSE counterpart for chat. It has **no tool
loop** — chat reaches tools through the pre-flight `assistantToolRouter.ts`,
while voice declares them on the Realtime session and relays through
`assistant-tools`.

**`getDialectDemonstrations`** is the front half of the MSA fight. Set
`skipDemonstrations` only for tasks emitting no Arabic prose (routing, triage) —
a narrower question than `skipRepair`. `dialect_demonstrations_test.ts` asserts
the demonstrations are leak-free under the detector's own lists.

**Translation ensemble** (in `analyze-gulf-arabic`): Gemini + Claude at weight
1.0, Qwen at 0.5, per-line winner by weighted Jaccard clustering; Gemini+Claude
agreement always wins. Outcomes are recorded as `ensemble_disagreement`,
`call2_fallback`, or `empty`. Disputed lines go to Fanar Shaheen-MT, batched,
metered against a 20/day quota (default 16 for headroom) in `fanar_usage`.

**The Fusha pass is a separate call by design.** The ensemble clusters
candidates by *English* token overlap; folding a Fusha rendering into that
prompt would make the models' Arabic hostage to a vote about their English.

## 13. The transcription pipeline in detail

**Stages and checkpoints.** `process-approved-video` runs as a chain of short
requests to itself, each writing `video-audio/<id>.pipeline.json` before handing
over:

```
asr       acquire audio → 6 engines in parallel → speech gate → pick primary → checkpoint
analyze   fire analyze-gulf-arabic → watch the row for analysis_complete
finalize  align lines to audio → strip on-screen text → mark completed → rate-video-cefr
```

Three resume paths: the function itself (`{ videoId, stage }`, up to 3 analysis
starts then failed with a message); `analyze-gulf-arabic` calling back
`{ videoId, stage: "finalize" }` once its result is saved; and the admin pages
via `usePipelineResume` (`src/lib/pipelineResume.ts`) sending
`{ videoId, resume: true }`. Live runs heartbeat the row every 30s, so 2 minutes
without an `updated_at` change is a dead worker. `pending` is left alone for 10
minutes because the form holds a row there during a large upload. The finalising
write is conditional on the row still being where the stage expects it, so the
poll and the callback racing produce one transcript and one rating.

**Diagnostics.** `engines_used.pipeline` carries `stage`, `note`, analysis
`attempt`, `inline` (a hop was refused), `at`, and `build`. `src/lib/pipelineProgress.ts`
is the pure reader. The build marker also rides on every HTTP reply. The one
function in this pipeline with `verify_jwt = true` is `process-approved-video`
itself — a non-JWT service-role key is rejected at the gateway, which is what
"running without stage checkpoints" means.

**ASR leg contract** (`_shared/asrConfig.ts`): every leg returns
`{ text, words?, latencyMs, error? }`. `error` is how a leg reports failure;
an empty transcription and a short transcription both carry a cause string, so
`chars: 7` is never a silent success.

**Engine specifics:**

| Engine | Notes |
| --- | --- |
| Soniox | v5 pinned (v4 retired 2026-06-30). `language_hints: ["ar","en"]` — this corpus is heavily code-switched and `["ar"]` suppressed English tokens. Diarization + context biasing + one-way EN translation, each stripped in a retry ladder so a schema rejection cannot take the leg down. Sub-word tokens merged to words; some tokens omit `end_ms` on a phrase's first sub-word, so `start_ms` is the lower bound |
| Munsit | Sync endpoint only; silently returns empty above ~10 MB, so payloads are split on real frame boundaries at 9 MB (`planAsrPayloads`) and stitched with offsets. Model defaults to `munsit-en-ar` — the bare `munsit` model is degraded upstream and answers 200 with a handful of characters for any payload. The multipart part is named after the container the bytes actually are, because Munsit dispatches on extension |
| ElevenLabs Scribe v2 | Replaced the Deepgram nova-3 leg. Spacing/audio-event entries filtered out. Same key as TTS |
| Fanar | `Fanar-Aura-STT-1` under ~20–30s, `Fanar-Aura-STT-LF-1` for long form; both metered in `fanar_usage` |
| Azure | Locale by dialect module: `ar-EG` / `ar-YE` / else `ar-SA`. Honours `AZURE_SPEECH_ENDPOINT` over region |
| Cohere | Pilot; entire leg skipped when `COHERE_API_KEY` is unset |

**Primary pick:** median char length over the Arabic-aware candidates
(Munsit, Soniox, Scribe, Cohere, Fanar), drop anything under 50% of median,
longest survivor wins, `PRIORITY` as tie-break. Azure is the fallback when
nothing Arabic-aware produced text. Alignment words come from the primary's own
words if present, else Soniox → Munsit → Scribe, else the proportional fallback.

**Provenance** lands in `engines_used`: `.asr` (per-engine chars/latency/model/
errors), `.translation`, `.dialect_signals`, `.fusha`
(status/model/`lines_filled`/`lines_total`), `.diacritization`, `.pipeline`.
`analyze-gulf-arabic` read-merges into the same JSONB.

**Timing.** `_shared/transcriptTimingAlign.ts`: normalise both streams with the
`arabicMatch` folding, anchor on words unique to both, keep monotone by longest
increasing subsequence, fill gaps with exact/fuzzy/split-merge matching,
interpolate the rest. Per-word times persist on the line as `words`, parallel to
the whitespace split of `arabic`, each flagged `matched` or interpolated. Too
few matches → proportional-by-character allocation, and deliberately **no**
`words` array so nothing can be mistaken for real times. The player keeps
`LINE_END_GRACE_MS = 500` past each line's end; the reverse scan means a started
line always beats its predecessor's grace.

**Forced re-alignment.** `resync-transcript-timing` sends the editor's current
lines (unsaved draft included) plus the staged audio to ElevenLabs' forced
alignment, maps the timed words back through the same anchoring module, and the
proposal lands in the diff preview. It refuses audio that doesn't fit the
transcript (match-ratio trust gate). Accepting persists via `save_lines` with
revision source `resync`, distinguishable in history from a human edit.
`save_lines` refuses NaN timings, a line ending before it starts, and a
backwards timeline; gaps between lines are legal.

**Thumbnails.** TikTok/Instagram stills are signed URLs with ~48h `x-expires`.
`persist-video-thumbnail` mirrors them into `flashcard-images/video-stills/`
while the signature is good. It must be a function, not page code: the CDNs
serve those bytes with no `Access-Control-Allow-Origin`. `thumbnailUrlCore.ts`
(shared by browser and Deno) decides which URLs are on loan (`x-expires`, and
Meta's hex `oe=` on Meta hosts). Content type is checked before upload — an
expired signature answers 200-shaped enough to be dangerous. YouTube is
re-derived from the video id at render time and never stored.

## 14. Scheduling: FSRS-6

`src/lib/spacedRepetition.ts` implements FSRS-6 line-for-line from fsrs-rs,
21 weights. Column mapping: `ease_factor` → stability S, `difficulty` → D (1–10),
`interval_days` → last scheduled interval, `repetitions` → graduated reviews.

Three properties that must not be "simplified" back toward FSRS-4.5 or SM-2:

- **Same-day formula:** `S' = S · e^(w17·(G−3+w18)) · S^(−w19)`, floored at ×1 on
  a success. Without it, retrievability ≈ 1 collapses the growth term and
  Hard/Good/Easy produce identical intervals.
- **Post-lapse cap:** stability after forgetting is capped at `S / e^(w17·w18)`,
  strictly below the pre-lapse value.
- **Trained forgetting-curve decay `w20`:** `R(t,S) = (1 + factor · t/S)^(−w20)`.

`ScheduleOptions.weights` takes a fitted vector from `profiles.fsrs_weights`;
`calibrationMultiplier` is the cold-start path. `review_log` is
trigger-populated because three separate code paths write a schedule
(`useReview.ts`, `useSetPhrases.ts`, `Review.tsx` relearn) and a client-side
logger would miss any future writer.

Set phrases carry the same seven `production_*` FSRS columns on
`user_set_phrases`; `buildPhraseReviewRow` in `useSetPhrases.ts` is the pure
grading function.

## 15. Access control and roles

`public.user_roles`, admin-writable only, checked through the `has_role` RPC —
**never** by reading the table client-side.

`app_role` enum: `admin`, `user`, `content_reviewer`, `recorder`, `beta_tester`,
`bible_reader`, `complimentary`, `transcriber`.

`useAdminAuth` collapses staff roles to
`admin | content_reviewer | recorder | transcriber | null`. `bible_reader` is
overridden when the user is also `content_reviewer`.

**Adding an enum value takes two migration files** — Postgres will not use a
value in the transaction that added it — and touches `src/lib/rbac.ts`
(`MANAGED_ROLES` drives the grant UI), `useAdminAuth`, the generated types,
`src/test/support/personas.ts`, `src/test/support/server/rpc.ts`, and the route
manifest.

Path allow-lists: `canAccessContentReviewerAdminPath`,
`canAccessTranscriberAdminPath` in `src/lib/rbac.ts`, enforced by `AdminLayout`.
`src/test/routeManifest.test.ts` calls those functions directly, so a route
cannot be marked reachable by a role rbac.ts does not admit.

**Grants by email** (`admin_grant_role_by_email`) return `granted` / `already` /
`pending` / `invited` / `not_found` — the last now only reachable by UUID, since
an email with no account becomes a `pending_role_grants` invitation claimed by
the `on_auth_user_created_apply_roles` trigger at signup. Addresses stored and
matched lowercased. `src/lib/roleGrants.ts` holds the pure outcome mapping.
`recorder` is deliberately not in `MANAGED_ROLES`. SQL mirror:
`public.is_grantable_role`, filtered by both the grant and listing functions.

**ID logins.** `ACCESS_ID_ROLES` = `transcriber`, `content_reviewer` only —
mirrored by `public.is_access_id_role`, which is what actually refuses the write.
`admin` must never be one: the credential is minted by someone else and sent
over a chat app. Password shown once, stored nowhere readable;
`access_credentials` records only when it was last set. Recovery is an admin
pressing *New password*. Switching one off **bans the account and deletes the
role row** — either alone leaves a live hole. Failure ordering in `create`
rolls back the auth account if the registry row or role grant fails after it.

`guard_admin_role_removal` (BEFORE DELETE on `user_roles`) refuses an
interactive caller revoking their own admin row or the last remaining one.
Exempt: service-role callers (no `auth.uid()`) and the account-deletion cascade.

## 16. Spend, caps and abuse controls

Cross-cutting concerns every model-calling function must respect:

- `_shared/usageCap.ts` — `resolveUserId(req)`, `getSubscriptionTier`,
  `requireActiveSubscription`, `enforceDailyCap(req, feature, limit, cors)`.
  Anonymous → 401. Paid `subscribers` row bypasses. `hasComplimentaryAccess`
  treats `complimentary` and `admin` exactly as All-In. Fails **closed** (free
  tier) on error. One Supabase client cached per isolate.
- `_shared/voiceBudget.ts` / `voiceBudgetCore.ts` — monthly seconds by tier
  (free 1800, standard 7200, allin 18000), UTC calendar-month window, client
  report clamped to `MAX_REPORT_SECONDS = 7200` so a forged report costs at most
  one two-hour call.
- `_shared/cors.ts` — `ALLOWED_ORIGINS` allow-list, never `*`.
- Stripe IDs guarded by `src/test/stripeIds.test.ts`.
- Provider quotas: Fanar MT 20/day (default budget 16), Fanar STT 18 and 8/day,
  all metered in `fanar_usage`.
- Read-tool URL allow-list holds **exact addresses**, not domains or prefixes.

## 17. Testing and CI reference

**Five layers:**

| Layer | Runner | Location | Count |
| --- | --- | --- | --- |
| Unit | Vitest | `src/**/*.test.ts` | part of 370 |
| Component | Vitest + Testing Library | `src/**/*.test.tsx` | part of 370 |
| End-to-end | Playwright | `e2e/**/*.spec.ts` | 84 specs |
| Edge runtime | `deno test` | `supabase/functions/_test/` | 93 files |
| Schema contract | Vitest (+ Postgres) | `src/test/`, `contract/` | 2 checks |

**The production-database guard — four layers, none removable casually:**

1. `vitest.config.ts` `test.env` → fake host `https://e2e.supabase.co`
   (deliberately **not** mirroring `vite.config.ts`'s fallback logic).
2. `playwright.config.ts` `webServer.env` → same fake host,
   `reuseExistingServer: false`.
3. `e2e/support/globalSetup.ts` refuses to start if (2) did not take effect.
4. `src/test/setup.ts` replaces `fetch` with one that throws.

`src/test/envGuard.test.ts` asserts all four and drives the globalSetup guard
with configs it must reject.

**Drift guards** (they fail when you *add* code):

| Guard | Rule |
| --- | --- |
| `edgeFunctionCoverage` | Every dir in `supabase/functions/` named by a file in `_test/` |
| `libCoverage` / `hookCoverage` / `sharedModuleCoverage` | Every module named by some test; short reasoned exemption lists |
| `routeManifest` | Every `<Route>` in `App.tsx` has an entry in `src/test/support/routes/manifest.ts` |
| `routeReachability` | Every learner route has an in-app link or a `NO_LINK_NEEDED` entry with a written reason |
| `grammarTaxonomy` | Parses the migration; fails on drift from the module's keyword table |
| `typesDrift` | Generated-types drift allow-list vs. the migrations that caused it |
| `modelRegistry` | No hardcoded model id; no stale allow-list entry |
| `stripeIds` | Price/product IDs |

**Coverage** is gated per-directory (`src/components/**`, `src/hooks/**`,
`src/lib/**`, `src/contexts/**`) — `src/pages/**` is Playwright's job and would
drag any global figure to a meaningless floor. Thresholds sit a couple of points
under measured and are a ratchet.

**Lint ratchet.** `scripts/lint-ratchet.mjs` pins `BASELINE` — **528** at the
time of writing. Lower it in the same commit that reduces the count; the script
prints the new number. Note that three other places in the repo cite a different
figure (`CLAUDE.md` says 530, `docs/testing.md` ~548, `.github/workflows/ci.yml`
~596); the script is the only one that is enforced.

**The in-memory Supabase backend** (`src/test/support/`) is a real PostgREST
emulator: parses the query, applies filters/ordering/limits/counts, persists
writes, implements RPCs and edge functions (`server/`, `postgrest/`,
`factories/`, `personas.ts`), reached via `transports/vitest.ts` and
`transports/playwright.ts`. It derives its schema from
`src/integrations/supabase/types.ts` and **rejects unknown columns exactly as
PostgREST does**. Every Playwright worker gets its own database.

**The edge harness.** Every function calls `serve()`/`Deno.serve()` at module
scope and exports nothing. `_test/harness.ts` intercepts both — a test-only
import map redirects the std http server to `serveShim.ts`, and `Deno.serve` is
monkey-patched before the dynamic import. `loadFunction(name)` returns the
handler with ~30 fake secrets and every outbound `fetch` routed; an unrouted
call **throws**. The import map is passed with `--import-map`, deliberately not
in a `deno.json`, so `deno check` still sees the real std module. The routing
`fetch` is installed once and never swapped (usageCap caches its client at
module scope); `restore()` clears the route table instead.

**CI jobs:** `check` (typecheck app + e2e trees, lint ratchet, coverage, build),
`edge` (Deno pinned to v2.9.5, `deno check` with a 5-attempt network retry
ladder, then `npm run test:edge`), `contract` (migration replay against
`postgres:16` with `contract/prelude.sql`), `e2e` (Chromium, 4 shards,
report uploaded on failure).

**Time.** Anything branching on wall-clock (`spacedRepetition`, `reviewQueue`,
`todayCompletion`, `useNewCardBudget`, streaks, `xp_today_date`) must freeze it:
`vi.setSystemTime` / `page.clock.install()`, at an instant that is neither
midnight nor a DST boundary.

**Dialect eval.** `scripts/eval-dialect-live.ts` — `--compare <model>` prints
per-dialect leak-rate deltas (run before a registry bump ships); `--no-demos`
drops the worked examples so their value is measured on *this* golden set. Needs
real keys; manual, not CI.

## 18. Configuration and secrets

**Client (`VITE_*`, bundled — never secrets):** `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
`VITE_VAPID_PUBLIC_KEY`, `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`.

**Edge function secrets:**

| Group | Keys |
| --- | --- |
| LLM | `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `FANAR_API_KEY`, `DIALECT_VALIDATOR_CROSSCHECK`, `REALTIME_VOICE_YEMENI` |
| Speech | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, `AZURE_SPEECH_ENDPOINT`, `ELEVENLABS_API_KEY`, `ELEVENLABS_TTS_MODEL`, `ELEVENLABS_STT_MODEL`, `SONIOX_API_KEY`, `MUNSIT_API_KEY`, `MUNSIT_ASR_MODEL`, `MUNSIT_TTS_MODEL_ID`, `MUNSIT_*_VOICE_IDS`, `TTS_PROVIDER_*`, `TTS_ALLOW_SINGLE_VOICE_EPISODES`, `COHERE_API_KEY`, `COHERE_STT_MODEL`, `DEEPGRAM_API_KEY` |
| NLP | `FARASA_API_KEY` (required — the WebAPI no longer serves anonymous traffic), `HUGGINGFACE_API_KEY`, `ALDI_HF_MODEL`, `JINA_API_KEY` |
| Media/content | `YOUTUBE_API_KEY`, `SUPADATA_API_KEY`, `FIRECRAWL_API_KEY`, `COBALT_API_KEY`, `RAPIDAPI_KEY`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `SOCIAL_HARVEST_SECRET` |
| Payments | `STRIPE_SECRET_KEY` |
| Push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| Security | `ALLOWED_ORIGINS` |

Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` at runtime.

**Scheduled work** (Supabase dashboard → Cron; nothing in-repo fires it):
`notify-due-reviews` hourly, `harvest-social-trends` daily with the
`x-harvest-secret` header, `pregenerate-daily`.

## 19. Known gaps and pinned baselines

Recorded as baselines rather than fixed, so they cannot get worse:

- **7 of the migrations do not replay from scratch** — five create something an
  earlier migration already created; two reference tables nothing creates.
- **Three tables exist in production but in no migration:** `processed_videos`,
  `review_streaks`, `subscribers`. `subscribers` is the significant one —
  `usageCap.ts` reads it to decide paid status, so on a rebuilt database every
  user would look free-tier. Fixing this needs a schema dump, not a guess.
- **The lint ratchet baseline** carries a few hundred `no-explicit-any` errors in
  app code.
- **`persist-video-thumbnail` was recorded as not deployed** in the last QA map
  run — verify before trusting thumbnail durability.
- **ALDi is log-only.** Compare it against native-review outcomes before making
  either signal a gate.
- **AL-QASIDA covers neither of two of our three dialects properly** — Gulf only
  as Kuwaiti/Najdi, Yemeni not at all.
- **Fire-and-forget sinks can stop working silently** by design.

## 20. Operational runbooks

**A transcription is stuck.** Open the video's edit page and read the pipeline
line. Unfamiliar/missing `build` → redeploy `process-approved-video` and
`analyze-gulf-arabic`. "running without stage checkpoints" → the service-role
hop is being refused at the gateway; check the key is a JWT. A named step whose
"last moved" advances → alive, just slow. Otherwise the admin page's resume
fires automatically after 2 minutes of no movement; `reap_stuck_video_transcriptions`
is the backstop.

**A video's thumbnail broke after two days.** The row is holding a signed URL.
Run the "Find N missing thumbnails" backfill on `/admin/videos` — it counts a
signed still as missing.

**A dialect started sounding formal.** Run
`scripts/eval-dialect-live.ts --compare <previous model>` per dialect, and
`--no-demos` to confirm the demonstrations still earn their tokens. Check
`/admin/dialect-rules` for a recently approved rule whose bad examples poisoned
the forbidden-token list.

**Yemeni TTS needs to change.** Set `MUNSIT_YEMENI_VOICE_IDS` to a cloned voice
(the only way to reach a clone — Munsit returns null tags on cloned voices, so
discovery can never find one), or `TTS_PROVIDER_YEMENI=azure` to roll back.

**A reviewer is locked out.** `/admin/id-logins` → *New password*. There is no
inbox a reset link could reach.

**Regenerating the QA map:** see `qa/README.md` — build `dist/`, run the crawl
and resilience/media specs against it, then `report.mjs`, `build-map.mjs`,
`gallery.mjs`. Hand-edit `qa/flows.md` only.

---
---

# Part Three — Marketing portfolio

## 21. Brand foundations

**Name.** **Hakiya** — from **حكاية** (*ḥikāya*), "a story". Pronounced
*ha-KEE-ya*. The name carries the product thesis: language arrives as stories
people tell, not as tables people memorise.

**Domain.** `hakiya.app`

**Predecessor name.** *Lahja* (لهجة, "dialect") — retired, but still visible in
internal code names, the design system's motion language, and some asset
filenames. Do not use it externally.

**One-line positioning.**
> Hakiya teaches the Arabic people actually speak — Gulf, Egyptian and Yemeni —
> from real clips, checked by native speakers.

**The category we are in.** Dialect-first spoken Arabic. Not "Arabic learning"
generically, and explicitly not Modern Standard Arabic.

**The three brand pillars.**

1. **Real Arabic.** The material is media real people made for other Arabs. Not
   scripted, not slowed down, not sanitised.
2. **Checked by natives.** Paid native speakers correct the machine, and the
   audit trail is built so nobody — including the reviewer — can fake it.
3. **Honest about what it knows.** Where there is no evidence, we do not invent
   a score. Where a measurement cannot support a claim, we do not make it.

**What we will not do**, stated as brand commitments because they are already
enforced in the product:

- We will not teach Modern Standard Arabic and call it Arabic.
- We will not show a number that we cannot defend.
- We will not put a paywall between a learner and their own progress.

---

## 22. Brand voice

The voice already exists in the product's own copy. It is consistent enough to
codify.

### The rules

| Rule | Why | Example from the product |
| --- | --- | --- |
| **English is the chrome; Arabic is the material.** | Everything the app *says* is in English so the Arabic on screen is unmistakably the thing being learned. | Skill names carry their Arabic underneath, small — Listen / استماع — never instead. |
| **Say the thing, then say why.** | Every explanation earns trust by showing its reasoning. | "Rate each card honestly — we'll resurface it at just the right moment so it sticks for good." |
| **Second person, present tense, active.** | It is a coach, not a brochure. | "Say a line, hear exactly what to fix." |
| **Concrete over abstract.** | Nouns you can picture beat category words. | "Headlines retold in dialect", not "authentic news content". |
| **Short sentences. Em dashes for the turn.** | The house rhythm. | "Talk for a stretch, watch your fluency move." |
| **Promise practice, never speed.** | The evidence supports the first and not the second. | Speaking copy never claims faster fluency. |
| **Reassure plainly on money and data.** | Anti-dark-pattern, and it is true. | "Always. Your streak, XP, saved words, and review history are tied to your account, not your plan." |
| **Arabic and Gulf cultural terms used correctly, never as decoration.** | The audience will notice immediately if we get this wrong. | *majlis*, *sadu*, *souq*, *khaliji* — each used for what it actually means. |
| **No exclamation marks, no hype adjectives, no emoji in product copy.** | The product is confident; hype reads as compensation. | — |

### Tone by surface

| Surface | Tone |
| --- | --- |
| Onboarding | Warm, brief, low-commitment. "A 60-second setup… Skip anytime." |
| Daily plan | Encouraging, never guilt-tripping. Everything beyond the goal is "bonus reps" |
| Errors and mistakes | Non-judgmental and specific. Name what came out and what you were aiming for |
| Pricing | Flat, factual, generous. State the limit rather than hiding it |
| Empty states | Say what would fill it and offer the one action |
| Admin/reviewer | Direct and unadorned. These are colleagues, not customers |

### Words we use / words we avoid

**Use:** dialect · spoken Arabic · Gulf (Khaliji) · Egyptian · Yemeni · real
clips · native speakers · a story · practice · reps · your own history.

**Avoid:** fluent in X weeks · fluency guaranteed · master Arabic · effortless ·
game-changing · revolutionary · "AI-powered" as the headline (it is the
plumbing, not the promise) · MSA as a synonym for "Arabic".

---

## 23. Visual identity

### The palette

The brand guide names four colours. The app's design tokens are HSL custom
properties in `src/index.css` and are the source of truth; hex values below are
the rendered equivalents.

**Core four**

| Name | Hex | Role |
| --- | --- | --- |
| **Warm Sand** | `#E2C5A6` | The page. The app's ground colour — light, calm, breathable |
| **Desert Red** | `#8C4135` | The brand accent. Primary actions, links, focus rings |
| **Deep Desert** | `#44663D` | Success, growth, completion |
| **Charcoal** | `#323A36` | Secondary actions, ink |

**Working tokens (light theme)**

| Token | Hex | Use |
| --- | --- | --- |
| `--background` | `#E2C6A7` | Page |
| `--card` / `--card-cream` | `#FAF8F5` | Surfaces |
| `--primary` / `--accent` / `--ring` | `#80392E` | Actions. Deliberately darker than Desert Red — at the lighter value it measured 3.88:1 against the art-tinted sand, under the 4.5:1 floor |
| `--secondary` | `#394640` | Charcoal |
| `--success` | `#385832` | Deep Desert |
| `--destructive` | `#A51D1D` | A brick red that belongs to this palette; the stock bright red failed contrast twice over |
| `--muted-foreground` | `#48514D` | Second-line text — the most-used colour word in the app |
| `--desert-red` | `#6F332A` | Deep accent, borders |
| `--plum` | `#5B3945` | Welcome majlis, hub tiles, the MSA bridge |

**The ramp** — four steps, charcoal to Desert Red, one step apart. Used for the
skill tiles and the Me hub's section accents.

`--ramp-1 #2D3430` → `--ramp-2 #483732` → `--ramp-3 #703C33` → `--ramp-4 #8D4135`

**Dialect accents** — each dialect carries one.

| Dialect | Light | Dark |
| --- | --- | --- |
| Gulf | `#89301A` | `#E39B85` |
| Egyptian | `#D48D11` | `#E5A93F` |
| Yemeni | `#B62020` | `#DE6A6A` |

**Night majlis** (the dark theme) is not a port of the light theme. In light,
the brand colours are deep inks carrying white text; in dark they become the
*light* half of the pair and take a warm ink as their foreground. Background
`#1A1A1A`, cards `#242424`, primary `#D37769`. Every value is chosen as the
lowest lightness that clears 4.5:1 against the card surface, so accents stay as
saturated as accessibility allows rather than washing out to pastel.

**Theme colour for browser chrome:** `#F9F7F2`.

### Typography

| Role | Family | Notes |
| --- | --- | --- |
| Headings | **Montserrat** (600, 700) | |
| Body | **Open Sans** (400, 500) | |
| Arabic UI | **Noto Sans Arabic** (400–700) | |
| Arabic reading | **Noto Naskh Arabic** (400–700) | The naskh face for passages and scripture |

A locked type scale on a 1.25 ratio, with negative tracking on the large sizes
and wide tracking on the small ones:

`overline 11px` · `caption 12px` · `body-sm 14px` · `body 16px` ·
`subtitle 18px` · `title 24px` · `headline 32px` · `display 44px`

### Motion

One canonical easing curve, applied as the Tailwind default so every hover,
press and colour transition in the app shares it:

`cubic-bezier(0.16, 1, 0.3, 1)`

| Animation | Use | Duration |
| --- | --- | --- |
| `fade-up` | Content arrival — text, lists, panels | 360ms |
| `scale-in` | Cards, tiles, badges | 240ms |
| `slide-in` / `slide-in-bottom` | Sheets, drawers, overlays | 320ms |
| `shimmer` | Loading placeholders — a light sweeping in one direction, so a column of them reads as one surface arriving rather than several blinking | 1.6s |
| `bounce-gentle`, `wiggle` | Playful hints on flashcards only | — |

Corner radius: `1rem` base, with a scale from `sm` to `3xl`. Shadows are
deliberately very subtle — borders do the structural work.

### The mark and the pattern

The identity is built on **sadu** — the geometric Bedouin weaving of the Gulf.
It is used three ways:

- **The mark** is a speech-bubble glyph composited into a woven **sadu band**
  frame. It ships as two vector variants: `sand` (a sand disc behind the mark —
  the default, because the mark's outline is near-black and needs something light
  to be dark against) and `clear` (open middle, for surfaces that are already
  light). The mark is never baked into the frame, so the logo keeps one source of
  truth on disk and both variants follow a cleanup. A test fails if a frame ever
  grows an embedded image, and a second test pins the ratio between the band's
  inner edge and the mark — crowding the band is what makes a framed mark look
  like a sticker.
- **The border.** Pages wear a sadu band as a page border. Its rendered height
  is computed from the viewport rather than fixed, so content clears it at every
  screen size.
- **The play button** is a pressed weave: two charcoals about four percent of
  luminance apart (texture you sense rather than read), one crimson hairline at
  the rim, and a solid cream triangle as the only bright thing in the control.
  An earlier version put a loud full-weave disc behind the glyph; it was the
  better *object* and a worse button, because the pattern and the triangle
  competed for the same attention. A control you have to find is a broken
  control.

**Motion assets:** a campfire hero, a caravan hero and a loading emblem, all
shipped as `webm`/`mp4` with `webp` posters.

**Illustration.** Hand-painted watercolour scenes — the four skill tiles, the
dialect cards, the campfire — in one consistent hand. Illustrations are
generated through a locked house style rather than picked per-image.

### Layout principles observed in the product

- **Only the feed goes dark**, because only the feed is media. Every other page
  wears the warm sand ground and the sadu border.
- **Ink carries state, not icons.** On the Alphabet path, mastered letters sit
  at full weight, the current one takes Desert Red with a progress rule, and
  locked ones are ghosted but still legible.
- **Hubs are for doing, not reading.** Descriptions are what made the old hub
  pages long; the chooser replaced 44 look-alike rows with four unmistakable
  blocks.

---

## 24. The product story

**The problem.** Someone spends two years learning Arabic. They can read a
newspaper. They land in Riyadh, or Cairo, or Sanaa, and understand almost
nothing anyone says to them. The Arabic they learned is real Arabic — it is just
not the Arabic anyone speaks.

Meanwhile, every AI tool they reach for has the same bias baked in. Ask a
chatbot for Gulf Arabic and it drifts back to formal Arabic within a paragraph,
because that is what it was trained to consider correct.

**The insight.** The dialect problem is not a content problem, it is a
*verification* problem. Anyone can generate Arabic. The hard part is knowing
whether a real Gulf speaker would say it. So the whole product is built as a
verification chain: worked dialect examples in every prompt, a leak detector on
every output, a repair pass, an authenticity validator, and — at the end — a
paid native speaker with a workspace built to make their sign-off trustworthy.

**The product.** Real clips, transcribed by six engines and argued over by three
models, corrected by natives, tapped word by word into a memory system that
knows when you are about to forget, with a tutor that can see your screen and
your record.

**The proof.** Not a claim about speed. A claim about *material*: everything you
study is something a real person actually said, and someone who grew up speaking
that dialect has read it.

---

## 25. Features to benefits

| Feature | What it means for the learner | The benefit |
| --- | --- | --- |
| Three real dialects — Gulf, Egyptian, Yemeni — on every plan | You learn the Arabic of the place you are actually going | You can hold a conversation instead of reciting a newscast |
| Library of real social and media clips | The speed, slang and overlap of ordinary speech | Your ear is trained on the real thing from day one |
| Six speech engines + three translation models per clip | Fewer wrong words in what you memorise | You are not learning someone's transcription error |
| Paid native-speaker review with a tamper-proof audit trail | A human who grew up with the dialect has signed off | Trust — the one thing AI-only tools cannot offer |
| Tap any word to save it | Vocabulary comes from what you were actually curious about | You build a deck that is yours, not a stranger's word list |
| FSRS-6 flashcards, per-learner fitting | Reviews land at the moment you would forget | Less time reviewing, more retained |
| Recognition *and* production scheduled separately | The app knows the difference between "I understand it" and "I can say it" | You close the gap that strands most intermediate learners |
| Pronunciation scoring, recalibrated | A butchered sound is not scored 85 | Feedback you can act on rather than flattery |
| Sound Pairs perception training | You learn to *hear* ص vs س before trying to say them | The best-evidenced intervention in the app, and it plateaus — a finite programme, not a treadmill |
| Shadowing with ~5 reps and a score trace | You hear yourself converging on a native clip | Rhythm and prosody, not just words |
| Monologue with fluency metrics | Speech rate, pauses and run length trended against your own history | You can see fluency moving without a fake benchmark |
| AI tutor with full page context | Ask "what did he mean earlier?" and it knows what "earlier" was | It answers about *your* material, not about Arabic in general |
| Live voice conversation | Speaking reps with no social cost | The evidence is strong that this lowers speaking anxiety |
| Mistakes page + fossilization drill | Your recurring errors are surfaced and drilled deliberately | Errors that would otherwise fossilise get broken |
| Formal-Arabic (Fusha) row + MSA Bridge | Every line shown as the dialect *and* as the MSA you already know | Years of MSA study become an asset instead of a handicap |
| Share anything into the app | A voice note, a screenshot, a link, a meme — routed automatically | Everything you encounter in the wild becomes study material |
| Transcribe your own audio | Your tutor's lesson, a WhatsApp voice note, any video | The app works on your life, not just its own library |
| Alphabet path and Curriculum | Two structured routes for people who want a track | You are not staring at a blank library on day one |
| Word Clips for beginners | Every early word taught by a real 5–10 second clip | You never learn a word only as a card |
| Souq News, Stories, Reading Library, Episodes | Level-matched reading and listening generated on your own vocabulary | Comprehensible input that is actually comprehensible |
| Bible track | Scripture in Arabic with verse-by-verse translation | Serves a real, underserved audience |
| Streaks, XP, leaderboards, battles, daily challenge | Reasons to show up on a bad day | Consistency is the variable that actually predicts progress |
| Installs like an app, works partly offline | Cards and shell cached; the database never is | Study on a plane; log in safely everywhere |
| Evening-only, once-a-day, only-when-due notifications | The app does not nag | You keep it installed |
| Export your data, delete your account, erase tutor memory | Your record is yours | No lock-in |

---

## 26. Who it is for

### Primary: the MSA graduate who cannot have a conversation

Has done a university programme, an intensive, or years of self-study in
Modern Standard Arabic. Reads well. Freezes in a taxi. **Hakiya's Fusha row and
MSA Bridge are built for exactly this person** — every line shown as both, so
their existing knowledge becomes a ladder instead of an obstacle.

### Expats and professionals in the Gulf

Living in Riyadh, Dubai, Doha, Kuwait. Need Khaliji specifically, and every
mainstream app offers them Egyptian or MSA. They want to understand the majlis,
the office, the WhatsApp group.

### Egypt-bound learners

The largest dialect audience in Arabic learning, and the one with the most
media. Hakiya's advantage here is depth of verification rather than novelty.

### Yemeni learners — a genuinely unserved audience

Aid workers, diplomats, researchers, journalists, diaspora families. **There is
effectively no consumer product for Yemeni Arabic.** The published dialect
benchmarks do not even cover it. Hakiya covers it as a first-class dialect with
native reviewers and its own sub-variety taxonomy (Ṣanʿāni, Taʿizzi–ʿAdeni,
Tihāmi, Ḥaḍrami, Yāfiʿi, northern tribal).

### Heritage speakers

Grew up hearing the dialect, never learned to read or produce it. The alphabet
path plus real family-register clips is a much better fit than a beginner
course that starts from "hello".

### Faith and mission workers

The Bible track, the role-gated access, and the Yemeni/Gulf coverage serve a
community that is chronically underserved by consumer language apps.

### Researchers, journalists and analysts

People who need to *understand* dialect media rather than speak it. Transcribe,
Learn from X, the Meme Analyzer and the trending harvest are all aimed here.

### Institutions (a live opportunity, not yet a product)

The database already carries an `institutions` table. Universities, language
schools, NGOs and government programmes are a natural fit for a product with
CEFR placement, a C-test, a curriculum, and per-learner analytics.

---

## 27. Why an Arabic learner chooses Hakiya

The short version, in the order these actually land:

1. **It teaches the Arabic that gets spoken.** Every competitor either teaches
   MSA or offers one dialect as an afterthought.
2. **A native speaker has read the material.** Not "AI-generated content
   reviewed for quality" — a paid native reviewer with a keyboard-driven
   workspace, a per-line sign-off that goes stale when the line changes, and an
   audit trail their own browser cannot forge.
3. **It is built for the dialect problem specifically.** A leak detector, a
   repair pass, a rulebook that content staff maintain, and an evaluation
   script that measures dialect fidelity before a model upgrade ships. No
   general-purpose app has any of this, because no general-purpose app has this
   problem.
4. **It respects the MSA you already have.** The Fusha row is a conversion, not
   a translation — you see exactly which pieces the dialect changed. That is a
   feature nobody else ships, and it converts the most frustrated segment of
   Arabic learners in the world.
5. **Yemeni exists here and nowhere else.**
6. **It works on your own material.** Share a voice note from a friend, a
   screenshot of a menu, a TikTok, a recording of your tutor. It becomes a
   lesson.
7. **It measures honestly.** Pronunciation scores are recalibrated because the
   raw ones flatter. Shadowing is scored as closeness to a clip because a
   transcript cannot prove pronunciation. There are no invented fluency norms.
8. **It does not hold your progress hostage.** All three dialects on the free
   plan. Nothing locked or deleted on a downgrade. Export your data whenever you
   want.

---

## 28. Competitive positioning

| Against | Their strength | Our line |
| --- | --- | --- |
| **Duolingo-style apps** | Reach, habit design, polish | They teach MSA. You will finish the tree and still not understand a taxi driver |
| **General AI chatbots** | Free, instant, flexible | They drift to formal Arabic within a paragraph, and nothing checks them. Hakiya has a leak detector, a repair pass and a native reviewer behind every line |
| **Human tutors (iTalki etc.)** | Real people, real feedback | Complementary, not competing — Hakiya transcribes *your tutor's lesson* into flashcards. And it is there at 6am on a Tuesday |
| **Dialect-specific courses** | Genuine dialect focus | Fixed content that ages. Hakiya's library is what people posted this week, and it adapts to what you personally know |
| **Anki + your own decks** | Total control, the same algorithm | Hakiya *is* FSRS-6, plus the content, the audio, the native check, and separate production scheduling that a hand-built deck cannot do |

**Our defensible moat, honestly stated:** the verification chain and the
reviewer workforce. Anyone can generate dialect Arabic; almost nobody can prove
it is right, and nobody else is building the tooling that makes a native
speaker's sign-off trustworthy at scale.

---

## 29. Pricing and the offer

| | Free | Standard | All-In |
| --- | --- | --- | --- |
| **Price** | $0 | $5/mo · **$50/yr** | $15/mo · **$150/yr** |
| Positioning | "Get started with the basics" | "For serious learners" | "Unlimited everything" |
| Dialects | All three | All three | All three |
| Lessons, flashcards, Discover | Full | Full | Full |
| AI tools | Every tool, daily free limits | No daily limits | No daily limits |
| Live AI voice | 30 min/month | 2 hours/month | 5 hours/month |
| AI images & jingles | Standard allowance | More each day | Highest allowance |
| Transcribe / Meme / How Do I Say | Daily limits | Unlimited | Unlimited |
| New features | — | — | Early access |

**Offer mechanics.** Annual is two months free and is the default selection.
7-day money-back guarantee instead of a time-boxed trial, because the free plan
is permanent. Upgrade, downgrade or cancel any time; cancellations run to the
end of the period. Progress is never locked or deleted on a downgrade. New
dialects roll out to All-In first.

**Current status:** closed beta, invite-code sign-up. The pricing page says so
explicitly — "pricing below reflects our upcoming public launch" — which is the
right posture and should stay until launch.

**Additional revenue lines already built:** native-feedback credits (pay a real
native speaker to review your recording) and a referral programme.

---

## 30. Proof points

Use these; they are all verifiable in the product.

- **Three dialects, all on the free plan** — Gulf (Khaliji), Egyptian, Yemeni.
- **Six speech-recognition engines** run on every clip, not one.
- **Three AI models vote** on every translation, and disagreements are recorded
  rather than hidden.
- **Native speakers are paid to correct the output**, in a workspace with
  per-line sign-off, staleness detection, and a server-computed audit trail.
- **The same memory algorithm Anki ships** (FSRS-6), with per-learner fitting as
  the design goal.
- **Sub-dialect classification** — not just "Saudi" but Najdi, Qassimi, Ḥijāzi,
  Eastern Province, Southern, Northern.
- **The roadmap is documented against the research literature**, including the
  four things the evidence *stopped*.
- **117 backend functions, 119 database tables, 547 automated test files, four
  independent CI checks**, plus a live crawl that records controls which do
  nothing.
- **Accessibility is enforced**, not aspirational: colour contrast is a test.

---

## 31. Ready-to-use copy

### Taglines

- Learn the Arabic people actually speak.
- One story at a time.
- Real dialect. Checked by natives.
- The Arabic they use, not the Arabic they write.
- Gulf, Egyptian, Yemeni — from the clips people are actually posting.

### One-liner

> Hakiya teaches spoken Arabic — Gulf, Egyptian and Yemeni — from real clips,
> with native audio, smart flashcards and a tutor that can see what you are
> looking at.

### Elevator pitch (30 seconds)

> Most Arabic courses teach Modern Standard Arabic — the written, formal
> language. It is not what anyone speaks. So people study for years and then
> cannot understand a taxi driver. Hakiya teaches the dialects instead: Gulf,
> Egyptian and Yemeni. The material is real clips people actually posted, run
> through six speech engines and three translation models, then corrected by
> paid native speakers. Every word you tap goes into a flashcard system that
> schedules it for the moment you would forget. And an AI tutor sits on every
> screen that can see the clip you are watching, where you are in it, and which
> words you keep getting wrong.

### Longer pitch (for a landing page)

> **You did the work. You still can't have the conversation.**
>
> Arabic has two lives. There is the written, formal Arabic taught almost
> everywhere — and there is the Arabic people speak, which is different enough
> that years of study can leave you lost in an ordinary conversation.
>
> Hakiya teaches the second one. Gulf, Egyptian and Yemeni, from real clips
> real people posted, with the transcript checked line by line by someone who
> grew up speaking that dialect.
>
> Tap any word to save it. It comes back exactly when you are about to forget
> it. Say a line and hear which sound to fix. Ask the tutor what he meant
> earlier — it knows what "earlier" was. And if you already know Modern Standard
> Arabic, every line shows you the formal version beside the spoken one, so the
> years you already put in start paying.
>
> All three dialects. Free plan, permanently.

### Social bios

- **X / Instagram (150 chars):** Learn the Arabic people actually speak — Gulf,
  Egyptian, Yemeni. Real clips, native-checked. hakiya.app
- **LinkedIn:** Hakiya teaches spoken Arabic dialects from authentic media, with
  every transcript verified by paid native speakers.

### App store description (short)

> Learn real spoken Arabic — Gulf, Egyptian and Yemeni — from the clips people
> are actually posting. Native audio, smart flashcards, pronunciation scoring
> and an AI tutor that understands what is on your screen. Every transcript is
> checked by a native speaker. All three dialects free.

### Email subject lines

- The Arabic your course didn't teach you
- Your MSA isn't wasted — here's how to convert it
- Yemeni Arabic. Yes, actually.
- Six engines and a native speaker read this clip before you did

### Feature announcement template

> **[Feature name]**
> [One sentence on what it does, in the second person.]
> [One sentence on why it exists — name the failure it fixes.]
> [What to do next.]

Example, in the house voice:

> **Sound Pairs**
> Train your ear on the contrasts that decide whether you understand Arabic at
> all — ص vs س, ق vs ك, ح vs ه.
> Most listening practice assumes you can already hear the difference. This is
> the training that gets you there, and it has an end: about 400 minutes, then
> it plateaus, and we tell you so.
> Start with one round on the Listen tab.

---

## 32. Claims to avoid

The product is deliberately careful about several claims. Marketing must not
undo that.

| Do not say | Because | Say instead |
| --- | --- | --- |
| "Become fluent in X weeks" | No such evidence exists for anything, and the app's own research pass says so | "Practice speaking with no one listening" |
| "AI speaking practice makes you speak faster" | The measured effect is on *anxiety*, not skill | "Speaking reps with no social cost" |
| "Your fluency score" | There are no published fluency norms for spoken Arabic | "Your fluency trend, against your own history" |
| "Native-level pronunciation scoring" | The scoring is calibrated and deliberately forgiving | "Feedback on the specific sounds to fix" |
| "Perfect transcripts" | Six engines and a native reviewer reduce error; they do not eliminate it | "Checked line by line by a native speaker" |
| "Learn any Arabic dialect" | Three are supported | "Gulf, Egyptian and Yemeni" |
| "Unlimited AI on the free plan" | The free plan has daily caps | "Every AI tool, with daily free limits" |
| Any claim of a specific user count or outcome | The product is in closed beta | Talk about the method, not the results |

---
---

# Recommendations

## 33. What I would add

These came out of the inventory. Ordered by what I would do first within each
group.

### Product gaps I would close

1. **Ship a learner surface for Trending.** The whole social-harvest pipeline is
   built, screened and reviewed — and there is currently *no learner-facing
   page at all*. This is finished infrastructure producing nothing. It is also
   the freshest content in the app and the strongest retention hook: "what the
   Arab world is posting today, in your dialect".
2. **A signed-out marketing page.** Anonymous visitors land on the feed, which
   is a good product decision and a poor conversion decision — there is nowhere
   that tells the story from [24](#24-the-product-story). A single page with the
   MSA-graduate problem, the verification chain, and the free-plan offer.
3. **A share-*out* loop.** The app has an excellent share-*in* flow and nothing
   going the other way. "Share this clip" with a branded card is the cheapest
   growth mechanism available and the content is already visually distinctive.
4. **Offline review.** The service worker caches the shell and card audio but
   deliberately never the database, so a commuter with no signal cannot review.
   A queued offline review session that syncs on reconnect is the single most
   requested feature in every SRS app.
5. **Turn on per-learner FSRS fitting.** `review_log` and `fsrsFit.ts` both
   exist. Define the threshold (reviews and elapsed days) at which a learner
   gets fitted weights, and show them that it happened — it is a genuinely
   differentiating story that is currently invisible.
6. **A shareable progress report.** Placement level, C-test percentage, words
   mature on recognition vs production, streak. Learners in this niche
   constantly need to demonstrate progress to an employer, a programme or
   themselves, and it doubles as marketing.
7. **Levantine as the fourth dialect.** It is the largest unserved demand after
   the three you have, and — unlike Yemeni — it is covered by the published
   dialect benchmark, so quality is measurable from day one.
8. **A faster first-value path.** Placement is 20 adaptive questions before the
   app knows anything. Consider letting a new learner start watching in three
   taps and placing them from behaviour, with the quiz offered rather than
   required.
9. **Surface the sub-dialect work to learners.** Reviewers are recording
   Najdi-vs-Ḥijāzi classifications and contrastive dialect features
   ("uses شنو where Riyadh says وش and Cairo says إيه") — that is remarkable
   material that currently only staff can see.

### Technical risks I would fix

10. **`subscribers`, `processed_videos` and `review_streaks` exist in production
    but in no migration.** `subscribers` is the serious one: it is what decides
    whether a caller is paying, so a rebuilt database would treat every customer
    as free-tier. This is a disaster-recovery hole, not a tidiness issue. Take a
    schema dump and write the migrations.
11. **Verify `persist-video-thumbnail` is deployed.** The last QA map run
    recorded it as returning 404. If that is still true, every TikTok and
    Instagram thumbnail is quietly reverting to a two-day lifespan.
12. **Move Stripe entitlement onto webhooks.** Subscription state appears to be
    resolved by polling `check-subscription`; a webhook makes cancellation and
    payment-failure handling immediate and removes a class of "I paid and it
    didn't unlock" support ticket.
13. **Alert on the silent sinks.** The four fire-and-forget loggers swallow
    their own errors by design, so they can stop working with no signal. A
    `feature_alerts` row when a sink writes nothing for N hours closes the loop —
    the table already exists.
14. **Guard the unguarded functions.** The QA map flags `discover-feed`,
    `scrape-x-post`, `score-set-phrase-voice`, `practice-chunk-coach` and
    `classify-tutor-segments` as having no auth or cap guard. At least the ones
    that spend on a provider should carry `enforceDailyCap`, and ideally an
    IP-level limiter for the anonymous ones.
15. **Reconcile the lint baseline.** The ratchet script pins **528**;
    `CLAUDE.md` says 530, `docs/testing.md` says ~548, and the CI workflow
    comment says ~596. Four numbers for one figure means nobody is reading it
    any more.
16. **An integration test for the pipeline stage chain.** It is the most complex
    and most failure-prone code in the app, and the current coverage is
    per-function. A fixture-driven test that drives asr → analyze → finalize
    including a simulated worker death would protect the resume logic, which is
    exactly the part that is hard to test by hand.
17. **Reduce the migration replay failures from 7.** Every one of them is a
    small step toward "the schema can be rebuilt", which is the property that
    matters on the day it matters.

### Content and quality

18. **Publish the reviewer count and throughput internally.** The whole trust
    story rests on native review; nothing currently reports how much of the
    library has actually been reviewed. `AdminCoverage` is the natural home.
19. **Decide the ALDi question.** It has been log-only for a while. Compare it
    against native-review outcomes and either promote it to a gate or remove it.
20. **A written reviewer handbook.** The workspace is excellent and the
    conventions live in code comments. A one-page guide — what a tick means,
    when to comment vs. correct, how to choose a sub-variety — would make new
    reviewers productive faster and make their output more consistent.

### Marketing and brand

21. **Write the founder story.** It is completely absent from the repo, and for
    a product in this niche — three dialects including Yemeni, a Bible track,
    paid native reviewers — the "why does this exist" is the most persuasive
    asset available and cannot be manufactured later.
22. **Build the institutional offer.** The `institutions` table exists; CEFR
    placement, the C-test, a curriculum and per-learner analytics are all built.
    Universities, NGOs, diplomatic language programmes and mission agencies are
    a higher-value, lower-churn revenue line than consumer subscriptions, and the
    Yemeni coverage is a near-monopoly there.
23. **Mine `beta_feedback` for social proof**, with permission. You are in
    closed beta with real users and no testimonials anywhere.
24. **Codify this brand voice as a one-page style sheet** for whoever writes copy
    next. Section [22](#22-brand-voice) is the source; the risk is that a future
    writer adds the hype the product has carefully avoided.
25. **Name the verification chain.** "Six engines, three models, one native
    speaker" is a memorable, true, and completely unownable-by-competitors
    claim. It deserves to be a named thing rather than a paragraph.
