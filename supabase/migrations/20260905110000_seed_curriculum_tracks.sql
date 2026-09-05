-- GENERATED FILE — do not edit by hand.
--
-- Compiled from curriculum/tracks/ by scripts/build-curriculum-seed.ts.
-- src/test/curriculumSeed.test.ts fails when this file is stale; regenerate with
--   npx vite-node scripts/build-curriculum-seed.ts
--
-- 1 track(s), 1 lessons, 12 words. Idempotent: lessons upsert on
-- source_key, words insert-if-missing then update, concepts insert-if-missing.
-- Schema it relies on: 20260905100000_curriculum_tracks_schema.sql.

BEGIN;

-- ============ Gulf · Stage 1 · Neutral Khaleeji (Saudi–Kuwaiti–Emirati core, variants noted) ============

-- gulf/s1/l01 · Objects — The World Around You
INSERT INTO public.lessons (stage_id, source_key, lesson_number, title, title_arabic, description, duration_minutes, cefr_target, approach, unlock_condition, icon, gradient, display_order, dialect_module, status, can_do, grammar_notes, culture_notes, dialogue, sound_spotlight, lesson_sequence, real_world_prompts)
SELECT s.id, $hk$gulf/s1/l01$hk$, 1, $hk$Objects — The World Around You$hk$, $hk$الأشياء اللي حولك$hk$, $hk$Twelve things you can point at right now — a glass of water, the door, your phone — heard and seen until the sound and the thing are one. No reading, no speaking yet.$hk$, 15, $hk$Pre-A1$hk$, $hk$GPA Phase 1 — Here & Now. Receptive only: listen, look, tap. No production, no grammar meta-language.$hk$, $hk$≥9/12 correct on the final listen-and-tap quiz$hk$, $hk$🏠$hk$, $hk$bg-gradient-green$hk$, 101, $hk$Gulf$hk$, 'published', $hk$["Recognise twelve everyday objects by sound and picture","Match a spoken Gulf word to the thing it names"]$hk$::jsonb, $hk$[]$hk$::jsonb, $hk$[{"title":"Coffee is where the language starts","note":"In a Gulf home the first thing offered is قهوة — cardamom-scented Arabic coffee poured from a دلة into a tiny handleless cup, followed by dates. It is poured by the youngest, taken with the right hand, and refilled until you gently shake the cup. Learning the word before anything else is not an accident: it is the first thing you will hear a host say.","phrases":[{"arabic":"تفضل قهوة","transliteration":"tfaḍḍal gahwa","english":"Please, have some coffee"},{"arabic":"ماي لو سمحت","transliteration":"maay law samaḥt","english":"Water, please"}]}]$hk$::jsonb, $hk$[{"speaker":"Host","arabic":"تفضل، قهوة؟","transliteration":"tfaḍḍal, gahwa?","english":"Please — coffee?"},{"speaker":"Guest","arabic":"ماي لو سمحت","transliteration":"maay law samaḥt","english":"Water, please"},{"speaker":"Host","arabic":"الماي على الكرسي","transliteration":"il-maay ʿala l-kursi","english":"The water is on the chair"}]$hk$::jsonb, $hk$[{"sound":"ق → g","example":"قهوة (gahwa)","explanation":"In Gulf Arabic ق is a hard g, not the formal q of MSA. One of the most distinctive Gulf features, introduced through the word you will hear most."},{"sound":"خ","example":"خبز (khubz)","explanation":"A rasping sound at the back of the throat, like the ch in Scottish 'loch'. Heard passively here; production practice starts in Lesson 4."},{"sound":"ح","example":"مفتاح (miftaaḥ)","explanation":"A breathy h from deep in the throat — like fogging a mirror. Easiest to hear at the end of a word."},{"sound":"Long aa","example":"كتاب، باب","explanation":"Arabic holds some vowels twice as long. Both words carry the long ا; hearing them side by side lets the pattern register before it is ever explained."}]$hk$::jsonb, $hk$[{"step":"Welcome","detail":"A warm Gulf street scene — palm, white house, sun. One line of English: you will start recognising twelve Gulf words. Tap يلّا to begin."},{"step":"Listen & see","detail":"Each of the 12 words on its own full-screen card: illustration, native audio auto-plays, Arabic large, no English yet. Tap to replay as often as you like."},{"step":"Second pass","detail":"The same 12 cards, faster, audio auto-plays, English label now shown small and grey underneath."},{"step":"Tap quiz — round 1","detail":"Audio only; four images in a grid; tap the one you heard. Words 1–6. Distractors come from this lesson."},{"step":"Tap quiz — round 2","detail":"Same format, words 7–12."},{"step":"Tap quiz — all twelve","detail":"Random order, audio only. Score screen shows the missed words with image and audio to replay."},{"step":"Lesson complete","detail":"Words-learned counter rolls up to 12. Nudge: look around you today and find these things."}]$hk$::jsonb, $hk$[{"prompt":"Look around you right now. Can you spot any of the twelve things from this lesson? Say the Gulf word in your head.","context":"Shown on the lesson-complete screen. Observation only, no speaking required. Activates all 12 words."},{"prompt":"Every time you make or drink قهوة or ماي over the next few days, say the word once out loud.","context":"Follow-up notification the next morning (optional). Two of the highest-frequency words, both in every kitchen."},{"prompt":"If you have a tutor session coming up, tell them: 'I just learned these twelve words — can you point at them and say them?'","context":"The ideal first tutor interaction: the GPA here-and-now game. Receptive reinforcement only."}]$hk$::jsonb
FROM public.curriculum_stages s WHERE s.stage_number = 1
ON CONFLICT (source_key) DO UPDATE SET lesson_number = EXCLUDED.lesson_number, title = EXCLUDED.title, title_arabic = EXCLUDED.title_arabic, description = EXCLUDED.description, duration_minutes = EXCLUDED.duration_minutes, cefr_target = EXCLUDED.cefr_target, approach = EXCLUDED.approach, unlock_condition = EXCLUDED.unlock_condition, icon = EXCLUDED.icon, gradient = EXCLUDED.gradient, display_order = EXCLUDED.display_order, dialect_module = EXCLUDED.dialect_module, status = EXCLUDED.status, can_do = EXCLUDED.can_do, grammar_notes = EXCLUDED.grammar_notes, culture_notes = EXCLUDED.culture_notes, dialogue = EXCLUDED.dialogue, sound_spotlight = EXCLUDED.sound_spotlight, lesson_sequence = EXCLUDED.lesson_sequence, real_world_prompts = EXCLUDED.real_world_prompts, stage_id = EXCLUDED.stage_id;
INSERT INTO public.vocabulary_words (lesson_id, dialect_module, word_arabic, word_english, transliteration, category, teaching_note, image_scene_description, example_arabic, example_transliteration, example_english, display_order)
SELECT l.id, $hk$Gulf$hk$, v.word_arabic, v.word_english, v.transliteration, v.category, v.teaching_note, v.image_scene_description, v.example_arabic, v.example_transliteration, v.example_english, v.display_order
FROM (VALUES
  ($hk$ماي$hk$, $hk$water$hk$, $hk$maay$hk$, $hk$Food & drink$hk$, $hk$Universal and unambiguous; every Gulf home has it. Note the Gulf form ماي, not the MSA ماء — the learner will never need the MSA word to be understood.$hk$, $hk$Close-up of a clear glass of cold water on a table, condensation on the glass.$hk$, $hk$أبي ماي$hk$, $hk$abi maay$hk$, $hk$I want water$hk$, 1),
  ($hk$قهوة$hk$, $hk$coffee$hk$, $hk$gahwa$hk$, $hk$Food & drink$hk$, $hk$Culturally central. The Gulf ق is a hard g — introduced deliberately in the first lesson through the word learners will hear most.$hk$, $hk$Small white Arabic coffee cup (finjan) with a gold rim, a dallah in the background.$hk$, $hk$تفضل قهوة$hk$, $hk$tfaḍḍal gahwa$hk$, $hk$Have some coffee$hk$, 2),
  ($hk$شاي$hk$, $hk$tea$hk$, $hk$shaay$hk$, $hk$Food & drink$hk$, $hk$Gulf tea is served sweet, often with mint or كرك (spiced milk tea). Same word everywhere in the Arab world, so it is a free win.$hk$, $hk$A small glass of amber tea with a sprig of mint on a metal tray.$hk$, $hk$شاي ولا قهوة؟$hk$, $hk$shaay walla gahwa?$hk$, $hk$Tea or coffee?$hk$, 3),
  ($hk$خبز$hk$, $hk$bread$hk$, $hk$khubz$hk$, $hk$Food & drink$hk$, $hk$Concrete staple. Introduces the خ sound in a memorable context. In Saudi you will also hear عيش for bread — the app accepts both.$hk$, $hk$Round Arabic flatbread on a wooden board, slightly puffed and warm.$hk$, $hk$الخبز حار$hk$, $hk$il-khubz ḥaar$hk$, $hk$The bread is hot$hk$, 4),
  ($hk$كرسي$hk$, $hk$chair$hk$, $hk$kursi$hk$, $hk$Home$hk$, $hk$Furniture is ideal early vocabulary — stable, pointable, unambiguous.$hk$, $hk$A simple wooden chair against a plain light wall, nothing else in frame.$hk$, $hk$اقعد على الكرسي$hk$, $hk$igʿid ʿala l-kursi$hk$, $hk$Sit on the chair$hk$, 5),
  ($hk$باب$hk$, $hk$door$hk$, $hk$baab$hk$, $hk$Home$hk$, $hk$Short, phonetically simple, and it carries the long aa vowel the learner will meet in كتاب too.$hk$, $hk$A wooden door slightly ajar with warm light coming through the gap.$hk$, $hk$الباب مفتوح$hk$, $hk$il-baab maftuuḥ$hk$, $hk$The door is open$hk$, 6),
  ($hk$بيت$hk$, $hk$house / home$hk$, $hk$bayt$hk$, $hk$Home$hk$, $hk$Very high frequency; it returns in dozens of later phrases (بيتي، بيتك، بيت خالي).$hk$, $hk$Exterior of a white Gulf house with a flat roof, an arched window and a palm tree.$hk$, $hk$هذا بيتي$hk$, $hk$haadha bayti$hk$, $hk$This is my house$hk$, 7),
  ($hk$سيارة$hk$, $hk$car$hk$, $hk$sayyaara$hk$, $hk$Outdoor$hk$, $hk$Visually unambiguous. Introduces the doubled letter (يّ). The white SUV is the culturally typical Gulf car.$hk$, $hk$A white SUV parked on a quiet Gulf street, seen from the side.$hk$, $hk$السيارة برا$hk$, $hk$is-sayyaara barra$hk$, $hk$The car is outside$hk$, 8),
  ($hk$شجرة$hk$, $hk$tree$hk$, $hk$shayara$hk$, $hk$Outdoor$hk$, $hk$Culturally specific: the date palm is the iconic Gulf tree. Many Gulf speakers say the ج as y (shayara) — the app plays both.$hk$, $hk$A date palm against a clear deep-blue sky, full tree visible.$hk$, $hk$الشجرة كبيرة$hk$, $hk$ish-shayara kibiira$hk$, $hk$The tree is big$hk$, 9),
  ($hk$تلفون$hk$, $hk$phone / mobile$hk$, $hk$tilifoon$hk$, $hk$Object$hk$, $hk$A borrowed word, so it is nearly free. You will also hear جوال (Saudi) and موبايل (elsewhere); all three are accepted.$hk$, $hk$A smartphone lying face-up on a table, screen lit.$hk$, $hk$وين تلفوني؟$hk$, $hk$wayn tilifooni?$hk$, $hk$Where is my phone?$hk$, 10),
  ($hk$كتاب$hk$, $hk$book$hk$, $hk$kitaab$hk$, $hk$Object$hk$, $hk$Classic object-lesson word; long aa vowel, and the ك–ت–ب root the learner will meet again in 'write' and 'office'.$hk$, $hk$A closed hardback book on a desk, plain cover.$hk$, $hk$الكتاب على الكرسي$hk$, $hk$il-kitaab ʿala l-kursi$hk$, $hk$The book is on the chair$hk$, 11),
  ($hk$مفتاح$hk$, $hk$key$hk$, $hk$miftaaḥ$hk$, $hk$Object$hk$, $hk$Everyday and pocket-sized. Introduces the ح sound at the end of a word, where it is easiest to hear.$hk$, $hk$A single metal key on a keyring against a plain background.$hk$, $hk$المفتاح في السيارة$hk$, $hk$il-miftaaḥ fi s-sayyaara$hk$, $hk$The key is in the car$hk$, 12)
) AS v(word_arabic, word_english, transliteration, category, teaching_note, image_scene_description, example_arabic, example_transliteration, example_english, display_order)
CROSS JOIN public.lessons l
WHERE l.source_key = $hk$gulf/s1/l01$hk$
  AND NOT EXISTS (SELECT 1 FROM public.vocabulary_words w WHERE w.lesson_id = l.id AND w.word_arabic = v.word_arabic);
