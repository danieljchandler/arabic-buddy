You are authoring one stage of the spoken-Arabic curriculum for Hakiya (repo: /home/user/arabic-buddy). You write REAL lesson content — vocabulary, grammar notes, culture notes, dialogues — as JSON files that are validated and compiled into the app's database. Quality bar: a native speaker of the variety reads every line and nods; a learner at the level could say every example.

## Your assignment
DIALECT: Gulf   VARIETY: Neutral Khaleeji (Saudi–Kuwaiti–Emirati core, variants noted)   STAGE: 1
Output directory: /home/user/arabic-buddy/curriculum/tracks/gulf/stage-1/
Write `_stage.json` = {"dialect": "Gulf", "stage": 1, "variety": "Neutral Khaleeji (Saudi–Kuwaiti–Emirati core, variants noted)"} (skip if it already exists) and one file per syllabus lesson of this stage, named `<nn>-<slug>.json` (nn = two-digit lesson_number). Lesson 01 already exists in this directory (it is the exemplar) — keep it and write lessons 02–12.

## Read these first (in this order)
1. /home/user/arabic-buddy/curriculum/tracks/SCHEMA.md — the file format and rules.
2. /home/user/arabic-buddy/curriculum/tracks/syllabus.json — find `stages[].stage == 1`; those lessons (slug, lesson_number, title, can_do, grammar targets, culture, target_concepts with keys, video_scene) are your slots. Also skim the OTHER stages' target_concepts: a word that realises a concept targeted in another lesson must not be introduced as a new word in yours (use it in examples freely, but not in `vocabulary`).
3. /home/user/arabic-buddy/curriculum/tracks/gulf/stage-1/01-objects-around-you.json — the exemplar; match its depth and tone.
4. The research brief for your dialect: /tmp/claude-0/-home-user-arabic-buddy/bd19c1e2-411b-53c6-984e-e84a2d307620/scratchpad/research/gulf.md — grammar paradigms, identity vocabulary, culture thread, video sourcing. Copy forms from it; convert its transliteration into the app scheme below.
5. /home/user/arabic-buddy/src/lib/curriculumTracks.ts — the exact TypeScript types (`TrackLesson` etc.).
6. /home/user/arabic-buddy/supabase/functions/_shared/msaLeakDetector.ts — UNIVERSAL_MSA_LEAKS plus DIALECT_EXTRA.Gulf are words that FAIL the build if they appear in any Arabic field of your lessons; ALWAYS_ALLOWED.Gulf are safe.

