-- Content-library bridge: attribution and the library's id on discover_videos.
--
-- creator_name / creator_handle have never existed on this table —
-- trending_video_candidates collects them and the promotion drops them — so
-- no published video knows who made it. library_item_id is what makes a
-- dispatch from Maktaba idempotent and lets the library ask after its row.
-- See docs/content-library-architecture.md §4.3.
--
-- Apply this to the live project (Lovable or `supabase db push`); a migration
-- merged through GitHub alone is not applied there, and the next types
-- regeneration would drop these columns from types.ts. See CLAUDE.md.

alter table public.discover_videos
  add column if not exists library_item_id uuid,
  add column if not exists creator_name    text,
  add column if not exists creator_handle  text;

create index if not exists discover_videos_library_item_idx
  on public.discover_videos (library_item_id)
  where library_item_id is not null;
