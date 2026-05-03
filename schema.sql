-- ============================================================
-- XANTEX GLOBAL MARKETS — COMPLETE DATABASE SCHEMA
-- Run in: Supabase Dashboard → SQL Editor → New query → Run All
-- Safe to re-run: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
-- ============================================================

create extension if not exists "uuid-ossp";

-- ── Shared trigger helper ────────────────────────────────────
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;


-- ============================================================
-- 1. admin_users  (must come before is_admin())
-- ============================================================
create table if not exists public.admin_users (
  id         uuid        primary key references auth.users(id) on delete cascade,
  email      text        not null,
  role       text        not null default 'admin' check (role in ('admin','superadmin')),
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;

create or replace function public.is_admin()
returns boolean language sql security definer stable as $$
  select exists (select 1 from public.admin_users where id = auth.uid());
$$;


-- ============================================================
-- 2. profiles  (patch — table already exists)
-- ============================================================
alter table public.profiles
  add column if not exists first_name  text        not null default '',
  add column if not exists last_name   text        not null default '',
  add column if not exists phone       text,
  add column if not exists country     text,
  add column if not exists date_of_birth date,
  add column if not exists kyc_status  text        not null default 'pending',
  add column if not exists status      text        not null default 'active',
  add column if not exists updated_at  timestamptz not null default now();

do $$ begin
  alter table public.profiles add constraint profiles_kyc_check
    check (kyc_status in ('pending','verified','rejected'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_status_check
    check (status in ('active','suspended','closed'));
exception when duplicate_object then null; end $$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, first_name, last_name)
  values (
    new.id, new.email,
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

alter table public.profiles enable row level security;
drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_update" on public.profiles;
drop policy if exists "profiles_insert" on public.profiles;
drop policy if exists "profiles_admin"  on public.profiles;
create policy "profiles_select" on public.profiles for select using (auth.uid() = id or public.is_admin());
create policy "profiles_update" on public.profiles for update using (auth.uid() = id);
create policy "profiles_insert" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_admin"  on public.profiles for all    using (public.is_admin());


-- ============================================================
-- 3. trading_accounts
-- ============================================================
create table if not exists public.trading_accounts (
  id             uuid          primary key default uuid_generate_v4(),
  user_id        uuid          not null references public.profiles(id) on delete cascade,
  account_number text          unique,
  platform       text          not null default 'MT5' check (platform in ('MT4','MT5','cTrader','TradingView','Xantex')),
  type           text          not null default 'demo' check (type in ('live','demo')),
  account_type   text          not null default 'Standard',
  currency       text          not null default 'USD',
  balance        numeric(18,2) not null default 0,
  equity         numeric(18,2) not null default 0,
  margin         numeric(18,2) not null default 0,
  free_margin    numeric(18,2) not null default 0,
  leverage       text          not null default '1:200',
  status         text          not null default 'active'
                   check (status in ('active','suspended','closed')),
  created_at     timestamptz   not null default now(),
  updated_at     timestamptz   not null default now()
);
drop trigger if exists ta_updated_at on public.trading_accounts;
create trigger ta_updated_at before update on public.trading_accounts
  for each row execute function public.handle_updated_at();

create or replace function public.generate_account_number()
returns trigger language plpgsql as $$
begin
  if new.account_number is null then
    new.account_number := '104' || lpad((floor(random() * 900000 + 10000))::text, 6, '0');
  end if;
  return new;
end;
$$;
drop trigger if exists set_account_number on public.trading_accounts;
create trigger set_account_number before insert on public.trading_accounts
  for each row execute function public.generate_account_number();

create index if not exists idx_ta_user_id on public.trading_accounts(user_id);

alter table public.trading_accounts enable row level security;
drop policy if exists "ta_select" on public.trading_accounts;
drop policy if exists "ta_insert" on public.trading_accounts;
drop policy if exists "ta_admin"  on public.trading_accounts;
create policy "ta_select" on public.trading_accounts for select using (auth.uid() = user_id or public.is_admin());
create policy "ta_insert" on public.trading_accounts for insert with check (auth.uid() = user_id);
create policy "ta_admin"  on public.trading_accounts for all    using (public.is_admin());


-- ============================================================
-- 4. transactions  (patch — table already exists)
-- ============================================================
alter table public.transactions
  add column if not exists account_id     uuid,
  add column if not exists status         text        not null default 'completed',
  add column if not exists payment_method text,
  add column if not exists destination    text,
  add column if not exists description    text,
  add column if not exists reference      text,
  add column if not exists updated_at     timestamptz not null default now();

do $$ begin
  alter table public.transactions add constraint txn_status_check
    check (status in ('pending','completed','failed','reversed'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.transactions add constraint txn_type_check
    check (type in ('deposit','withdrawal','bonus','adjustment','transfer','fee','trade_pnl'));
exception when duplicate_object then null; end $$;

drop trigger if exists txn_updated_at on public.transactions;
create trigger txn_updated_at before update on public.transactions
  for each row execute function public.handle_updated_at();

create index if not exists idx_txn_user_id    on public.transactions(user_id);
create index if not exists idx_txn_account_id on public.transactions(account_id);
create index if not exists idx_txn_type       on public.transactions(type);
create index if not exists idx_txn_status     on public.transactions(status);
create index if not exists idx_txn_created_at on public.transactions(created_at desc);

alter table public.transactions enable row level security;
drop policy if exists "txn_select" on public.transactions;
drop policy if exists "txn_insert" on public.transactions;
drop policy if exists "txn_admin"  on public.transactions;
create policy "txn_select" on public.transactions for select using (auth.uid() = user_id or public.is_admin());
create policy "txn_insert" on public.transactions for insert with check (auth.uid() = user_id);
create policy "txn_admin"  on public.transactions for all    using (public.is_admin());

-- Add FK after trading_accounts exists
do $$ begin
  alter table public.transactions
    add constraint txn_account_id_fkey
      foreign key (account_id) references public.trading_accounts(id) on delete set null;
exception when duplicate_object then null; end $$;


-- ============================================================
-- 5. deposit_requests
-- ============================================================
create table if not exists public.deposit_requests (
  id             uuid          primary key default uuid_generate_v4(),
  user_id        uuid          not null references public.profiles(id) on delete cascade,
  account_id     uuid          references public.trading_accounts(id) on delete set null,
  amount         numeric(18,2) not null,
  currency       text          not null default 'USD',
  payment_method text          not null default 'Bank Transfer',
  proof_url      text,
  reference      text,
  notes          text,
  status         text          not null default 'pending'
                   check (status in ('pending','approved','rejected','processing')),
  reviewed_by    uuid          references auth.users(id) on delete set null,
  reviewed_at    timestamptz,
  created_at     timestamptz   not null default now(),
  updated_at     timestamptz   not null default now()
);
drop trigger if exists dep_req_updated_at on public.deposit_requests;
create trigger dep_req_updated_at before update on public.deposit_requests
  for each row execute function public.handle_updated_at();

create index if not exists idx_dep_user_id    on public.deposit_requests(user_id);
create index if not exists idx_dep_status     on public.deposit_requests(status);
create index if not exists idx_dep_created_at on public.deposit_requests(created_at desc);

alter table public.deposit_requests enable row level security;
drop policy if exists "dep_select" on public.deposit_requests;
drop policy if exists "dep_insert" on public.deposit_requests;
drop policy if exists "dep_admin"  on public.deposit_requests;
create policy "dep_select" on public.deposit_requests for select using (auth.uid() = user_id or public.is_admin());
create policy "dep_insert" on public.deposit_requests for insert with check (auth.uid() = user_id);
create policy "dep_admin"  on public.deposit_requests for all    using (public.is_admin());


-- ============================================================
-- 6. withdrawal_requests
-- ============================================================
create table if not exists public.withdrawal_requests (
  id               uuid          primary key default uuid_generate_v4(),
  user_id          uuid          not null references public.profiles(id) on delete cascade,
  account_id       uuid          references public.trading_accounts(id) on delete set null,
  amount           numeric(18,2) not null,
  currency         text          not null default 'USD',
  destination_type text          not null default 'Bank Transfer'
                     check (destination_type in ('Bank Transfer','Card','Crypto','E-Wallet','Internal')),
  destination_name text,
  destination_ref  text,
  notes            text,
  status           text          not null default 'pending'
                     check (status in ('pending','approved','rejected','processing','completed')),
  reviewed_by      uuid          references auth.users(id) on delete set null,
  reviewed_at      timestamptz,
  processed_at     timestamptz,
  created_at       timestamptz   not null default now(),
  updated_at       timestamptz   not null default now()
);
drop trigger if exists wd_req_updated_at on public.withdrawal_requests;
create trigger wd_req_updated_at before update on public.withdrawal_requests
  for each row execute function public.handle_updated_at();

create index if not exists idx_wd_user_id    on public.withdrawal_requests(user_id);
create index if not exists idx_wd_status     on public.withdrawal_requests(status);
create index if not exists idx_wd_created_at on public.withdrawal_requests(created_at desc);

alter table public.withdrawal_requests enable row level security;
drop policy if exists "wd_select" on public.withdrawal_requests;
drop policy if exists "wd_insert" on public.withdrawal_requests;
drop policy if exists "wd_admin"  on public.withdrawal_requests;
create policy "wd_select" on public.withdrawal_requests for select using (auth.uid() = user_id or public.is_admin());
create policy "wd_insert" on public.withdrawal_requests for insert with check (auth.uid() = user_id);
create policy "wd_admin"  on public.withdrawal_requests for all    using (public.is_admin());


-- ============================================================
-- 7. positions
-- ============================================================
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
create index if not exists idx_pos_user_id   on public.positions(user_id);
create index if not exists idx_pos_status    on public.positions(status);
create index if not exists idx_pos_symbol    on public.positions(symbol);
create index if not exists idx_pos_opened_at on public.positions(opened_at desc);

alter table public.positions enable row level security;
drop policy if exists "pos_select" on public.positions;
drop policy if exists "pos_insert" on public.positions;
drop policy if exists "pos_update" on public.positions;
drop policy if exists "pos_admin"  on public.positions;
create policy "pos_select" on public.positions for select using (auth.uid() = user_id or public.is_admin());
create policy "pos_insert" on public.positions for insert with check (auth.uid() = user_id);
create policy "pos_update" on public.positions for update using (auth.uid() = user_id);
create policy "pos_admin"  on public.positions for all    using (public.is_admin());


-- ============================================================
-- 8. kyc_submissions
-- ============================================================
create table if not exists public.kyc_submissions (
  id                uuid        primary key default uuid_generate_v4(),
  user_id           uuid        not null references public.profiles(id) on delete cascade,
  document_type     text        not null
                      check (document_type in ('Passport','National ID','Driver''s licence')),
  front_url         text,
  back_url          text,
  selfie_url        text,
  proof_address_url text,
  status            text        not null default 'pending'
                      check (status in ('pending','verified','rejected')),
  rejection_reason  text,
  reviewed_by       uuid        references auth.users(id) on delete set null,
  submitted_at      timestamptz not null default now(),
  reviewed_at       timestamptz
);
create index if not exists idx_kyc_user_id on public.kyc_submissions(user_id);
create index if not exists idx_kyc_status  on public.kyc_submissions(status);

alter table public.kyc_submissions enable row level security;
drop policy if exists "kyc_select" on public.kyc_submissions;
drop policy if exists "kyc_insert" on public.kyc_submissions;
drop policy if exists "kyc_admin"  on public.kyc_submissions;
create policy "kyc_select" on public.kyc_submissions for select using (auth.uid() = user_id or public.is_admin());
create policy "kyc_insert" on public.kyc_submissions for insert with check (auth.uid() = user_id);
create policy "kyc_admin"  on public.kyc_submissions for all    using (public.is_admin());


-- ============================================================
-- 9. market_prices  (reference / cache — live prices from frontend)
-- ============================================================
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
create index if not exists idx_mp_category on public.market_prices(category);
create index if not exists idx_mp_symbol   on public.market_prices(symbol);

alter table public.market_prices enable row level security;
drop policy if exists "mp_public_read" on public.market_prices;
drop policy if exists "mp_admin_write" on public.market_prices;
create policy "mp_public_read" on public.market_prices for select to anon, authenticated using (true);
create policy "mp_admin_write" on public.market_prices for all using (public.is_admin());

insert into public.market_prices (symbol, name, category) values
  ('EUR/USD','Euro / US Dollar','forex'),    ('GBP/USD','British Pound / US Dollar','forex'),
  ('USD/JPY','US Dollar / Japanese Yen','forex'), ('USD/CAD','US Dollar / Canadian Dollar','forex'),
  ('USD/CHF','US Dollar / Swiss Franc','forex'),  ('AUD/USD','Australian / US Dollar','forex'),
  ('NZD/USD','New Zealand / US Dollar','forex'),  ('EUR/GBP','Euro / British Pound','forex'),
  ('EUR/JPY','Euro / Japanese Yen','forex'),       ('GBP/JPY','British Pound / Japanese Yen','forex'),
  ('BTC/USD','Bitcoin','crypto'),  ('ETH/USD','Ethereum','crypto'),  ('SOL/USD','Solana','crypto'),
  ('XRP/USD','Ripple','crypto'),   ('BNB/USD','BNB','crypto'),       ('ADA/USD','Cardano','crypto'),
  ('DOT/USD','Polkadot','crypto'), ('DOGE/USD','Dogecoin','crypto'), ('AVAX/USD','Avalanche','crypto'),
  ('LINK/USD','Chainlink','crypto'),
  ('XAU/USD','Gold','metals'),   ('XAG/USD','Silver','metals'),
  ('XPT/USD','Platinum','metals'),('XPD/USD','Palladium','metals'), ('HG/USD','Copper','metals'),
  ('WTI/USD','Crude Oil WTI','energy'), ('BRT/USD','Brent Crude','energy'),
  ('NGAS','Natural Gas','energy'),      ('RBOB','Gasoline RBOB','energy'),
  ('US30','Dow Jones Industrial','indices'), ('SPX500','S&P 500','indices'),
  ('NAS100','NASDAQ 100','indices'),          ('UK100','FTSE 100','indices'),
  ('GER40','DAX 40','indices'),               ('FRA40','CAC 40','indices'),
  ('JPN225','Nikkei 225','indices'),          ('HK50','Hang Seng','indices'),
  ('AAPL','Apple Inc.','stocks'),  ('MSFT','Microsoft Corp.','stocks'), ('GOOGL','Alphabet Inc.','stocks'),
  ('AMZN','Amazon.com','stocks'),  ('TSLA','Tesla Inc.','stocks'),       ('NVDA','NVIDIA Corp.','stocks'),
  ('META','Meta Platforms','stocks'), ('JPM','JPMorgan Chase','stocks'),
  ('V','Visa Inc.','stocks'),         ('WMT','Walmart Inc.','stocks'),
  ('SPY','SPDR S&P 500 ETF','etfs'), ('QQQ','Invesco QQQ','etfs'),
  ('GLD','SPDR Gold Shares','etfs'), ('SLV','iShares Silver','etfs'),
  ('VTI','Vanguard Total Market','etfs'), ('XLE','Energy Select SPDR','etfs'),
  ('ARKK','ARK Innovation ETF','etfs'), ('XLK','Technology Select SPDR','etfs')
on conflict (symbol) do nothing;


-- ============================================================
-- 10. announcements
-- ============================================================
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
create index if not exists idx_ann_created_at on public.announcements(created_at desc);

alter table public.announcements enable row level security;
drop policy if exists "ann_auth_read" on public.announcements;
drop policy if exists "ann_anon_read" on public.announcements;
drop policy if exists "ann_admin"     on public.announcements;
create policy "ann_auth_read" on public.announcements for select to authenticated using (published = true);
create policy "ann_anon_read" on public.announcements for select to anon           using (published = true);
create policy "ann_admin"     on public.announcements for all using (public.is_admin());


-- ============================================================
-- 11. audit_log
-- ============================================================
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
create index if not exists idx_audit_created_at on public.audit_log(created_at desc);
create index if not exists idx_audit_admin_id   on public.audit_log(admin_id);

alter table public.audit_log enable row level security;
drop policy if exists "audit_admin" on public.audit_log;
create policy "audit_admin" on public.audit_log for all using (public.is_admin());


-- ============================================================
-- DONE ✓
--
-- To make your account an admin, run AFTER registering:
--
--   insert into public.admin_users (id, email)
--   values ('<your-uuid>', '<your-email>');
--
-- Find your UUID: Supabase Dashboard → Authentication → Users
-- ============================================================
