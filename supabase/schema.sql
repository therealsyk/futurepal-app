-- Wallet: esquema do Supabase (espelha as tabelas Dexie de src/db/database.ts).
-- Como usar: Supabase > SQL Editor > New query > colar TUDO isto > Run.
-- Pode correr-se mais do que uma vez (é idempotente).
-- Cada linha pertence a um utilizador (user_id) e a RLS garante que ninguém vê as linhas dos outros.

-- ---------------------------------------------------------------- tabelas
create table if not exists public.settings (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  language text not null,
  country text not null,
  main_currency text not null,
  first_day_of_week integer not null default 1,
  date_format text not null default 'DMY',
  theme text not null default 'dark',
  setup_done boolean not null default false,
  last_sync timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.categories (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  color text not null,
  icon text not null default '',
  "order" integer not null default 0,
  name_key text,
  image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.accounts (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  type text not null check (type in ('spending','savings','debt')),
  currency text not null,
  initial_balance_cents bigint not null default 0,
  include_in_net_worth boolean not null default true,
  is_default boolean not null default false,
  show_on_home boolean not null default true,
  "order" integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.transactions (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  type text not null check (type in ('expense','income')),
  category_id text not null,
  description text not null default '',
  amount_cents bigint not null check (amount_cents >= 1),
  currency text not null,
  group_id text,
  recurring_id text,
  account_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.transfers (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  from_account_id text not null,
  to_account_id text not null,
  amount_cents bigint not null check (amount_cents >= 1),
  date date not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.salaries (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  year integer not null,
  month integer not null check (month between 1 and 12),
  amount_cents bigint not null check (amount_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.budgets (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id text not null,
  limit_cents bigint not null check (limit_cents >= 0),
  period text not null default 'month',
  year integer not null,
  month integer not null check (month between 1 and 12),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.goals (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  target_cents bigint not null check (target_cents >= 0),
  current_cents bigint not null default 0,
  start_date date not null,
  target_date date,
  notes text,
  account_ids jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.recurrings (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type text not null check (type in ('expense','income')),
  category_id text not null,
  description text not null default '',
  amount_cents bigint not null check (amount_cents >= 1),
  currency text not null,
  frequency text not null check (frequency in ('daily','weekly','biweekly','monthly','bimonthly','quarterly','semiannual','yearly')),
  next_date date not null,
  end_date date,
  account_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.groups (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  color text not null default '#9CA3AF',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Projetos criados com a versão antiga deste ficheiro: acrescenta as colunas novas.
alter table public.categories add column if not exists image text;
alter table public.transactions add column if not exists account_id text;
alter table public.goals add column if not exists notes text;
alter table public.goals add column if not exists account_ids jsonb;
alter table public.recurrings add column if not exists account_id text;
alter table public.recurrings drop constraint if exists recurrings_frequency_check;
alter table public.recurrings add constraint recurrings_frequency_check
  check (frequency in ('daily','weekly','biweekly','monthly','bimonthly','quarterly','semiannual','yearly'));

-- ---------------------------------------------------------------- RLS + índices
-- Nota: o Postgres NÃO tem "create policy if not exists" nem políticas "for insert,update,delete";
-- por isso: apagar se existir e criar uma política "for all" com using + with check.
do $$
declare t text;
begin
  foreach t in array array['settings','categories','accounts','transactions','transfers','salaries','budgets','goals','recurrings','groups']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists user_read on public.%I', t);
    execute format('drop policy if exists user_write on public.%I', t);
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format(
      'create policy own_rows on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('create index if not exists %I on public.%I (user_id, updated_at)', t || '_user_updated_idx', t);
  end loop;
end $$;

-- A tabela antiga exchange_rates nunca foi usada pela sincronização; não é criada aqui.
