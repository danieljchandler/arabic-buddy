-- Quiz Phase 5: animations for action words.
--
-- The shared asset store's one video kind (`kind: "animation"` in
-- word_assets) keeps a four-second looping MP4 and the still it starts from
-- in a bucket of its own:
--
--   * public, because the quiz plays a clip by its public URL, exactly as it
--     shows a picture from flashcard-images. No storage.objects policy is
--     added: a public bucket serves its objects by URL without one, and
--     nobody needs to list it;
--   * written by the service role alone. There is no INSERT, UPDATE or
--     DELETE policy for anon or authenticated, so the only writer is
--     word-asset, which names every object itself (word-assets/animation/…,
--     a fresh name per file, never overwritten);
--   * limited to what a clip and its poster are. A 720p four-second clip is
--     one to three megabytes; 8 MB leaves room and refuses anything that is
--     not the clip that was asked for, as does the type list.
--
-- Until this is applied to the live project the bucket does not exist, every
-- upload fails, and word-asset files no animation (the script stops on its
-- first word and says so). Nothing a learner sees changes: no clip is filed,
-- so every lookup misses and the quiz shows the picture, as before.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'word-animations',
  'word-animations',
  true,
  8388608,
  ARRAY['video/mp4', 'image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;
