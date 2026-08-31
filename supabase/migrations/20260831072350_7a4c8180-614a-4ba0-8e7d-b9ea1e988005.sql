-- Transcript reviewers (admins, content reviewers, transcribers) need to hear
-- the clip they are correcting. The staged audio lives in the private
-- `video-audio` bucket, whose SELECT policy was admin-only, so a transcriber's
-- signed-URL request returned nothing and the review page had no player at all.
DROP POLICY IF EXISTS "Reviewers can read video audio" ON storage.objects;
CREATE POLICY "Reviewers can read video audio"
ON storage.objects
FOR SELECT
USING (bucket_id = 'video-audio' AND public.can_review_transcripts());