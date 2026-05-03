-- banned_users.sql
-- Run once in: Supabase Dashboard → SQL Editor → Run All
-- Tracks deleted accounts so dashboard.html can force sign-out
-- even though auth.users entries aren't removed by the client.

create table if not exists public.banned_users (
  user_id   uuid primary key,
  banned_at timestamptz not null default now()
);

-- Only service role / admin can write; anyone can read (needed by dashboard ban check)
alter table public.banned_users enable row level security;

create policy "anyone can read banned_users"
  on public.banned_users for select
  using (true);

create policy "service role can manage banned_users"
  on public.banned_users for all
  using (auth.role() = 'service_role');

-- Allow the anon/authenticated keys used by the frontend to insert
-- (the admin panel uses the anon key to write the ban record after deletion)
create policy "authenticated can insert banned_users"
  on public.banned_users for insert
  with check (true);
