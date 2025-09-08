-- Betting schema for 971app (Supabase/Postgres)
-- Create these tables/policies in your Supabase project.
-- Note: Adjust RLS policies as needed for your security model.

-- 1) User balances
create table if not exists public.user_balances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance numeric not null default 100,
  updated_at timestamptz not null default now()
);

comment on table public.user_balances is 'Fake currency balances per user for the betting feature';

-- 2) Betting markets (one per FRC match)
create table if not exists public.betting_markets (
  id uuid primary key default gen_random_uuid(),
  match_key text not null unique,              -- e.g. 2025casj_qm1
  event_key text,                              -- e.g. 2025casj
  red_team_keys text[] not null default '{}',  -- e.g. ['frc971','frc254','frc604']
  blue_team_keys text[] not null default '{}',
  b numeric not null default 50,               -- LMSR liquidity parameter
  q_red numeric not null default 0,            -- LMSR outstanding shares state
  q_blue numeric not null default 0,
  status text not null default 'open' check (status in ('open','settled','cancelled')),
  start_time bigint,                           -- epoch seconds if provided by TBA
  winning_outcome text check (winning_outcome in ('red','blue')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists betting_markets_event_idx on public.betting_markets(event_key);
create index if not exists betting_markets_status_idx on public.betting_markets(status);

comment on table public.betting_markets is 'LMSR markets for FRC matches (Red vs Blue)';

-- 3) Bets
create table if not exists public.betting_bets (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.betting_markets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  outcome text not null check (outcome in ('red','blue')),
  amount numeric not null check (amount > 0),
  shares numeric not null check (shares >= 0),
  created_at timestamptz not null default now()
);

create index if not exists betting_bets_market_idx on public.betting_bets(market_id);
create index if not exists betting_bets_user_idx on public.betting_bets(user_id);

comment on table public.betting_bets is 'Executed bets with spending amount and LMSR-calculated shares';

-- OPTIONAL: RLS (enable and create permissive policies per your app model)
-- alter table public.user_balances enable row level security;
-- alter table public.betting_markets enable row level security;
-- alter table public.betting_bets enable row level security;

-- Example permissive policies (adjust as needed):
-- User can read their own balance; server logic updates balances.
-- create policy "read own balance"
--   on public.user_balances for select
--   using (auth.uid() = user_id);

-- Markets are readable to all signed-in users
-- create policy "read markets"
--   on public.betting_markets for select
--   using (true);

-- Bets readable by owner; insert by server or user
-- create policy "read own bets"
--   on public.betting_bets for select
--   using (auth.uid() = user_id);

-- create policy "insert own bets"
--   on public.betting_bets for insert
--   with check (auth.uid() = user_id);

-- NOTE: In many setups, you will keep write operations server-side using service role.
-- If you rely on anon key from server endpoints, ensure your RLS policies allow it or
-- run those endpoints with service key (not recommended to expose).

-- Convenience views (optional)
-- View: latest settled markets
-- create or replace view public.betting_markets_settled as
--   select * from public.betting_markets where status = 'settled' order by updated_at desc;

-- View: user betting history with market metadata
-- create or replace view public.user_betting_history as
--   select b.*, m.match_key, m.event_key, m.winning_outcome
--   from public.betting_bets b
--   join public.betting_markets m on m.id = b.market_id;

-- 4) Predict settings (admin-configurable)
-- Single-row table storing demo toggle, current competitions, and Predict tab visibility.
create table if not exists public.predict_settings (
  id text primary key default 'global',
  demo boolean not null default false,
  competitions text[] not null default '{}',
  tab_visible boolean not null default false,
  updated_at timestamptz not null default now()
);

comment on table public.predict_settings is 'Global settings for Predict feature (demo toggle, competitions, tab visibility)';
comment on column public.predict_settings.demo is 'Demo mode toggle for Predict';
comment on column public.predict_settings.competitions is 'List of active competition/event codes (e.g. 2025casj)';
comment on column public.predict_settings.tab_visible is 'If true, Predict tab visible to all users (with CAN_SEE_ROUTES); otherwise only Spartan Predict Admins see it';

-- Ensure a single row exists
insert into public.predict_settings (id)
values ('global')
on conflict (id) do nothing;

-- 5) Market price ticks (for price over time graphs)
create table if not exists public.betting_market_ticks (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.betting_markets(id) on delete cascade,
  q_red numeric not null default 0,
  q_blue numeric not null default 0,
  price_red numeric not null default 0,
  price_blue numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists betting_market_ticks_market_idx on public.betting_market_ticks(market_id);
create index if not exists betting_market_ticks_created_idx on public.betting_market_ticks(created_at);

comment on table public.betting_market_ticks is 'Snapshot of market q and prices over time (recorded at creation and each bet)';
