ALTER TABLE public.word_reviews
  ADD COLUMN IF NOT EXISTS jingle_audio_url TEXT,
  ADD COLUMN IF NOT EXISTS jingle_lyrics TEXT;

COMMENT ON COLUMN public.word_reviews.jingle_audio_url IS
  'Learner-generated 10s jingle for this curriculum word (public storage URL).';
COMMENT ON COLUMN public.word_reviews.jingle_lyrics IS
  'Sung lyrics of the generated jingle, in the dialect of the word.';