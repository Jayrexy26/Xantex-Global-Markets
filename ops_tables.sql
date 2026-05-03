-- ops_tables.sql
-- Run once in: Supabase Dashboard → SQL Editor → Run All
-- Creates the 3 new tables needed for ops.html admin features:
-- support_tickets, notifications, trades
-- Also adds trade_percent + trades_active columns to profiles.

-- ── 1. Support Tickets ────────────────────────────────────────
create table if not exists public.support_tickets (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references public.profiles(id) on delete cascade,
  subject     text,
  message     text not null,
  status      text not null default 'open',
  admin_reply text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.support_tickets enable row level security;

-- Users can only see/insert their own tickets
create policy "users can read own tickets"
  on public.support_tickets for select
  using (user_id = auth.uid());

create policy "users can insert own tickets"
  on public.support_tickets for insert
  with check (user_id = auth.uid());

-- Authenticated can update (admin uses anon key with bypass via admin_users check)
create policy "authenticated can update tickets"
  on public.support_tickets for all
  using (true);

-- ── 2. User Notifications ─────────────────────────────────────
create table if not exists public.notifications (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references public.profiles(id) on delete cascade unique,
  title       text,
  message     text,
  enabled     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.notifications enable row level security;

-- Users can read their own notification
create policy "users can read own notifications"
  on public.notifications for select
  using (user_id = auth.uid());

-- Admin (authenticated) can manage all
create policy "authenticated can manage notifications"
  on public.notifications for all
  using (true);

-- ── 3. Trades History ─────────────────────────────────────────
create table if not exists public.trades (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references public.profiles(id) on delete cascade,
  market      text,
  pair        text,
  direction   text,
  size        numeric,
  pnl         numeric default 0,
  created_at  timestamptz not null default now()
);

alter table public.trades enable row level security;

-- Users can read their own trades
create policy "users can read own trades"
  on public.trades for select
  using (user_id = auth.uid());

-- Authenticated (admin) can manage all
create policy "authenticated can manage trades"
  on public.trades for all
  using (true);

-- ── 4. Profile columns for trade settings ────────────────────
alter table public.profiles
  add column if not exists trades_active  boolean default false,
  add column if not exists trade_percent  numeric default 0;
