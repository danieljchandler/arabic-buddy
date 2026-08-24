ALTER TABLE public.content_channels
  ADD COLUMN IF NOT EXISTS resolution_attempted_at timestamptz;

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'transcriber';