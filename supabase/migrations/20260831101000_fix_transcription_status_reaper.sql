-- Make the stuck-video recovery actually able to run.
--
-- 1. analyze-gulf-arabic persists its results with
--    transcription_status = 'analysis_complete', but the CHECK constraint from
--    20260310200000 never allowed that value — the persist fails, the error is
--    swallowed, the row stays 'processing', and the run ends 'failed' even
--    though the analysis succeeded. The reaper's promote branch could never
--    fire because no row could ever hold the status it looks for.
ALTER TABLE public.discover_videos
  DROP CONSTRAINT IF EXISTS discover_videos_transcription_status_check;
ALTER TABLE public.discover_videos
  ADD CONSTRAINT discover_videos_transcription_status_check
  CHECK (transcription_status IN (
    'manual', 'pending', 'processing', 'analysis_complete', 'completed', 'failed'
  ));

-- 2. Cover every stuck state, not just 'processing':
--    - 'pending' had no reaper and the edit page disables its own re-transcribe
--      controls while pending, so a lost kickoff was a permanent dead end.
--    - 'analysis_complete' with lines is promoted, but flagged for review: the
--      pipeline's finalization (stripping on-screen caption lines, aligning
--      timings to audio) did not run, so the transcript needs a human pass
--      before publishing.
--    - 'analysis_complete' with no lines (the no-Arabic-speech path) has
--      nothing to promote; surface it as failed with the reason.
--    Messages name controls that exist ("Download & Re-transcribe" on the
--    video's edit page) — there is no button labelled "Retry".
CREATE OR REPLACE FUNCTION public.reap_stuck_video_transcriptions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  finalized int := 0;
  failed_processing int := 0;
  failed_pending int := 0;
  abandoned int := 0;
BEGIN
  WITH promoted AS (
    UPDATE public.discover_videos
       SET transcription_status = 'completed',
           transcription_error = COALESCE(
             transcription_error,
             'Auto-recovered after the pipeline stopped: analysis results were saved, but final '
             || 'cleanup (removing on-screen caption lines, aligning timings) did not run. '
             || 'Review the transcript before publishing, or use Download & Re-transcribe.'
           )
     WHERE transcription_status = 'analysis_complete'
       AND updated_at < now() - interval '3 minutes'
       AND jsonb_array_length(COALESCE(transcript_lines, '[]'::jsonb)) > 0
    RETURNING 1
  )
  SELECT count(*) INTO finalized FROM promoted;

  WITH empty_reaped AS (
    UPDATE public.discover_videos
       SET transcription_status = 'failed',
           transcription_error = COALESCE(
             transcription_error,
             'Analysis finished but produced no transcript lines (usually: no Arabic speech was '
             || 'found), and the pipeline stopped before recording why. Use Download & '
             || 'Re-transcribe on the video''s edit page to run it again.'
           )
     WHERE transcription_status = 'analysis_complete'
       AND updated_at < now() - interval '3 minutes'
       AND jsonb_array_length(COALESCE(transcript_lines, '[]'::jsonb)) = 0
    RETURNING 1
  )
  SELECT count(*) INTO abandoned FROM empty_reaped;

  WITH reaped AS (
    UPDATE public.discover_videos
       SET transcription_status = 'failed',
           transcription_error = COALESCE(
             transcription_error,
             'Processing stopped responding before it finished. Nothing was lost - use '
             || 'Download & Re-transcribe on the video''s edit page to run it again.'
           )
     WHERE transcription_status = 'processing'
       AND updated_at < now() - interval '12 minutes'
    RETURNING 1
  )
  SELECT count(*) INTO failed_processing FROM reaped;

  WITH stale_pending AS (
    UPDATE public.discover_videos
       SET transcription_status = 'failed',
           transcription_error = COALESCE(
             transcription_error,
             'Transcription never started - the kickoff request was lost. Use Download & '
             || 'Re-transcribe on the video''s edit page to run it again.'
           )
     WHERE transcription_status = 'pending'
       AND updated_at < now() - interval '15 minutes'
    RETURNING 1
  )
  SELECT count(*) INTO failed_pending FROM stale_pending;

  RETURN jsonb_build_object(
    'finalized', finalized,
    'failed', failed_processing + failed_pending,
    'abandoned', abandoned
  );
END;
$$;
