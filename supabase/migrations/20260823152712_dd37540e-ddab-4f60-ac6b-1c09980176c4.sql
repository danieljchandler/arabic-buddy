ALTER TABLE public.content_channels
  ADD COLUMN IF NOT EXISTS resolution_attempted_at timestamptz;