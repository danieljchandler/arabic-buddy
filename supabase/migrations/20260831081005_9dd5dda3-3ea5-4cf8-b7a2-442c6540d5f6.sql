ALTER TABLE public.training_examples
  DROP CONSTRAINT IF EXISTS training_examples_corrector_role_check;
ALTER TABLE public.training_examples
  ADD CONSTRAINT training_examples_corrector_role_check
  CHECK (corrector_role = ANY (ARRAY[
    'native_speaker', 'content_reviewer', 'transcriber',
    'admin', 'auto_repair', 'learner'
  ]));

CREATE OR REPLACE FUNCTION public.reap_stuck_video_transcriptions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  finalized int := 0;
  failed int := 0;
BEGIN
  WITH promoted AS (
    UPDATE public.discover_videos
       SET transcription_status = 'completed'
     WHERE transcription_status = 'analysis_complete'
       AND updated_at < now() - interval '3 minutes'
       AND jsonb_array_length(COALESCE(transcript_lines, '[]'::jsonb)) > 0
    RETURNING 1
  )
  SELECT count(*) INTO finalized FROM promoted;

  WITH reaped AS (
    UPDATE public.discover_videos
       SET transcription_status = 'failed',
           transcription_error = COALESCE(
             transcription_error,
             'Processing stopped responding before it finished. Nothing was lost - press Retry to run it again.'
           )
     WHERE transcription_status = 'processing'
       AND updated_at < now() - interval '12 minutes'
    RETURNING 1
  )
  SELECT count(*) INTO failed FROM reaped;

  RETURN jsonb_build_object('finalized', finalized, 'failed', failed);
END;
$$;

REVOKE ALL ON FUNCTION public.reap_stuck_video_transcriptions() FROM public;
GRANT EXECUTE ON FUNCTION public.reap_stuck_video_transcriptions() TO service_role;

-- Guarded like the pgvector migration (20260812160000): pg_cron ships on
-- Supabase but NOT on the vanilla postgres:16 container the CI contract job
-- replays against. Without the extension the reaper function still exists,
-- it just is not scheduled.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron unavailable - reap_stuck_video_transcriptions not scheduled';
    RETURN;
  END;

  BEGIN
    PERFORM cron.unschedule('reap-stuck-video-transcriptions');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'reap-stuck-video-transcriptions',
    '*/2 * * * *',
    'SELECT public.reap_stuck_video_transcriptions();'
  );
END;
$$;
