-- Voice session tracking for live voice conversations
-- Tracks session start/stop, duration, and closure reason for cost control and analytics
create table if not exists public.voice_sessions (
  id bigserial primary key,
  session_id text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('practice', 'assistant')),
  dialect text not null,
  started_at timestamp with time zone not null default now(),
  ended_at timestamp with time zone,
  last_heartbeat_at timestamp with time zone,
  status text not null default 'active' check (status in ('active', 'closed')),
  duration_seconds integer,
  close_reason text check (close_reason in ('user_disconnected', 'idle_timeout', 'duration_limit', 'error')),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

-- Indexes for fast lookups
create index if not exists idx_voice_sessions_user_id on public.voice_sessions(user_id);
create index if not exists idx_voice_sessions_created_at on public.voice_sessions(created_at desc);
create index if not exists idx_voice_sessions_status on public.voice_sessions(status);

-- RLS: users can only see their own sessions
alter table public.voice_sessions enable row level security;

create policy "users_can_view_own_sessions"
  on public.voice_sessions for select
  using (auth.uid() = user_id or is_admin());

create policy "service_role_full_access"
  on public.voice_sessions
  using (auth.jwt() ->> 'role' = 'service_role');

-- Helper function to check admin status
create or replace function is_admin() returns boolean as $$
begin
  return exists(
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'admin'
  );
end;
$$ language plpgsql security definer;

-- Utility view: daily voice session metrics by user
create or replace view public.daily_voice_metrics as
select
  date_trunc('day', started_at) as day,
  user_id,
  count(*) as session_count,
  sum(duration_seconds)::integer as total_duration_seconds,
  avg(duration_seconds)::integer as avg_duration_seconds,
  count(case when close_reason = 'duration_limit' then 1 end) as sessions_hit_limit,
  count(case when close_reason = 'idle_timeout' then 1 end) as sessions_idle_timeout
from public.voice_sessions
where status = 'closed'
group by date_trunc('day', started_at), user_id;
