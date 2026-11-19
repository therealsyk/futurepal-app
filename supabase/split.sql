-- FuturePal: divisão de contas em grupos (jantares, contas da casa do mês, viagens…).
-- Como usar: Supabase > SQL Editor > New query > colar TUDO isto > Run. Pode correr-se mais do que uma vez.
-- Convida-se por email ou telemóvel; a pessoa tem de aceitar. Cada conta é dividida em partes iguais
-- e cada parte fica "paga" ou "por pagar".

create table if not exists public.split_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  currency text not null default 'EUR',
  created_at timestamptz not null default now()
);

create table if not exists public.split_members (
  group_id uuid not null references public.split_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.split_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.split_groups(id) on delete cascade,
  email text,          -- em minúsculas
  phone text,          -- só dígitos, com indicativo (ex.: 351912345678)
  invited_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  check (email is not null or phone is not null)
);
create index if not exists split_invites_email_idx on public.split_invites (email) where status = 'pending';
create index if not exists split_invites_phone_idx on public.split_invites (phone) where status = 'pending';

create table if not exists public.split_bills (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.split_groups(id) on delete cascade,
  description text not null,
  amount_cents bigint not null check (amount_cents > 0),
  date date not null default current_date,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists split_bills_group_idx on public.split_bills (group_id, date desc);

create table if not exists public.split_shares (
  bill_id uuid not null references public.split_bills(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  share_cents bigint not null check (share_cents >= 0),
  paid_at timestamptz,
  marked_by uuid,
  primary key (bill_id, user_id)
);

-- ---------------------------------------------------------------- funções
create or replace function public.is_split_member(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.split_members where group_id = gid and user_id = auth.uid());
$$;

-- Email e telemóvel da conta com sessão iniciada (para encontrar os convites dela).
create or replace function public.my_contact()
returns table (email text, phone text) language sql stable security definer set search_path = public, auth as $$
  select lower(u.email), regexp_replace(coalesce(u.phone, u.raw_user_meta_data->>'phone', ''), '\D', '', 'g')
  from auth.users u where u.id = auth.uid();
$$;

create or replace function public.create_split_group(p_name text, p_display_name text, p_currency text default 'EUR')
returns uuid language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.split_groups (name, owner_id, currency) values (trim(p_name), auth.uid(), coalesce(p_currency, 'EUR')) returning id into gid;
  insert into public.split_members (group_id, user_id, display_name) values (gid, auth.uid(), trim(p_display_name));
  return gid;
end $$;

-- Convidar (qualquer membro). Normaliza email/telemóvel; não duplica convites pendentes.
create or replace function public.invite_to_split(p_group uuid, p_email text, p_phone text)
returns void language plpgsql security definer set search_path = public as $$
declare e text := nullif(lower(trim(coalesce(p_email, ''))), '');
        ph text := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
begin
  if not public.is_split_member(p_group) then raise exception 'not member'; end if;
  if e is null and ph is null then raise exception 'empty invite'; end if;
  if (select count(*) from public.split_members where group_id = p_group) >= 20 then raise exception 'group full'; end if;
  if exists (select 1 from public.split_invites where group_id = p_group and status = 'pending'
             and ((e is not null and email = e) or (ph is not null and phone = ph))) then return; end if;
  insert into public.split_invites (group_id, email, phone) values (p_group, e, ph);
end $$;

-- Convites pendentes para mim (por email ou telemóvel da minha conta).
create or replace function public.my_split_invites()
returns table (id uuid, group_id uuid, group_name text, invited_by_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, g.id, g.name,
         coalesce((select m.display_name from public.split_members m where m.group_id = g.id and m.user_id = i.invited_by), '?'),
         i.created_at
  from public.split_invites i
  join public.split_groups g on g.id = i.group_id
  cross join public.my_contact() c
  where i.status = 'pending'
    and ((i.email is not null and i.email = c.email) or (i.phone is not null and c.phone <> '' and right(c.phone, 9) = right(i.phone, 9)))
    and not exists (select 1 from public.split_members m where m.group_id = g.id and m.user_id = auth.uid());
$$;

create or replace function public.answer_split_invite(p_invite uuid, p_accept boolean, p_display_name text)
returns void language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  select group_id into gid from public.my_split_invites() where id = p_invite;
  if gid is null then raise exception 'invite not found'; end if;
  update public.split_invites set status = case when p_accept then 'accepted' else 'declined' end where id = p_invite;
  if p_accept then
    insert into public.split_members (group_id, user_id, display_name) values (gid, auth.uid(), trim(p_display_name))
    on conflict do nothing;
  end if;
end $$;

-- Nova conta dividida em partes iguais pelos membros indicados (os cêntimos que sobram vão para os primeiros).
-- Quem criou a conta e a pagou fica logo com a sua parte marcada como paga se p_creator_paid = true.
create or replace function public.add_split_bill(p_group uuid, p_description text, p_amount_cents bigint, p_date date, p_members uuid[], p_creator_paid boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid; n int; base bigint; rest bigint; i int := 0; m uuid;
begin
  if not public.is_split_member(p_group) then raise exception 'not member'; end if;
  if p_amount_cents <= 0 then raise exception 'invalid amount'; end if;
  select array_agg(x) into p_members from (select distinct x from unnest(p_members) x
    where exists (select 1 from public.split_members sm where sm.group_id = p_group and sm.user_id = x)) s;
  n := coalesce(array_length(p_members, 1), 0);
  if n = 0 then raise exception 'no members'; end if;
  insert into public.split_bills (group_id, description, amount_cents, date) values (p_group, trim(p_description), p_amount_cents, coalesce(p_date, current_date)) returning id into bid;
  base := p_amount_cents / n; rest := p_amount_cents - base * n;
  foreach m in array p_members loop
    insert into public.split_shares (bill_id, user_id, share_cents, paid_at, marked_by)
    values (bid, m, base + case when i < rest then 1 else 0 end,
            case when p_creator_paid and m = auth.uid() then now() end,
            case when p_creator_paid and m = auth.uid() then auth.uid() end);
    i := i + 1;
  end loop;
  return bid;
end $$;

-- Marcar/desmarcar uma parte como paga: a própria pessoa ou quem criou a conta.
create or replace function public.set_split_paid(p_bill uuid, p_user uuid, p_paid boolean)
returns void language plpgsql security definer set search_path = public as $$
declare b record;
begin
  select * into b from public.split_bills where id = p_bill and deleted_at is null;
  if b is null or not public.is_split_member(b.group_id) then raise exception 'not member'; end if;
  if auth.uid() <> p_user and auth.uid() <> b.created_by then raise exception 'not allowed'; end if;
  update public.split_shares set paid_at = case when p_paid then now() end, marked_by = auth.uid()
  where bill_id = p_bill and user_id = p_user;
end $$;

create or replace function public.leave_split_group(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
declare next_owner uuid;
begin
  delete from public.split_members where group_id = p_group and user_id = auth.uid();
  select user_id into next_owner from public.split_members where group_id = p_group order by joined_at limit 1;
  if next_owner is null then delete from public.split_groups where id = p_group;
  else update public.split_groups set owner_id = next_owner where id = p_group and owner_id = auth.uid(); end if;
end $$;

do $$ declare f text; begin
  foreach f in array array['my_contact()','create_split_group(text,text,text)','invite_to_split(uuid,text,text)','my_split_invites()',
    'answer_split_invite(uuid,boolean,text)','add_split_bill(uuid,text,bigint,date,uuid[],boolean)','set_split_paid(uuid,uuid,boolean)','leave_split_group(uuid)']
  loop execute 'revoke all on function public.' || f || ' from public, anon'; execute 'grant execute on function public.' || f || ' to authenticated'; end loop;
end $$;

-- ---------------------------------------------------------------- RLS (leitura só para membros; escrita pelas funções acima)
alter table public.split_groups enable row level security;
alter table public.split_members enable row level security;
alter table public.split_invites enable row level security;
alter table public.split_bills enable row level security;
alter table public.split_shares enable row level security;

drop policy if exists sg_read on public.split_groups;
create policy sg_read on public.split_groups for select to authenticated using (public.is_split_member(id));
drop policy if exists sm_read on public.split_members;
create policy sm_read on public.split_members for select to authenticated using (public.is_split_member(group_id));
drop policy if exists si_read on public.split_invites;
create policy si_read on public.split_invites for select to authenticated using (public.is_split_member(group_id));
drop policy if exists sb_read on public.split_bills;
create policy sb_read on public.split_bills for select to authenticated using (public.is_split_member(group_id));
-- apagar uma conta (marcar deleted_at): só quem a criou
drop policy if exists sb_delete on public.split_bills;
create policy sb_delete on public.split_bills for update to authenticated
  using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));
drop policy if exists ss_read on public.split_shares;
create policy ss_read on public.split_shares for select to authenticated
  using (exists (select 1 from public.split_bills b where b.id = bill_id and public.is_split_member(b.group_id)));