UPDATE public.vocabulary_words w
SET word_english = v.word_english, transliteration = v.transliteration, category = v.category, teaching_note = v.teaching_note, image_scene_description = v.image_scene_description, example_arabic = v.example_arabic, example_transliteration = v.example_transliteration, example_english = v.example_english, display_order = v.display_order
FROM (VALUES
  ($hk$ماي$hk$, $hk$water$hk$, $hk$maay$hk$, $hk$Food & drink$hk$, $hk$Universal and unambiguous; every Gulf home has it. Note the Gulf form ماي, not the MSA ماء — the learner will never need the MSA word to be understood.$hk$, $hk$Close-up of a clear glass of cold water on a table, condensation on the glass.$hk$, $hk$أبي ماي$hk$, $hk$abi maay$hk$, $hk$I want water$hk$, 1),
  ($hk$قهوة$hk$, $hk$coffee$hk$, $hk$gahwa$hk$, $hk$Food & drink$hk$, $hk$Culturally central. The Gulf ق is a hard g — introduced deliberately in the first lesson through the word learners will hear most.$hk$, $hk$Small white Arabic coffee cup (finjan) with a gold rim, a dallah in the background.$hk$, $hk$تفضل قهوة$hk$, $hk$tfaḍḍal gahwa$hk$, $hk$Have some coffee$hk$, 2),
  ($hk$شاي$hk$, $hk$tea$hk$, $hk$shaay$hk$, $hk$Food & drink$hk$, $hk$Gulf tea is served sweet, often with mint or كرك (spiced milk tea). Same word everywhere in the Arab world, so it is a free win.$hk$, $hk$A small glass of amber tea with a sprig of mint on a metal tray.$hk$, $hk$شاي ولا قهوة؟$hk$, $hk$shaay walla gahwa?$hk$, $hk$Tea or coffee?$hk$, 3),
  ($hk$خبز$hk$, $hk$bread$hk$, $hk$khubz$hk$, $hk$Food & drink$hk$, $hk$Concrete staple. Introduces the خ sound in a memorable context. In Saudi you will also hear عيش for bread — the app accepts both.$hk$, $hk$Round Arabic flatbread on a wooden board, slightly puffed and warm.$hk$, $hk$الخبز حار$hk$, $hk$il-khubz ḥaar$hk$, $hk$The bread is hot$hk$, 4),
  ($hk$كرسي$hk$, $hk$chair$hk$, $hk$kursi$hk$, $hk$Home$hk$, $hk$Furniture is ideal early vocabulary — stable, pointable, unambiguous.$hk$, $hk$A simple wooden chair against a plain light wall, nothing else in frame.$hk$, $hk$اقعد على الكرسي$hk$, $hk$igʿid ʿala l-kursi$hk$, $hk$Sit on the chair$hk$, 5),
  ($hk$باب$hk$, $hk$door$hk$, $hk$baab$hk$, $hk$Home$hk$, $hk$Short, phonetically simple, and it carries the long aa vowel the learner will meet in كتاب too.$hk$, $hk$A wooden door slightly ajar with warm light coming through the gap.$hk$, $hk$الباب مفتوح$hk$, $hk$il-baab maftuuḥ$hk$, $hk$The door is open$hk$, 6),
  ($hk$بيت$hk$, $hk$house / home$hk$, $hk$bayt$hk$, $hk$Home$hk$, $hk$Very high frequency; it returns in dozens of later phrases (بيتي، بيتك، بيت خالي).$hk$, $hk$Exterior of a white Gulf house with a flat roof, an arched window and a palm tree.$hk$, $hk$هذا بيتي$hk$, $hk$haadha bayti$hk$, $hk$This is my house$hk$, 7),
  ($hk$سيارة$hk$, $hk$car$hk$, $hk$sayyaara$hk$, $hk$Outdoor$hk$, $hk$Visually unambiguous. Introduces the doubled letter (يّ). The white SUV is the culturally typical Gulf car.$hk$, $hk$A white SUV parked on a quiet Gulf street, seen from the side.$hk$, $hk$السيارة برا$hk$, $hk$is-sayyaara barra$hk$, $hk$The car is outside$hk$, 8),
  ($hk$شجرة$hk$, $hk$tree$hk$, $hk$shayara$hk$, $hk$Outdoor$hk$, $hk$Culturally specific: the date palm is the iconic Gulf tree. Many Gulf speakers say the ج as y (shayara) — the app plays both.$hk$, $hk$A date palm against a clear deep-blue sky, full tree visible.$hk$, $hk$الشجرة كبيرة$hk$, $hk$ish-shayara kibiira$hk$, $hk$The tree is big$hk$, 9),
  ($hk$تلفون$hk$, $hk$phone / mobile$hk$, $hk$tilifoon$hk$, $hk$Object$hk$, $hk$A borrowed word, so it is nearly free. You will also hear جوال (Saudi) and موبايل (elsewhere); all three are accepted.$hk$, $hk$A smartphone lying face-up on a table, screen lit.$hk$, $hk$وين تلفوني؟$hk$, $hk$wayn tilifooni?$hk$, $hk$Where is my phone?$hk$, 10),
  ($hk$كتاب$hk$, $hk$book$hk$, $hk$kitaab$hk$, $hk$Object$hk$, $hk$Classic object-lesson word; long aa vowel, and the ك–ت–ب root the learner will meet again in 'write' and 'office'.$hk$, $hk$A closed hardback book on a desk, plain cover.$hk$, $hk$الكتاب على الكرسي$hk$, $hk$il-kitaab ʿala l-kursi$hk$, $hk$The book is on the chair$hk$, 11),
  ($hk$مفتاح$hk$, $hk$key$hk$, $hk$miftaaḥ$hk$, $hk$Object$hk$, $hk$Everyday and pocket-sized. Introduces the ح sound at the end of a word, where it is easiest to hear.$hk$, $hk$A single metal key on a keyring against a plain background.$hk$, $hk$المفتاح في السيارة$hk$, $hk$il-miftaaḥ fi s-sayyaara$hk$, $hk$The key is in the car$hk$, 12)
) AS v(word_arabic, word_english, transliteration, category, teaching_note, image_scene_description, example_arabic, example_transliteration, example_english, display_order), public.lessons l
WHERE l.source_key = $hk$gulf/s1/l01$hk$ AND w.lesson_id = l.id AND w.word_arabic = v.word_arabic;
INSERT INTO public.vocab_concepts (key, english_gloss, category, cefr_level, sort_order)
VALUES ($hk$water$hk$, $hk$water$hk$, $hk$here_now_objects$hk$, $hk$A1$hk$, 20100)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.concept_realizations (concept_id, dialect, surface, variants, phonetic, status, source)
SELECT c.id, $hk$Gulf$hk$, $hk$ماي$hk$, ARRAY[$hk$الماي$hk$, $hk$مويه$hk$, $hk$الموية$hk$, $hk$موية$hk$]::text[], $hk$maay$hk$, 'draft', 'curriculum-tracks'
FROM public.vocab_concepts c WHERE c.key = $hk$water$hk$
ON CONFLICT (concept_id, dialect, surface) DO NOTHING;
INSERT INTO public.vocab_concepts (key, english_gloss, category, cefr_level, sort_order)
VALUES ($hk$coffee$hk$, $hk$coffee$hk$, $hk$here_now_objects$hk$, $hk$A1$hk$, 20101)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.concept_realizations (concept_id, dialect, surface, variants, phonetic, status, source)
SELECT c.id, $hk$Gulf$hk$, $hk$قهوة$hk$, ARRAY[$hk$القهوة$hk$, $hk$قهوه$hk$, $hk$القهوه$hk$]::text[], $hk$gahwa$hk$, 'draft', 'curriculum-tracks'
FROM public.vocab_concepts c WHERE c.key = $hk$coffee$hk$
ON CONFLICT (concept_id, dialect, surface) DO NOTHING;
INSERT INTO public.vocab_concepts (key, english_gloss, category, cefr_level, sort_order)
VALUES ($hk$tea$hk$, $hk$tea$hk$, $hk$here_now_objects$hk$, $hk$A1$hk$, 20102)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.concept_realizations (concept_id, dialect, surface, variants, phonetic, status, source)
SELECT c.id, $hk$Gulf$hk$, $hk$شاي$hk$, ARRAY[$hk$الشاي$hk$, $hk$شاهي$hk$, $hk$الشاهي$hk$]::text[], $hk$shaay$hk$, 'draft', 'curriculum-tracks'
FROM public.vocab_concepts c WHERE c.key = $hk$tea$hk$
ON CONFLICT (concept_id, dialect, surface) DO NOTHING;
INSERT INTO public.vocab_concepts (key, english_gloss, category, cefr_level, sort_order)
VALUES ($hk$bread$hk$, $hk$bread$hk$, $hk$here_now_objects$hk$, $hk$A1$hk$, 20103)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.concept_realizations (concept_id, dialect, surface, variants, phonetic, status, source)
SELECT c.id, $hk$Gulf$hk$, $hk$خبز$hk$, ARRAY[$hk$الخبز$hk$, $hk$عيش$hk$, $hk$العيش$hk$]::text[], $hk$khubz$hk$, 'draft', 'curriculum-tracks'
FROM public.vocab_concepts c WHERE c.key = $hk$bread$hk$
ON CONFLICT (concept_id, dialect, surface) DO NOTHING;
INSERT INTO public.vocab_concepts (key, english_gloss, category, cefr_level, sort_order)
VALUES ($hk$chair$hk$, $hk$chair$hk$, $hk$here_now_objects$hk$, $hk$A1$hk$, 20104)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.concept_realizations (concept_id, dialect, surface, variants, phonetic, status, source)
SELECT c.id, $hk$Gulf$hk$, $hk$كرسي$hk$, ARRAY[$hk$الكرسي$hk$, $hk$كراسي$hk$, $hk$الكراسي$hk$]::text[], $hk$kursi$hk$, 'draft', 'curriculum-tracks'
FROM public.vocab_concepts c WHERE c.key = $hk$chair$hk$
ON CONFLICT (concept_id, dialect, surface) DO NOTHING;
INSERT INTO public.vocab_concepts (key, english_gloss, category, cefr_level, sort_order)
VALUES ($hk$door$hk$, $hk$door$hk$, $hk$here_now_objects$hk$, $hk$A1$hk$, 20105)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.concept_realizations (concept_id, dialect, surface, variants, phonetic, status, source)
SELECT c.id, $hk$Gulf$hk$, $hk$باب$hk$, ARRAY[$hk$الباب$hk$, $hk$أبواب$hk$]::text[], $hk$baab$hk$, 'draft', 'curriculum-tracks'
FROM public.vocab_concepts c WHERE c.key = $hk$door$hk$
ON CONFLICT (concept_id, dialect, surface) DO NOTHING;
INSERT INTO public.vocab_concepts (key, english_gloss, category, cefr_level, sort_order)
VALUES ($hk$house$hk$, $hk$house$hk$, $hk$here_now_objects$hk$, $hk$A1$hk$, 20106)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.concept_realizations (concept_id, dialect, surface, variants, phonetic, status, source)
SELECT c.id, $hk$Gulf$hk$, $hk$بيت$hk$, ARRAY[$hk$البيت$hk$, $hk$بيوت$hk$, $hk$بيتي$hk$, $hk$بيتنا$hk$]::text[], $hk$bayt$hk$, 'draft', 'curriculum-tracks'
FROM public.vocab_concepts c WHERE c.key = $hk$house$hk$
ON CONFLICT (concept_id, dialect, surface) DO NOTHING;
INSERT INTO public.vocab_concepts (key, english_gloss, category, cefr_level, sort_order)
VALUES ($hk$car$hk$, $hk$car$hk$, $hk$here_now_objects$hk$, $hk$A1$hk$, 20107)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.concept_realizations (concept_id, dialect, surface, variants, phonetic, status, source)
SELECT c.id, $hk$Gulf$hk$, $hk$سيارة$hk$, ARRAY[$hk$السيارة$hk$, $hk$سياره$hk$, $hk$سيارتي$hk$, $hk$سيايير$hk$]::text[], $hk$sayyaara$hk$, 'draft', 'curriculum-tracks'
FROM public.vocab_concepts c WHERE c.key = $hk$car$hk$
ON CONFLICT (concept_id, dialect, surface) DO NOTHING;
INSERT INTO public.vocab_concepts (key, english_gloss, category, cefr_level, sort_order)
VALUES ($hk$tree$hk$, $hk$tree$hk$, $hk$here_now_objects$hk$, $hk$A1$hk$, 20108)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.concept_realizations (concept_id, dialect, surface, variants, phonetic, status, source)
SELECT c.id, $hk$Gulf$hk$, $hk$شجرة$hk$, ARRAY[$hk$الشجرة$hk$, $hk$شجره$hk$, $hk$شجر$hk$, $hk$الشجر$hk$]::text[], $hk$shayara$hk$, 'draft', 'curriculum-tracks'
FROM public.vocab_concepts c WHERE c.key = $hk$tree$hk$
ON CONFLICT (concept_id, dialect, surface) DO NOTHING;
INSERT INTO public.vocab_concepts (key, english_gloss, category, cefr_level, sort_order)
VALUES ($hk$phone$hk$, $hk$phone/mobile$hk$, $hk$here_now_objects$hk$, $hk$A1$hk$, 20109)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.concept_realizations (concept_id, dialect, surface, variants, phonetic, status, source)
SELECT c.id, $hk$Gulf$hk$, $hk$تلفون$hk$, ARRAY[$hk$التلفون$hk$, $hk$تليفون$hk$, $hk$جوال$hk$, $hk$الجوال$hk$, $hk$موبايل$hk$]::text[], $hk$tilifoon$hk$, 'draft', 'curriculum-tracks'
FROM public.vocab_concepts c WHERE c.key = $hk$phone$hk$
ON CONFLICT (concept_id, dialect, surface) DO NOTHING;
INSERT INTO public.vocab_concepts (key, english_gloss, category, cefr_level, sort_order)
VALUES ($hk$book$hk$, $hk$book$hk$, $hk$here_now_objects$hk$, $hk$A1$hk$, 20110)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.concept_realizations (concept_id, dialect, surface, variants, phonetic, status, source)
SELECT c.id, $hk$Gulf$hk$, $hk$كتاب$hk$, ARRAY[$hk$الكتاب$hk$, $hk$كتب$hk$, $hk$الكتب$hk$]::text[], $hk$kitaab$hk$, 'draft', 'curriculum-tracks'
FROM public.vocab_concepts c WHERE c.key = $hk$book$hk$
ON CONFLICT (concept_id, dialect, surface) DO NOTHING;
INSERT INTO public.vocab_concepts (key, english_gloss, category, cefr_level, sort_order)
VALUES ($hk$key$hk$, $hk$key$hk$, $hk$here_now_objects$hk$, $hk$A1$hk$, 20111)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.concept_realizations (concept_id, dialect, surface, variants, phonetic, status, source)
SELECT c.id, $hk$Gulf$hk$, $hk$مفتاح$hk$, ARRAY[$hk$المفتاح$hk$, $hk$مفاتيح$hk$, $hk$المفاتيح$hk$]::text[], $hk$miftaaḥ$hk$, 'draft', 'curriculum-tracks'
FROM public.vocab_concepts c WHERE c.key = $hk$key$hk$
ON CONFLICT (concept_id, dialect, surface) DO NOTHING;

COMMIT;
