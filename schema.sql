-- ============================================================
-- XANTEX GLOBAL MARKETS — DATABASE SCHEMA
-- Paste this entire file into:
--   Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

-- UUID extension (enabled by default in Supabase)
create extension if not exists "uuid-ossp";


/* ============================================================
   HELPER: updated_at trigger function (reused by all tables)
============================================================ */
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


/* ============================================================
   HELPER: is_admin() — used by RLS policies
   Ops panel users must be added to the admin_users table.
============================================================ */
create table if not exists public.admin_users (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql security definer stable as $$
  select exists (select 1 from public.admin_users where id = auth.uid());
$$;


/* ============================================================
   1. PROFILES
   One row per Supabase Auth user.
============================================================ */
create table if not exists public.profiles (
  id          uuid        primary key references auth.users(id) on delete cascade,
  first_name  text        not null default '',
  last_name   text        not null default '',
  email       text        unique,
  phone       text,
  country     text,
  kyc_status  text        not null default 'pending'
                check (kyc_status in ('pending','verified','rejected')),
  status      text        not null default 'active'
                check (status in ('active','suspended','closed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users: view own profile"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

create policy "Users: update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users: insert own profile on signup"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Admins: full access to profiles"
  on public.profiles for all
  using (public.is_admin());

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

-- Auto-create profile row when a user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, first_name, last_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name',  '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


/* ============================================================
   2. TRADING ACCOUNTS
============================================================ */
create table if not exists public.trading_accounts (
  id             uuid        primary key default uuid_generate_v4(),
  user_id        uuid        not null references public.profiles(id) on delete cascade,
  account_number text        unique,
  platform       text        not null check (platform in ('MT4','MT5','cTrader','TradingView','Xantex')),
  type           text        not null default 'demo' check (type in ('live','demo')),
  account_type   text        not null default 'Standard',
  currency       text        not null default 'USD',
  balance        numeric(18,2) not null default 0,
  equity         numeric(18,2) not null default 0,
  margin         numeric(18,2) not null default 0,
  free_margin    numeric(18,2) not null default 0,
  leverage       text        not null default '1:200',
  status         text        not null default 'active'
                   check (status in ('active','suspended','closed')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.trading_accounts enable row level security;

create policy "Users: view own accounts"
  on public.trading_accounts for select
  using (auth.uid() = user_id or public.is_admin());

create policy "Users: insert own accounts"
  on public.trading_accounts for insert
  with check (auth.uid() = user_id);

create policy "Admins: full access to accounts"
  on public.trading_accounts for all
  using (public.is_admin());

create trigger trading_accounts_updated_at
  before update on public.trading_accounts
  for each row execute function public.handle_updated_at();

-- Auto-generate a unique account number on insert
create or replace function public.generate_account_number()
returns trigger language plpgsql as $$
begin
  if new.account_number is null then
    new.account_number := '104' || lpad((floor(random() * 90000) + 10000)::text, 5, '0');
  end if;
  return new;
end;
$$;

create trigger set_account_number
  before insert on public.trading_accounts
  for each row execute function public.generate_account_number();

create index idx_ta_user_id on public.trading_accounts(user_id);


/* ============================================================
   3. TRANSACTIONS  (deposits, withdrawals, bonuses, adjustments)
============================================================ */
create table if not exists public.transactions (
  id             uuid        primary key default uuid_generate_v4(),
  user_id        uuid        references public.profiles(id) on delete set null,
  account_id     uuid        references public.trading_accounts(id) on delete set null,
  type           text        not null
                   check (type in ('deposit','withdrawal','bonus','adjustment','transfer')),
  amount         numeric(18,2) not null,
  payment_method text,
  destination    text,
  status         text        not null default 'pending'
                   check (status in ('pending','approved','rejected','processing')),
  description    text,
  reference      text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.transactions enable row level security;

create policy "Users: view own transactions"
  on public.transactions for select
  using (auth.uid() = user_id or public.is_admin());

create policy "Users: insert own transactions"
  on public.transactions for insert
  with check (auth.uid() = user_id);

create policy "Admins: full access to transactions"
  on public.transactions for all
  using (public.is_admin());

create trigger transactions_updated_at
  before update on public.transactions
  for each row execute function public.handle_updated_at();

create index idx_txn_user_id    on public.transactions(user_id);
create index idx_txn_account_id on public.transactions(account_id);
create index idx_txn_type       on public.transactions(type);
create index idx_txn_status     on public.transactions(status);
create index idx_txn_created_at on public.transactions(created_at desc);


/* ============================================================
   4. POSITIONS  (open & closed trades)
============================================================ */
create table if not exists public.positions (
  id             uuid          primary key default uuid_generate_v4(),
  user_id        uuid          references public.profiles(id) on delete set null,
  account_id     uuid          references public.trading_accounts(id) on delete set null,
  account_number text,
  symbol         text          not null,
  direction      text          not null check (direction in ('buy','sell')),
  lots           numeric(10,4) not null,
  open_price     numeric(18,6) not null,
  current_price  numeric(18,6),
  stop_loss      numeric(18,6),
  take_profit    numeric(18,6),
  floating_pnl   numeric(18,2) default 0,
  commission     numeric(18,2) default 0,
  swap           numeric(18,2) default 0,
  status         text          not null default 'open'
                   check (status in ('open','closed','cancelled')),
  opened_at      timestamptz   not null default now(),
  closed_at      timestamptz,
  close_price    numeric(18,6),
  realised_pnl   numeric(18,2)
);

alter table public.positions enable row level security;

create policy "Users: view own positions"
  on public.positions for select
  using (auth.uid() = user_id or public.is_admin());

create policy "Users: insert own positions"
  on public.positions for insert
  with check (auth.uid() = user_id);

create policy "Users: update own positions"
  on public.positions for update
  using (auth.uid() = user_id);

create policy "Admins: full access to positions"
  on public.positions for all
  using (public.is_admin());

create index idx_pos_user_id   on public.positions(user_id);
create index idx_pos_status    on public.positions(status);
create index idx_pos_symbol    on public.positions(symbol);
create index idx_pos_opened_at on public.positions(opened_at desc);


/* ============================================================
   5. KYC SUBMISSIONS
============================================================ */
create table if not exists public.kyc_submissions (
  id               uuid        primary key default uuid_generate_v4(),
  user_id          uuid        not null references public.profiles(id) on delete cascade,
  document_type    text        not null
                     check (document_type in ('Passport','National ID','Driver''s licence')),
  front_url        text,
  back_url         text,
  proof_address_url text,
  status           text        not null default 'pending'
                     check (status in ('pending','verified','rejected')),
  rejection_reason text,
  reviewed_by      text,
  submitted_at     timestamptz not null default now(),
  reviewed_at      timestamptz
);

alter table public.kyc_submissions enable row level security;

create policy "Users: view own KYC"
  on public.kyc_submissions for select
  using (auth.uid() = user_id or public.is_admin());

create policy "Users: submit KYC"
  on public.kyc_submissions for insert
  with check (auth.uid() = user_id);

create policy "Admins: full access to KYC"
  on public.kyc_submissions for all
  using (public.is_admin());

create index idx_kyc_user_id on public.kyc_submissions(user_id);
create index idx_kyc_status  on public.kyc_submissions(status);


/* ============================================================
   6. MARKET PRICES
   Populated by your price feed / admin.
   Publicly readable — no auth required.
============================================================ */
create table if not exists public.market_prices (
  id            uuid          primary key default uuid_generate_v4(),
  symbol        text          not null unique,
  name          text          not null,
  category      text          not null
                  check (category in ('forex','crypto','stocks','indices','metals','energy','etfs')),
  bid           text,
  ask           text,
  price         text,
  change_amount numeric(18,6),
  change_pct    numeric(10,4),
  high_24h      text,
  low_24h       text,
  volume        text,
  market_cap    text,
  updated_at    timestamptz   not null default now()
);

alter table public.market_prices enable row level security;

create policy "Public read for market prices"
  on public.market_prices for select
  to anon, authenticated
  using (true);

create policy "Admins: write market prices"
  on public.market_prices for all
  using (public.is_admin());

create index idx_mp_category on public.market_prices(category);
create index idx_mp_symbol   on public.market_prices(symbol);

-- Seed with the same symbols shown on markets.html
-- (prices will be overwritten by your feed; these are just starting rows)
insert into public.market_prices (symbol, name, category, bid, ask, change_amount, change_pct) values
  ('EUR/USD', 'Euro / US Dollar',            'forex',   '1.08418', '1.08432',  0.00222, 0.21),
  ('GBP/USD', 'British Pound / US Dollar',   'forex',   '1.26704', '1.26718', -0.00228,-0.18),
  ('USD/JPY', 'US Dollar / Japanese Yen',    'forex',   '151.828', '151.842',  0.472,   0.31),
  ('USD/CAD', 'US Dollar / Canadian Dollar', 'forex',   '1.36407', '1.36421',  0.00162, 0.12),
  ('AUD/USD', 'Australian / US Dollar',      'forex',   '0.65200', '0.65214', -0.00059,-0.09),
  ('BTC/USD', 'Bitcoin / US Dollar',         'crypto',  null,       null,       1644,    2.14),
  ('ETH/USD', 'Ethereum / US Dollar',        'crypto',  null,       null,       43,      1.88),
  ('SOL/USD', 'Solana',                       'crypto',  null,       null,       4.42,    3.21),
  ('XAU/USD', 'Gold / US Dollar',            'metals',  '2340.8', '2341.5',    20.2,    0.87),
  ('XAG/USD', 'Silver / US Dollar',          'metals',  '27.830', '27.842',    0.340,   1.24),
  ('WTI/USD', 'Crude Oil WTI',               'energy',  '82.28',  '82.34',    -0.454,  -0.55),
  ('BRT/USD', 'Brent Crude',                 'energy',  '86.66',  '86.72',    -0.366,  -0.42),
  ('US30',    'Dow Jones Industrial',         'indices', null,      null,        121,     0.31),
  ('SPX500',  'S&P 500',                      'indices', null,      null,        25,      0.48),
  ('NAS100',  'NASDAQ 100',                   'indices', null,      null,        131,     0.72),
  ('AAPL',    'Apple Inc.',                   'stocks',  null,      null,        1.52,    0.84),
  ('MSFT',    'Microsoft Corp.',              'stocks',  null,      null,        4.58,    1.12),
  ('TSLA',    'Tesla Inc.',                   'stocks',  null,      null,       -3.76,   -2.14),
  ('NVDA',    'NVIDIA Corp.',                 'stocks',  null,      null,       27.14,    3.21),
  ('SPY',     'SPDR S&P 500 ETF',            'etfs',    null,      null,        2.52,    0.48),
  ('QQQ',     'Invesco QQQ Trust',            'etfs',    null,      null,        3.18,    0.71)
on conflict (symbol) do nothing;


/* ============================================================
   7. ANNOUNCEMENTS
============================================================ */
create table if not exists public.announcements (
  id           uuid        primary key default uuid_generate_v4(),
  title        text        not null,
  body         text,
  type         text        not null default 'info'
                 check (type in ('info','warning','success','urgent')),
  audience     text        not null default 'All Users',
  scheduled_at timestamptz,
  published    boolean     not null default true,
  created_at   timestamptz not null default now()
);

alter table public.announcements enable row level security;

create policy "Authenticated users: read published announcements"
  on public.announcements for select
  to authenticated
  using (published = true);

create policy "Anon users: read published announcements"
  on public.announcements for select
  to anon
  using (published = true);

create policy "Admins: full access to announcements"
  on public.announcements for all
  using (public.is_admin());

create index idx_ann_created_at on public.announcements(created_at desc);


/* ============================================================
   8. AUDIT LOG
   Written only by server-side / admin actions.
   Not readable by regular users (no select policy for non-admins).
============================================================ */
create table if not exists public.audit_log (
  id           uuid        primary key default uuid_generate_v4(),
  admin_id     uuid        references auth.users(id) on delete set null,
  admin_email  text,
  action       text        not null,
  target       text,
  details      text,
  ip_address   text,
  created_at   timestamptz not null default now()
);

alter table public.audit_log enable row level security;

create policy "Admins: full access to audit log"
  on public.audit_log for all
  using (public.is_admin());

create index idx_audit_created_at on public.audit_log(created_at desc);
create index idx_audit_admin_id   on public.audit_log(admin_id);


/* ============================================================
   DONE
   After running this script:

   1. Register an account at /register.html
   2. In Supabase → Table Editor → admin_users
      → Insert your user's UUID and email
   3. That account now has admin access to ops.html

   To find your UUID:
      Supabase → Authentication → Users → copy the UUID
============================================================ */
