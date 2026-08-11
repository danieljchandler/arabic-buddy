-- Shared vocabulary enrichment cache.
-- Stores AI-generated enrichments (definitions, roots, transliterations, related words)
-- indexed by normalized word/phrase and dialect. Reused across all users to reduce
-- Claude/Gemini calls by 30-50% on repeat words.
--
-- Design: deduplicate by (word_normalized, dialect, is_phrase) so common words
-- hit the cache after the first user learns them. TTL can be added later if
-- enrichments need to be refreshed for quality reasons.

create table if not exists public.vocabulary_enrichments (
  id bigserial primary key,
  word text not null,
  word_normalized text not null,
  dialect text not null check (dialect in ('Gulf', 'Egyptian', 'Levantine', 'Yemeni', 'North African')),
  is_phrase boolean not null default false,

  -- AI-generated enrichment fields
  definition text,
  literal text,  -- word-for-word gloss for phrases
  root text,
  transliteration text,
  uses jsonb,    -- array of {arabic, english} objects

  -- Metadata
  generated_by text,  -- e.g. 'ensemble', 'solo', for tracking strategy changes
  msa_repairs integer default 0,  -- count of dialect repairs applied

  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  hit_count integer not null default 1,  -- how many times this has been used

  constraint unique_word_dialect unique (word_normalized, dialect, is_phrase)
);

-- Indexes for fast lookups
create index if not exists idx_vocabulary_enrichments_word_dialect
  on public.vocabulary_enrichments(word_normalized, dialect);
create index if not exists idx_vocabulary_enrichments_hit_count
  on public.vocabulary_enrichments(hit_count desc);
create index if not exists idx_vocabulary_enrichments_created_at
  on public.vocabulary_enrichments(created_at desc);

-- RLS: public read, service role write
alter table public.vocabulary_enrichments enable row level security;

create policy "public_can_read_enrichments"
  on public.vocabulary_enrichments for select
  using (true);

create policy "service_role_full_access"
  on public.vocabulary_enrichments
  using (auth.jwt() ->> 'role' = 'service_role');

-- Function to normalize words for consistent cache lookups
-- Removes diacritics, normalizes whitespace, lowercase for comparison
create or replace function normalize_word(word text, is_phrase boolean) returns text as $$
declare
  normalized text;
begin
  -- Remove combining diacriticals (tashkeel)
  normalized := regexp_replace(word, '[ًٌٍَُِّْ]', '', 'g');
  -- Normalize whitespace (trim + collapse multiple spaces)
  normalized := regexp_replace(trim(normalized), '\s+', ' ', 'g');
  -- For phrase caching: preserve spaces for multi-word lookups
  return normalized;
end;
$$ language plpgsql immutable;

-- Utility view: cache statistics
create or replace view public.vocabulary_cache_stats as
select
  dialect,
  count(*) as total_entries,
  count(case when hit_count > 1 then 1 end) as reused_entries,
  avg(hit_count)::numeric(5,2) as avg_hits,
  max(hit_count) as most_popular_hits,
  min(created_at) as oldest_entry,
  max(updated_at) as latest_update
from public.vocabulary_enrichments
group by dialect;
