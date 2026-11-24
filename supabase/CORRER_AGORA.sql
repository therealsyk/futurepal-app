-- FuturePal: tudo o que falta correr no Supabase (SQL Editor > New query > colar tudo > Run). Pode correr-se mais do que uma vez.

-- ════ split-v2.sql
-- Divisão de contas v2: quem aceita um convite entra logo nas contas criadas depois desse convite,
-- e a conta é dividida outra vez em partes iguais (quem já tinha pago continua marcado como pago).
-- Correr uma vez no Supabase (SQL Editor), depois de split.sql.

create or replace function public.answer_split_invite(p_invite uuid, p_accept boolean, p_display_name text)
returns void language plpgsql security definer set search_path = public as $$
declare gid uuid; inv_at timestamptz; b record; s record; n int; base bigint; rest bigint; i int;
begin
  select mi.group_id, mi.created_at into gid, inv_at from public.my_split_invites() mi where mi.id = p_invite;
  if gid is null then raise exception 'invite not found'; end if;
  update public.split_invites set status = case when p_accept then 'accepted' else 'declined' end where id = p_invite;
  if not p_accept then return; end if;
  insert into public.split_members (group_id, user_id, display_name) values (gid, auth.uid(), trim(p_display_name))
  on conflict do nothing;
  for b in select sb.id, sb.amount_cents from public.split_bills sb
           where sb.group_id = gid and sb.deleted_at is null and sb.created_at >= inv_at
             and not exists (select 1 from public.split_shares x where x.bill_id = sb.id and x.user_id = auth.uid())
  loop
    insert into public.split_shares (bill_id, user_id, share_cents) values (b.id, auth.uid(), 0);
    select count(*) into n from public.split_shares where bill_id = b.id;
    base := b.amount_cents / n; rest := b.amount_cents - base * n; i := 0;
    for s in select ss.user_id from public.split_shares ss where ss.bill_id = b.id order by ss.user_id loop
      update public.split_shares set share_cents = base + case when i < rest then 1 else 0 end
      where bill_id = b.id and user_id = s.user_id;
      i := i + 1;
    end loop;
  end loop;
end $$;

revoke all on function public.answer_split_invite(uuid,boolean,text) from public, anon;
grant execute on function public.answer_split_invite(uuid,boolean,text) to authenticated;

-- ════ split-v3.sql
-- Divisão de contas v3: só quem criou o grupo pode apagar transações dele ou apagar o grupo. Qualquer pessoa pode sair.
-- Correr uma vez no Supabase (SQL Editor), depois de split.sql e split-v2.sql. Pode correr-se mais do que uma vez.

create or replace function public.is_split_owner(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.split_groups where id = gid and owner_id = auth.uid());
$$;

drop policy if exists sb_delete on public.split_bills;
create policy sb_delete on public.split_bills for update to authenticated
  using (public.is_split_owner(group_id)) with check (public.is_split_owner(group_id));

