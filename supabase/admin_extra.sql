-- FuturePal: painel de administração (extra) — quem está a usar a app agora, avisos para todos e apagar contas.
-- Corre UMA vez no Supabase > SQL Editor (depois de admin.sql).

-- 1. Presença: cada app com sessão iniciada atualiza a sua linha a cada minuto (sem dados financeiros).
create table if not exists public.presence (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  last_seen timestamptz not null default now(),
  platform text check (length(platform) <= 20),
  app_version text check (length(app_version) <= 30),
  page text check (length(page) <= 60)
);
alter table public.presence enable row level security;
drop policy if exists presence_own on public.presence;
create policy presence_own on public.presence for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.presence to authenticated;

-- Quem esteve ativo nos últimos N minutos
create or replace function public.admin_online(p_minutes int default 3)
returns table (email text, platform text, app_version text, page text, last_seen timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  return query select u.email::text, p.platform, p.app_version, p.page, p.last_seen
    from public.presence p join auth.users u on u.id = p.user_id
    where p.last_seen > now() - make_interval(mins => greatest(1, least(p_minutes, 1440)))
    order by p.last_seen desc;
end $$;

-- Contagens: agora, hoje, 7 dias + versões e plataformas em uso
create or replace function public.admin_presence_stats()
returns json language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  select json_build_object(
    'now',   (select count(*) from public.presence where last_seen > now() - interval '3 minutes'),
    'today', (select count(*) from public.presence where last_seen > date_trunc('day', now())),
    'week',  (select count(*) from public.presence where last_seen > now() - interval '7 days'),
    'platforms', (select coalesce(json_object_agg(k, n), '{}'::json) from (select coalesce(platform, '?') k, count(*) n from public.presence where last_seen > now() - interval '30 days' group by 1) a),
    'versions',  (select coalesce(json_object_agg(k, n), '{}'::json) from (select coalesce(app_version, '?') k, count(*) n from public.presence where last_seen > now() - interval '30 days' group by 1) b)
  ) into r;
  return r;
end $$;

-- 2. Aviso para todos (aparece no topo da app até a pessoa o fechar)
create table if not exists public.announcement (
  id int primary key default 1 check (id = 1),
  message text not null default '' check (length(message) <= 500),
  level text not null default 'info' check (level in ('info', 'warn')),
  active boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.announcement (id) values (1) on conflict do nothing;
alter table public.announcement enable row level security;
drop policy if exists announcement_read on public.announcement;
create policy announcement_read on public.announcement for select to anon, authenticated using (true);
grant select on public.announcement to anon, authenticated;

create or replace function public.admin_set_announcement(p_message text, p_level text, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  update public.announcement set message = coalesce(p_message, ''), level = coalesce(nullif(p_level, ''), 'info'),
    active = coalesce(p_active, false), updated_at = now() where id = 1;
end $$;

-- 3. Apagar uma conta (e todos os dados dela, por cascata). Nunca apaga administradores.
create or replace function public.admin_delete_user(p_email text)
returns boolean language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then return false; end if;
  if exists (select 1 from public.admins where user_id = uid) then raise exception 'cannot delete an admin'; end if;
  delete from auth.users where id = uid;
  return true;
end $$;

revoke all on function public.admin_online(int), public.admin_presence_stats(), public.admin_set_announcement(text, text, boolean), public.admin_delete_user(text) from public, anon;
grant execute on function public.admin_online(int), public.admin_presence_stats(), public.admin_set_announcement(text, text, boolean), public.admin_delete_user(text) to authenticated;
