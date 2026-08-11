-- Per-user AI spending tracker — daily cost ceiling for free-tier users.
-- Tracks actual spend (in cents) per user per day to enforce a global budget
-- instead of relying solely on per-feature call counts.
--
-- This prevents the "free tier, all caps hit" scenario where a user maxes every
-- feature in one day, costing $1000+/month in OpenAI/Gemini fees.

create table if not exists public.user_ai_spend (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  spend_date date not null default current_date,
  total_cents integer not null default 0,  -- Accumulated spend in cents (e.g., 1000 = $10.00)
  feature_breakdown jsonb default '{}'::jsonb,  -- {"word-enrichment": 150, "munsit-tts": 240, ...}
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  constraint unique_user_per_day unique (user_id, spend_date)
);

-- Index for fast daily lookups
create index if not exists idx_user_ai_spend_user_date
  on public.user_ai_spend(user_id, spend_date desc);

-- RLS: users can only see their own spend
alter table public.user_ai_spend enable row level security;

create policy "users_can_view_own_spend"
  on public.user_ai_spend for select
  using (auth.uid() = user_id or is_admin());

create policy "service_role_full_access"
  on public.user_ai_spend
  using (auth.jwt() ->> 'role' = 'service_role');

-- Function to add spend to user's daily total
-- Returns the new total in cents so caller can check if limit exceeded
create or replace function increment_user_ai_spend(
  _user_id uuid,
  _feature text,
  _cents integer
) returns integer as $$
declare
  current_total integer;
  feature_breakdown jsonb;
begin
  -- Upsert today's spend record
  insert into public.user_ai_spend (user_id, spend_date, total_cents, feature_breakdown)
  values (_user_id, current_date, _cents, jsonb_build_object(_feature, _cents))
  on conflict (user_id, spend_date)
  do update set
    total_cents = public.user_ai_spend.total_cents + _cents,
    feature_breakdown =
      public.user_ai_spend.feature_breakdown ||
      jsonb_build_object(_feature, coalesce((public.user_ai_spend.feature_breakdown ->> _feature)::integer, 0) + _cents),
    updated_at = now()
  returning public.user_ai_spend.total_cents into current_total;

  return current_total;
end;
$$ language plpgsql security definer;

-- Function to get today's spend for a user
create or replace function get_user_daily_spend(_user_id uuid) returns integer as $$
declare
  current_spend integer;
begin
  select total_cents into current_spend
  from public.user_ai_spend
  where user_id = _user_id and spend_date = current_date;

  return coalesce(current_spend, 0);
end;
$$ language plpgsql security definer;

-- View: daily spend by feature
create or replace view public.user_ai_spend_by_feature as
select
  user_id,
  spend_date,
  jsonb_object_keys(feature_breakdown) as feature,
  (feature_breakdown ->> jsonb_object_keys(feature_breakdown))::integer as cents
from public.user_ai_spend
where feature_breakdown != '{}'::jsonb;

-- View: overall spending stats
create or replace view public.user_ai_spend_stats as
select
  user_id,
  spend_date,
  total_cents,
  (total_cents::numeric / 100) as total_usd,
  jsonb_object_keys(feature_breakdown) as top_feature,
  (feature_breakdown -> jsonb_object_keys(feature_breakdown))::integer as top_feature_cents
from public.user_ai_spend
where spend_date >= current_date - interval '7 days'
order by spend_date desc, total_cents desc;