create or replace function public.delete_split_group(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_split_owner(p_group) then raise exception 'only the group owner can delete it'; end if;
  delete from public.split_groups where id = p_group; -- membros, convites, transações e partes saem em cascata
end $$;

do $$ declare f text; begin
  foreach f in array array['is_split_owner(uuid)','delete_split_group(uuid)']
  loop execute 'revoke all on function public.' || f || ' from public, anon'; execute 'grant execute on function public.' || f || ' to authenticated'; end loop;
end $$;

-- ════ split-v5.sql
-- Divisão de contas v5 (substitui o split-v4.sql: quem já o correu corre este por cima; quem não correu só precisa deste).
-- O nome, a foto e a cor do grupo são iguais para todos. Só altera o grupo (nome, foto, transações) quem o criou
-- e as pessoas a quem o criador deu permissão. Apagar o grupo: só quem o criou.
-- Correr uma vez no Supabase (SQL Editor), depois de split.sql, split-v2.sql e split-v3.sql. Pode correr-se mais do que uma vez.

alter table public.split_groups add column if not exists image text;
alter table public.split_groups add column if not exists color text;
alter table public.split_members add column if not exists can_edit boolean not null default false;

create or replace function public.is_split_owner(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.split_groups where id = gid and owner_id = auth.uid());
$$;

-- Quem criou o grupo, ou um participante com permissão
create or replace function public.can_edit_split(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_split_owner(gid)
      or exists (select 1 from public.split_members where group_id = gid and user_id = auth.uid() and can_edit);
$$;

-- Só quem criou o grupo escolhe quem mais o pode alterar (a lista substitui a anterior)
create or replace function public.set_split_editors(p_group uuid, p_users uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_split_owner(p_group) then raise exception 'only the group owner can change permissions'; end if;
  update public.split_members set can_edit = (user_id = any(coalesce(p_users, '{}'::uuid[])) and user_id <> auth.uid())
   where group_id = p_group;
end $$;

drop function if exists public.update_split_group(uuid, text, text, text, boolean); -- versão do v4
create or replace function public.update_split_group(p_group uuid, p_name text, p_color text, p_image text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_edit_split(p_group) then raise exception 'not allowed to change this group'; end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 80 then raise exception 'invalid name'; end if;
  if coalesce(p_color, '') !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'invalid color'; end if;
  if coalesce(p_image, '') <> '' and (length(p_image) > 200000 or p_image !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$') then raise exception 'invalid image'; end if;
  update public.split_groups set name = trim(p_name), color = p_color, image = coalesce(p_image, '') where id = p_group;
end $$;

create or replace function public.add_split_bill(p_group uuid, p_description text, p_amount_cents bigint, p_date date, p_members uuid[], p_creator_paid boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid; n int; base bigint; rest bigint; i int := 0; m uuid;
begin
  if not public.is_split_member(p_group) then raise exception 'not member'; end if;
  if not public.can_edit_split(p_group) then raise exception 'not allowed to add'; end if;
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

create or replace function public.delete_split_group(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_split_owner(p_group) then raise exception 'only the group owner can delete it'; end if;
  delete from public.split_groups where id = p_group; -- membros, convites, transações e partes saem em cascata
end $$;

drop policy if exists sb_delete on public.split_bills;
create policy sb_delete on public.split_bills for update to authenticated
  using (public.can_edit_split(group_id)) with check (public.can_edit_split(group_id));

do $$ declare f text; begin
  foreach f in array array['is_split_owner(uuid)','can_edit_split(uuid)','set_split_editors(uuid,uuid[])','update_split_group(uuid,text,text,text)','add_split_bill(uuid,text,bigint,date,uuid[],boolean)','delete_split_group(uuid)']
  loop execute 'revoke all on function public.' || f || ' from public, anon'; execute 'grant execute on function public.' || f || ' to authenticated'; end loop;
end $$;

-- ════ group_image.sql
-- Foto própria de cada grupo (para aparecer em todos os aparelhos da pessoa).
-- Correr uma vez no Supabase (SQL Editor). Sem isto a app funciona, mas a foto fica só no aparelho onde foi escolhida.
alter table public.groups add column if not exists image text;

-- ════ goal_contributions.sql
-- Histórico das entradas em cada meta (para a previsão aprender o ritmo de poupança).
-- Correr ANTES de instalar a versão que traz isto (senão a sincronização das metas falha).
alter table public.goals add column if not exists contributions jsonb;

-- Transferências recorrentes entre contas (ex.: 500 € para a poupança todos os meses)
alter table public.recurrings add column if not exists to_account_id text;

-- ════ plan_interest.sql
-- FuturePal: "Quero subscrever" (antes de haver pagamentos). Corre no Supabase > SQL Editor.
-- Cada conta regista uma vez o plano que quer; o painel de Administração mostra os totais.
create table if not exists public.plan_interest (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  plan text not null check (plan in ('plus', 'pro')),
  period text not null default 'year' check (period in ('month', 'year')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.plan_interest enable row level security;
drop policy if exists plan_interest_own on public.plan_interest;
create policy plan_interest_own on public.plan_interest for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Totais para o painel de Administração
create or replace function public.admin_plan_interest()
returns table (plan text, period text, n bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  return query select i.plan, i.period, count(*) from public.plan_interest i group by 1, 2 order by 1, 2;
end $$;
revoke all on function public.admin_plan_interest() from public, anon;
grant execute on function public.admin_plan_interest() to authenticated;
-- Primeira utilização: contagens por dia de cada passo (sem pessoa, sem valores, sem nomes).
-- Serve para ver onde se desiste, que objetivo se escolhe e quanto tempo demora a primeira ação.
-- Correr uma vez no Supabase (SQL Editor). Pode correr-se mais do que uma vez. Sem isto a app funciona, só não conta.
create table if not exists public.onboarding_daily (
  day date not null default current_date,
  event text not null check (event ~ '^[a-z0-9_]{1,40}$'),
  n int not null default 0,
  primary key (day, event)
);
alter table public.onboarding_daily enable row level security; -- sem políticas: só se lê pela função de administração

create or replace function public.track_onboarding(p_event text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_event, '') !~ '^(start|done|account|goal_|screen_|first_|tip_)[a-z0-9_]{0,30}$' then return; end if;
  if (select count(*) from public.onboarding_daily where day = current_date) > 300 then return; end if; -- limite contra abusos
  insert into public.onboarding_daily (day, event, n) values (current_date, p_event, 1)
  on conflict (day, event) do update set n = public.onboarding_daily.n + 1;
end $$;
revoke all on function public.track_onboarding(text) from public;
grant execute on function public.track_onboarding(text) to anon, authenticated;

create or replace function public.admin_onboarding(p_days int default 30)
returns table (event text, n bigint) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  return query select o.event, sum(o.n)::bigint from public.onboarding_daily o where o.day > current_date - p_days group by 1 order by 2 desc;
end $$;
revoke all on function public.admin_onboarding(int) from public, anon;
grant execute on function public.admin_onboarding(int) to authenticated;

-- ════ admin_categories.sql
-- MyFuturePal: categorias criadas pelas pessoas (painel de admin).
-- Mostra quantas pessoas criaram categorias próprias e os nomes mais usados, sem dizer quem as criou.
-- Corre no Supabase > SQL Editor (pode correr-se mais do que uma vez).

create or replace function public.admin_custom_categories(max_rows int default 100)
returns json language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  if not public.admin_can('view') then raise exception 'not allowed'; end if;
  with own as (
    select user_id, trim(name) as name, created_at from public.categories
    where deleted_at is null and name_key is null and trim(coalesce(name, '')) <> ''
  ), names as (
    select lower(name) as k, min(name) as name, count(distinct user_id) as people, count(*) as n, max(created_at) as last_at
    from own group by lower(name)
  )
  select json_build_object(
    'people', (select count(distinct user_id) from own),
    'total', (select count(*) from own),
    'last_30d', (select count(*) from own where created_at > now() - interval '30 days'),
    'names', coalesce((select json_agg(json_build_object('name', x.name, 'people', x.people, 'n', x.n, 'last_at', x.last_at) order by x.people desc, x.n desc, x.name)
                       from (select * from names order by people desc, n desc, name limit greatest(1, least(max_rows, 500))) x), '[]'::json)
  ) into r;
  return r;
end $$;
revoke all on function public.admin_custom_categories(int) from public, anon;
grant execute on function public.admin_custom_categories(int) to authenticated;
