-- Starter A1 concept list for the clip pipeline: 100 language-neutral
-- concepts across ten themes, authored for this app (the AVP/KELLY lists
-- informed the theme choices, but no third-party list is copied — their
-- licenses are unresolved; see the clip-pipeline plan).
--
-- Keys are stable snake_case English. Lessons and clips reference the key,
-- never an Arabic string — per-dialect surface forms live in
-- concept_realizations, drafted by AI and approved through native review.
-- sort_order is theme-major so the coverage heatmap reads as a syllabus.
--
-- Deliberately modest: 100 concepts is enough to run the pilot and prove the
-- mining loop; growing toward a full A1 vocabulary is an editorial decision,
-- not a migration.

INSERT INTO public.vocab_concepts (key, english_gloss, category, cefr_level, sort_order)
SELECT v.key, v.gloss, v.category, 'A1', (row_number() OVER ()) * 10
FROM (VALUES
  -- greetings & basics
  ('hello',        'hello',                 'greetings_basics'),
  ('good_morning', 'good morning',          'greetings_basics'),
  ('good_evening', 'good evening',          'greetings_basics'),
  ('how_are_you',  'how are you?',          'greetings_basics'),
  ('im_fine',      'I''m fine',             'greetings_basics'),
  ('thank_you',    'thank you',             'greetings_basics'),
  ('please',       'please',                'greetings_basics'),
  ('yes',          'yes',                   'greetings_basics'),
  ('no',           'no',                    'greetings_basics'),
  ('sorry',        'sorry / excuse me',     'greetings_basics'),
  ('goodbye',      'goodbye',               'greetings_basics'),
  ('welcome',      'welcome',               'greetings_basics'),
  -- people & family
  ('mother',   'mother',   'people_family'),
  ('father',   'father',   'people_family'),
  ('brother',  'brother',  'people_family'),
  ('sister',   'sister',   'people_family'),
  ('son',      'son',      'people_family'),
  ('daughter', 'daughter', 'people_family'),
  ('family',   'family',   'people_family'),
  ('friend',   'friend',   'people_family'),
  ('man',      'man',      'people_family'),
  ('woman',    'woman',    'people_family'),
  -- food & drink
  ('water',      'water',      'food_drink'),
  ('bread',      'bread',      'food_drink'),
  ('rice',       'rice',       'food_drink'),
  ('meat',       'meat',       'food_drink'),
  ('chicken',    'chicken',    'food_drink'),
  ('fish',       'fish',       'food_drink'),
  ('milk',       'milk',       'food_drink'),
  ('tea',        'tea',        'food_drink'),
  ('coffee',     'coffee',     'food_drink'),
  ('sugar',      'sugar',      'food_drink'),
  ('salt',       'salt',       'food_drink'),
  ('egg',        'egg',        'food_drink'),
  ('fruit',      'fruit',      'food_drink'),
  ('vegetables', 'vegetables', 'food_drink'),
  -- animals
  ('dog',    'dog',    'animals'),
  ('cat',    'cat',    'animals'),
  ('camel',  'camel',  'animals'),
  ('horse',  'horse',  'animals'),
  ('sheep',  'sheep',  'animals'),
  ('goat',   'goat',   'animals'),
  ('bird',   'bird',   'animals'),
  ('donkey', 'donkey', 'animals'),
  -- home & objects
  ('house',    'house',        'home_objects'),
  ('door',     'door',         'home_objects'),
  ('window',   'window',       'home_objects'),
  ('table',    'table',        'home_objects'),
  ('chair',    'chair',        'home_objects'),
  ('bed',      'bed',          'home_objects'),
  ('kitchen',  'kitchen',      'home_objects'),
  ('bathroom', 'bathroom',     'home_objects'),
  ('car',      'car',          'home_objects'),
  ('phone',    'phone/mobile', 'home_objects'),
  -- places
  ('market',   'market/souq', 'places'),
  ('school',   'school',      'places'),
  ('mosque',   'mosque',      'places'),
  ('hospital', 'hospital',    'places'),
  ('street',   'street',      'places'),
  ('shop',     'shop',        'places'),
  ('city',     'city',        'places'),
  ('sea',      'sea',         'places'),
  -- time
  ('today',     'today',     'time_daily'),
  ('tomorrow',  'tomorrow',  'time_daily'),
  ('yesterday', 'yesterday', 'time_daily'),
  ('now',       'now',       'time_daily'),
  ('morning',   'morning',   'time_daily'),
  ('night',     'night',     'time_daily'),
  ('day',       'day',       'time_daily'),
  ('week',      'week',      'time_daily'),
  -- descriptors
  ('big',       'big',              'descriptors'),
  ('small',     'small',            'descriptors'),
  ('hot',       'hot',              'descriptors'),
  ('cold',      'cold',             'descriptors'),
  ('good',      'good',             'descriptors'),
  ('bad',       'bad',              'descriptors'),
  ('new',       'new',              'descriptors'),
  ('old',       'old',              'descriptors'),
  ('beautiful', 'beautiful',        'descriptors'),
  ('expensive', 'expensive',        'descriptors'),
  -- daily verbs
  ('eat',    'to eat',        'actions_daily'),
  ('drink',  'to drink',      'actions_daily'),
  ('go',     'to go',         'actions_daily'),
  ('come',   'to come',       'actions_daily'),
  ('want',   'to want',       'actions_daily'),
  ('see',    'to see',        'actions_daily'),
  ('know',   'to know',       'actions_daily'),
  ('speak',  'to speak/talk', 'actions_daily'),
  ('sleep',  'to sleep',      'actions_daily'),
  ('sit',    'to sit',        'actions_daily'),
  ('buy',    'to buy',        'actions_daily'),
  ('love',   'to love/like',  'actions_daily'),
  -- question words (per-dialect forms are exactly the marker words)
  ('what',     'what?',        'question_words'),
  ('where',    'where?',       'question_words'),
  ('who',      'who?',         'question_words'),
  ('when',     'when?',        'question_words'),
  ('why',      'why?',         'question_words'),
  ('how',      'how?',         'question_words'),
  ('how_much', 'how much?',    'question_words'),
  ('which',    'which?',       'question_words')
) AS v(key, gloss, category)
ON CONFLICT (key) DO NOTHING;