## Hard requirements (the validator enforces these; CI runs it)
- Every lesson slot of the stage exists, with the syllabus slug and lesson_number.
- vocabulary: at least 12 words; aim for 12. One word per syllabus target concept with `concept_key` set to that exact key. Extras: dialect-specific high-frequency words fitting the theme (no concept_key, or a key from the vocab_concepts list: hello good_morning good_evening how_are_you im_fine thank_you please yes no sorry goodbye welcome mother father brother sister son daughter family friend man woman water bread rice meat chicken fish milk tea coffee sugar salt egg fruit vegetables dog cat camel horse sheep goat bird donkey house door window table chair bed kitchen bathroom car phone market school mosque hospital street shop city sea today tomorrow yesterday now morning night day week big small hot cold good bad new old beautiful expensive eat drink go come want see know speak sleep sit buy love what where who when why how how_much which).
- Never introduce the same Arabic string as a new word twice in the whole dialect (across all three stages). Stage 1 owns the basics listed in its target_concepts; later stages recycle them in examples only.
- Every field non-empty and in the right script: `arabic` Arabic script, `transliteration` Latin, `english` English. Every word has `category`, `teaching_note`, `image_scene`, `example` {arabic, transliteration, english}; add `variants` (other spellings, the definite form with ال, common plural/suffixed forms as they'd appear in captions) and `video_hint`.
- `grammar`: one note per syllabus grammar target (category must be one of verb-conjugation, pronouns, negation, possessives, questions, sentence-structure), `title`, plain-language `explanation` (3–6 sentences, no linguistics jargon the learner hasn't met), 3–5 `examples`. Lessons whose syllabus grammar is empty may use [] or one short "noticing" note.
- `culture`: 1–2 notes, each with `title`, `note` (3–6 sentences of what to actually do/say), 1–4 `phrases`.
- `dialogue`: 4–8 lines, `speaker` names, recycling this lesson's words at this level.
- `sound_spotlight`: 1–3 entries {sound, example, explanation} (Stage 1: the sounds this lesson introduces; later stages: a pronunciation or connected-speech point).
- `lesson_sequence`: 5–7 steps {step, detail}. `real_world_prompts`: 2–3 {prompt, context}.
- `video_needs`: 2–4 Arabic-script YouTube `queries`, `channels` chosen ONLY from these seeded names: Moshaya Family, Saud Brothers, Fahad Sal, Khambalah, Masameer, Yarob, Hitham Channel, BanderitaX, Gudosbros, Jana Vlogs, Saudi Food Eman, Thamaniyeh, Sayood, Bjlife, Learn Arabic - Kuwaiti, Sowt Afkari, Belmokhba, Vivian Mnafikh Kitchen, AlRamsa Institute, Qalby Etmaan, Bin Baz, BluSkits, QTips, Ahmed Sharif, and a `scene`.
- `title_arabic` in dialect; `description` 1–2 sentences; `cefr_target` from the syllabus; `duration_minutes` 15–25; `approach`, `unlock_condition`, `icon` (one emoji); `can_do` copied/adapted from the syllabus.
- NO MSA anywhere (never الآن لماذا ليس سوف الذي التي ماذا أين هل أريد أذهب). Spoken forms only, spelled the way people write the dialect online.
- Gulf specifics: ق = g in transliteration (gahwa); ج = j (Saudi) — note y-variants (Kuwait/UAE) in teaching notes, not in the main form. Write the neutral shared form as the word and put country variants (شنو/وش/إيش; شلونك/شخبارك/شحالك; هالحين/الحين/دحين) in `variants` and `teaching_note`. بـ on a present verb is FUTURE/intent in Gulf, not habitual — the bare present is habitual (the brief §4.10–4.11 explains). Negation: ما + verb, مو/مب before nouns and adjectives, لا for commands. هذا/هذه are fine in Gulf. Never use Egyptian forms (عايز، دلوقتي، إزيك، فين، كده، مفيش).

## Transliteration scheme (app-wide)
Long vowels doubled: aa ii uu; short a i u; diphthongs ay aw. Consonants: ʾ (hamza/glottal), ʿ (ع), ḥ (ح), kh (خ), gh (غ), sh (ش), ṣ ḍ ṭ ẕ (ص ض ط ظ), th (ث), dh (ذ), j (ج), q/g/ʾ for ق per the dialect rule above. Doubled consonants written twice (sayyaara). Definite article assimilates: il-/ish-/is- (Gulf/Yemeni), el-/esh-/es- (Egyptian). Hyphen between article/prefix and word, and before suffix pronouns only where it helps (bayt-ik).

## Process
1. Write the files one at a time with the Write tool (valid JSON, UTF-8, no comments, no trailing commas).
2. After every 3–4 lessons run: `npx vite-node scripts/check-curriculum-tracks.ts --dialect Gulf --stage 1 --partial` and fix every reported problem (including MSA-leak hits) before continuing.
3. When all slots are written, run it WITHOUT `--partial` for your stage and make it pass. The command may report cross-stage duplicates from other stages being written in parallel — leave those to the coordinator, but fix everything inside your own stage.
4. Do not edit anything outside your output directory. Do not touch syllabus.json, SCHEMA.md, scripts or src.
5. Final report: the check output, word count, and any place you deviated from the brief and why (e.g. a sub-variety choice).
