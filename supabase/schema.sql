-- Wallet Supabase schema (mirrors the Dexie tables in src/db/database.ts).
-- Run this in the Supabase SQL Editor after creating the project.
-- Every table mirrors SPEC §5: id (UUID text), created_at, updated_at, deleted_at, user_id.

create extension if not exists "uuid-ossp";

-- Helper: shared columns are repeated per table for clarity and RLS.

create table if not exists settings (
  id text primary key,
  user_id uuid not null references auth.users(id),
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

create table if not exists categories (
  id text primary key,
  user_id uuid not null references auth.users(id),
  name text not null,
  color text not null,
  icon text not null default '',
  "order" integer not null default 0,
  name_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists transactions (
  id text primary key,
  user_id uuid not null references auth.users(id),
  date date not null,
  type text not null check (type in ('expense','income')),
  category_id text not null,
  description text not null default '',
  amount_cents integer not null check (amount_cents >= 1),
  currency text not null,
  group_id text,
  recurring_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists salaries (
  id text primary key,
  user_id uuid not null references auth.users(id),
  year integer not null,
  month integer not null check (month between 1 and 12),
  amount_cents integer not null check (amount_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists budgets (
  id text primary key,
  user_id uuid not null references auth.users(id),
  category_id text not null,
  limit_cents integer not null check (limit_cents >= 0),
  period text not null default 'month',
  year integer not null,
  month integer not null check (month between 1 and 12),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists goals (
  id text primary key,
  user_id uuid not null references auth.users(id),
  name text not null,
  target_cents integer not null check (target_cents >= 0),
  current_cents integer not null default 0,
  start_date date not null,
  target_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists recurrings (
  id text primary key,
  user_id uuid not null references auth.users(id),
  type text not null check (type in ('expense','income')),
  category_id text not null,
  description text not null default '',
  amount_cents integer not null check (amount_cents >= 1),
  currency text not null,
  frequency text not null check (frequency in ('weekly','monthly','yearly')),
  next_date date not null,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists groups (
  id text primary key,
  user_id uuid not null references auth.users(id),
  name text not null,
  color text not null default '#9CA3AF',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists exchange_rates (
  id text primary key,
  user_id uuid not null references auth.users(id),
  base text not null,
  rates jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Row Level Security: each user only sees their own rows.
alter table settings enable row level security;
alter table categories enable row level security;
alter table transactions enable row level security;
alter table salaries enable row level security;
alter table budgets enable row level security;
alter table goals enable row level security;
alter table recurrings enable row level security;
alter table groups enable row level security;
alter table exchange_rates enable row level security;

-- Policies (one per table, plain statements — no DO blocks).
create policy if not exists user_read on settings for select using (user_id = auth.uid());
create policy if not exists user_write on settings for insert,update,delete using (user_id = auth.uid());

create policy if not exists user_read on categories for select using (user_id = auth.uid());
create policy if not exists user_write on categories for insert,update,delete using (user_id = auth.uid());

create policy if not exists user_read on transactions for select using (user_id = auth.uid());
create policy if not exists user_write on transactions for insert,update,delete using (user_id = auth.uid());

create policy if not exists user_read on salaries for select using (user_id = auth.uid());
create policy if not exists user_write on salaries for insert,update,delete using (user_id = auth.uid());

create policy if not exists user_read on budgets for select using (user_id = auth.uid());
create policy if not exists user_write on budgets for insert,update,delete using (user_id = auth.uid());

create policy if not exists user_read on goals for select using (user_id = auth.uid());
create policy if not exists user_write on goals for insert,update,delete using (user_id = auth.uid());

create policy if not exists user_read on recurrings for select using (user_id = auth.uid());
create policy if not exists user_write on recurrings for insert,update,delete using (user_id = auth.uid());

create policy if not exists user_read on groups for select using (user_id = auth.uid());
create policy if not exists user_write on groups for insert,update,delete using (user_id = auth.uid());

create policy if not exists user_read on exchange_rates for select using (user_id = auth.uid());
create policy if not exists user_write on exchange_rates for insert,update,delete using (user_id = auth.uid());
