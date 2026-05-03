-- rpc.sql — Server-side RPC functions for reliable data access
-- Run in: Supabase Dashboard → SQL Editor → Run All
-- These run as SECURITY DEFINER so they bypass RLS while still
-- filtering by the calling user's auth.uid().

-- ── 1. Get calling user's trading accounts ───────────────────
create or replace function public.get_my_accounts()
returns setof public.trading_accounts
language sql security definer stable
as $$
  select * from public.trading_accounts
  where user_id = auth.uid()
  order by created_at desc;
$$;
grant execute on function public.get_my_accounts() to authenticated, anon;

-- ── 2. Get calling user's open positions ─────────────────────
create or replace function public.get_my_positions()
returns setof public.positions
language sql security definer stable
as $$
  select * from public.positions
  where user_id = auth.uid() and status = 'open'
  order by opened_at desc;
$$;
grant execute on function public.get_my_positions() to authenticated, anon;

-- ── 3. Get calling user's recent transactions ─────────────────
create or replace function public.get_my_transactions()
returns table (
  type text, amount numeric, status text,
  created_at timestamptz, description text
)
language sql security definer stable
as $$
  select type, amount, status, created_at, description
  from public.transactions
  where user_id = auth.uid()
  order by created_at desc
  limit 20;
$$;
grant execute on function public.get_my_transactions() to authenticated, anon;

-- ── 4. Get calling user's deposit requests ────────────────────
create or replace function public.get_my_deposits()
returns table (
  id uuid, amount numeric, status text, created_at timestamptz
)
language sql security definer stable
as $$
  select id, amount, status, created_at
  from public.deposit_requests
  where user_id = auth.uid()
  order by created_at desc;
$$;
grant execute on function public.get_my_deposits() to authenticated, anon;

-- ── 5. Get calling user's withdrawal requests ─────────────────
create or replace function public.get_my_withdrawals()
returns table (
  id uuid, amount numeric, status text, created_at timestamptz
)
language sql security definer stable
as $$
  select id, amount, status, created_at
  from public.withdrawal_requests
  where user_id = auth.uid()
  order by created_at desc;
$$;
grant execute on function public.get_my_withdrawals() to authenticated, anon;

-- ── 6. Get calling user's profile ────────────────────────────
create or replace function public.get_my_profile()
returns setof public.profiles
language sql security definer stable
as $$
  select * from public.profiles where id = auth.uid();
$$;
grant execute on function public.get_my_profile() to authenticated, anon;
