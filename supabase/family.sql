-- FuturePal Família: "carteira da casa" partilhada entre 2 a 5 pessoas.
-- Como usar: Supabase > SQL Editor > New query > colar TUDO isto > Run. Pode correr-se mais do que uma vez.
-- Só os membros de uma casa veem as suas despesas. Entra-se numa casa com o código de convite.

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  invite_code text not null unique default upper(substr(md5(random()::text), 1, 8)),
  currency text not null default 'EUR',
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.household_expenses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  paid_by uuid not null references auth.users(id) on delete cascade,
  description text not null,
  amount_cents bigint not null check (amount_cents > 0),
  date date not null default current_date,
  split_among uuid[] not null,          -- quem divide esta despesa (partes iguais)
  is_settlement boolean not null default false, -- "acertar contas": um pagamento entre duas pessoas
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists household_expenses_hh_idx on public.household_expenses (household_id, date desc);

-- ---------------------------------------------------------------- funções (security definer: evitam recursão na RLS)
create or replace function public.is_household_member(hid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.household_members where household_id = hid and user_id = auth.uid());
$$;

create or replace function public.create_household(p_name text, p_display_name text, p_currency text default 'EUR')
returns uuid language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from public.household_members where user_id = auth.uid()) then raise exception 'already in a household'; end if;
  insert into public.households (name, owner_id, currency) values (trim(p_name), auth.uid(), coalesce(p_currency, 'EUR')) returning id into hid;
  insert into public.household_members (household_id, user_id, display_name) values (hid, auth.uid(), trim(p_display_name));
  return hid;
end $$;

create or replace function public.join_household(p_code text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from public.household_members where user_id = auth.uid()) then raise exception 'already in a household'; end if;
  select id into hid from public.households where invite_code = upper(trim(p_code));
  if hid is null then raise exception 'invalid code'; end if;
  if (select count(*) from public.household_members where household_id = hid) >= 5 then raise exception 'household full'; end if;
  insert into public.household_members (household_id, user_id, display_name) values (hid, auth.uid(), trim(p_display_name));
  return hid;
end $$;

-- Sair da casa. Se o dono sair e ficar alguém, o mais antigo passa a dono; se ficar vazia, a casa é apagada.
create or replace function public.leave_household(p_household uuid)
returns void language plpgsql security definer set search_path = public as $$
declare next_owner uuid;
begin
  delete from public.household_members where household_id = p_household and user_id = auth.uid();
  select user_id into next_owner from public.household_members where household_id = p_household order by joined_at limit 1;
  if next_owner is null then
    delete from public.households where id = p_household;
  else
    update public.households set owner_id = next_owner where id = p_household and owner_id = auth.uid();
  end if;
end $$;

-- Novo código de convite (só o dono).
create or replace function public.new_invite_code(p_household uuid)
returns text language plpgsql security definer set search_path = public as $$
declare c text := upper(substr(md5(random()::text), 1, 8));
begin
  update public.households set invite_code = c where id = p_household and owner_id = auth.uid();
  if not found then raise exception 'not owner'; end if;
  return c;
end $$;

revoke all on function public.create_household(text, text, text) from anon;
revoke all on function public.join_household(text, text) from anon;
revoke all on function public.leave_household(uuid) from anon;
revoke all on function public.new_invite_code(uuid) from anon;

-- ---------------------------------------------------------------- RLS
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_expenses enable row level security;

drop policy if exists hh_read on public.households;
create policy hh_read on public.households for select to authenticated using (public.is_household_member(id));
drop policy if exists hh_rename on public.households;
create policy hh_rename on public.households for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

drop policy if exists hm_read on public.household_members;
create policy hm_read on public.household_members for select to authenticated using (public.is_household_member(household_id));
drop policy if exists hm_rename_self on public.household_members;
create policy hm_rename_self on public.household_members for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists he_read on public.household_expenses;
create policy he_read on public.household_expenses for select to authenticated using (public.is_household_member(household_id));
drop policy if exists he_insert on public.household_expenses;
create policy he_insert on public.household_expenses for insert to authenticated
  with check (public.is_household_member(household_id) and created_by = (select auth.uid()));
-- Qualquer membro pode corrigir/apagar (apagar = marcar deleted_at); as despesas são da casa.
drop policy if exists he_update on public.household_expenses;
create policy he_update on public.household_expenses for update to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
