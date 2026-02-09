
-- Add stage-based SRS columns to user_vocabulary
ALTER TABLE public.user_vocabulary
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'NEW',
  ADD COLUMN IF NOT EXISTS last_result text,
  ADD COLUMN IF NOT EXISTS sentence_text text,
  ADD COLUMN IF NOT EXISTS sentence_english text,
  ADD COLUMN IF NOT EXISTS review_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correct_count integer NOT NULL DEFAULT 0;

-- Add stage-based SRS columns to word_reviews
ALTER TABLE public.word_reviews
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'NEW',
  ADD COLUMN IF NOT EXISTS last_result text,
  ADD COLUMN IF NOT EXISTS review_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correct_count integer NOT NULL DEFAULT 0;

-- Create review_streaks table
CREATE TABLE IF NOT EXISTS public.review_streaks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  current_streak integer NOT NULL DEFAULT 0,
  longest_streak integer NOT NULL DEFAULT 0,
  last_review_date date,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Add unique constraint on user_id for review_streaks
ALTER TABLE public.review_streaks ADD CONSTRAINT review_streaks_user_id_key UNIQUE (user_id);

-- Enable RLS
ALTER TABLE public.review_streaks ENABLE ROW LEVEL SECURITY;

-- RLS policies for review_streaks
CREATE POLICY "Users can view their own streak"
  ON public.review_streaks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own streak"
  ON public.review_streaks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own streak"
  ON public.review_streaks FOR UPDATE
  USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_review_streaks_updated_at
  BEFORE UPDATE ON public.review_streaks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Migrate existing word_reviews: map repetitions to stages
UPDATE public.word_reviews SET stage = CASE
  WHEN repetitions >= 5 THEN 'STAGE_5'
  WHEN repetitions = 4 THEN 'STAGE_4'
  WHEN repetitions = 3 THEN 'STAGE_3'
  WHEN repetitions = 2 THEN 'STAGE_2'
  WHEN repetitions = 1 THEN 'STAGE_1'
  ELSE 'NEW'
END;

-- Migrate existing user_vocabulary: map repetitions to stages
UPDATE public.user_vocabulary SET stage = CASE
  WHEN repetitions >= 5 THEN 'STAGE_5'
  WHEN repetitions = 4 THEN 'STAGE_4'
  WHEN repetitions = 3 THEN 'STAGE_3'
  WHEN repetitions = 2 THEN 'STAGE_2'
  WHEN repetitions = 1 THEN 'STAGE_1'
  ELSE 'NEW'
END;
