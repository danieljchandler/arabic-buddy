# Storage Bucket Lockdown — Finish the Job

## Problem

Chunk 2 added strict owner/admin policies (`lahja_*`) but the **old permissive policies were never removed**. Because RLS policies are OR'd, the loose ones still win:

- `Authenticated users can upload memes` — any logged-in user can write anywhere in `meme-uploads`
- `Authenticated users can upload tutor audio clips` — same for `tutor-audio-clips`
- `Users can delete own meme uploads` — any logged-in user can delete any meme
- `Users can delete their own tutor audio clips` — any logged-in user can delete any clip
- Per-bucket admin policies duplicated by `lahja_admin_*` (harmless but noisy)
- Per-bucket avatar policies duplicated by `lahja_owner_*` (harmless but noisy)
- Per-bucket public read policies duplicated by `lahja_public_read` (harmless but noisy)

Until the loose ones are dropped, the lockdown is cosmetic.

## Migration

Single migration that drops the redundant/loose policies. Keeps the `lahja_*` set and the `video-audio` (private bucket) admin policies untouched.

```sql
-- Drop loose write/delete policies that bypass owner check
DROP POLICY IF EXISTS "Authenticated users can upload memes" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload tutor audio clips" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own meme uploads" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own tutor audio clips" ON storage.objects;

-- Drop avatar policies superseded by lahja_owner_* (same auth.uid folder check)
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;

-- Drop per-bucket public read superseded by lahja_public_read
DROP POLICY IF EXISTS "Anyone can read audio files" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view flashcard audio" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view flashcard images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view tutor audio clips" ON storage.objects;
DROP POLICY IF EXISTS "Public read access to meme uploads" ON storage.objects;

-- Drop per-bucket admin write/delete superseded by lahja_admin_*
DROP POLICY IF EXISTS "Admins can upload audio files" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update audio files" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete audio files" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload flashcard audio" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update flashcard audio" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete flashcard audio" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload flashcard images" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update flashcard images" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete flashcard images" ON storage.objects;
```

`video-audio` policies (`Admins can read/upload/update/delete video-audio files`) stay — that bucket is private and not covered by `lahja_*`.

## Post-migration end state

- `avatars`, `meme-uploads`, `tutor-audio-clips`: writes/deletes only by owner (uid-prefixed folder), public read
- `flashcard-images`, `flashcard-audio`, `audio`: writes/deletes only by admins, public read
- `video-audio`: admin-only everything (private)

## Verification after apply

1. Re-run the `pg_policy` query — confirm the dropped names are gone and `lahja_*` remain.
2. Quick app smoke: a non-admin user can still upload a meme/tutor clip to their own folder, can't write outside it.
3. Avatar upload from Settings still works.

## Risk

Low. The `lahja_*` policies use the same `(storage.foldername(name))[1] = auth.uid()::text` pattern that existing client code already follows (avatar upload uses the uid prefix). The legacy meme/tutor policies were *looser* than the new ones, so any code that was working under them will continue to work under `lahja_owner_*` **only if** it uploads under `{uid}/...`. I'll verify the upload paths in `useTutorUpload.ts` and the meme uploader use that prefix before applying — if either uploads to a flat path, I'll add a small client fix in the same chunk.

Approve and I'll switch to build, verify the upload paths, then run the migration.
