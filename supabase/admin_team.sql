-- FuturePal: equipa do painel (cargos). Corre UMA vez no Supabase > SQL Editor (depois de admin_hardening.sql).
-- Cargos: super (tu: tudo, incluindo a equipa), admin, moderator (dashboard + tickets), support (tickets + ações básicas),
--         finance (planos), readonly (só ver o dashboard).

alter table public.admins drop constraint if exists admins_role_check;
alter table public.admins add constraint admins_role_check check (role in ('super', 'admin', 'moderator', 'support', 'finance', 'readonly'));

create or replace function public.admin_can(p_perm text)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select coalesce((
    select case role
      when 'super' then true
      when 'admin' then p_perm in ('view', 'users', 'plans', 'tickets', 'config')
      when 'moderator' then p_perm in ('view', 'tickets')
      when 'support' then p_perm in ('view', 'users_basic', 'tickets')
      when 'finance' then p_perm in ('view', 'plans')
      when 'readonly' then p_perm = 'view'
    end from public.admins where user_id = auth.uid()), false)
  and (not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
       or coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2');
$$;

-- As estatísticas antigas (admin_stats, admin_presence_stats, admin_plan_interest) passam a abrir a quem pode "ver".
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public, auth as $$
  select public.admin_can('config');
$$;
create or replace function public.can_view_admin()
returns boolean language sql stable security definer set search_path = public, auth as $$ select public.admin_can('view'); $$;

-- Equipa: listar, dar/mudar cargo e retirar acesso (só o super). Tudo auditado.
create or replace function public.admin_team_list()
returns table (email text, role text, created_at timestamptz, last_seen timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.admin_can('team') then raise exception 'not allowed'; end if;
  return query select u.email::text, a.role, a.created_at, p.last_seen
    from public.admins a join auth.users u on u.id = a.user_id left join public.presence p on p.user_id = a.user_id
    order by (a.role = 'super') desc, a.created_at;
end $$;

create or replace function public.admin_team_set(p_email text, p_role text)
returns void language plpgsql security definer set search_path = public, auth as $$
declare uid uuid; old text;
begin
  if not public.admin_can('team') then raise exception 'not allowed'; end if;
  if p_role not in ('admin', 'moderator', 'support', 'finance', 'readonly') then raise exception 'invalid role'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'user not found'; end if;
  if uid = auth.uid() then raise exception 'cannot change your own role'; end if;
  select role into old from public.admins where user_id = uid;
  insert into public.admins (user_id, role) values (uid, p_role) on conflict (user_id) do update set role = excluded.role;
  perform public._audit('team_set', public.user_ref(uid), json_build_object('role', old)::jsonb, json_build_object('role', p_role)::jsonb, null);
end $$;

create or replace function public.admin_team_remove(p_email text)
returns void language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if not public.admin_can('team') then raise exception 'not allowed'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null or uid = auth.uid() then raise exception 'not allowed'; end if;
  delete from public.admins where user_id = uid and role <> 'super';
  perform public._audit('team_remove', public.user_ref(uid), null, null, null);
end $$;

-- Dados do dashboard para todos os cargos (só números agregados; nada de emails nem valores)
create or replace function public.admin_dash()
returns json language plpgsql stable security definer set search_path = public, auth as $$
declare r json;
begin
  if not public.admin_can('view') then raise exception 'not allowed'; end if;
  select json_build_object(
    'users_total', (select count(*) from auth.users),
    'users_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'users_30d', (select count(*) from auth.users where created_at > now() - interval '30 days'),
    'unconfirmed', (select count(*) from auth.users where email_confirmed_at is null),
    'with_data', (select count(distinct user_id) from public.transactions),
    'tx_total', (select count(*) from public.transactions where deleted_at is null),
    'tx_30d', (select count(*) from public.transactions where deleted_at is null and created_at > now() - interval '30 days'),
    'accounts_total', (select count(*) from public.accounts where deleted_at is null),
    'goals_total', (select count(*) from public.goals where deleted_at is null),
    'providers', (select coalesce(json_object_agg(p, n), '{}'::json) from (select coalesce(raw_app_meta_data->>'provider', 'email') p, count(*) n from auth.users group by 1) x),
    'languages', (select coalesce(json_object_agg(l, n), '{}'::json) from (select coalesce(language, '?') l, count(*) n from public.settings group by 1) y),
    'signups_by_day', (select coalesce(json_agg(json_build_object('day', d, 'n', n) order by d), '[]'::json) from (select date(created_at) d, count(*) n from auth.users where created_at > now() - interval '30 days' group by 1) z),
    'now', (select count(*) from public.presence where last_seen > now() - interval '3 minutes'),
    'today', (select count(*) from public.presence where last_seen > date_trunc('day', now())),
    'week', (select count(*) from public.presence where last_seen > now() - interval '7 days'),
    'platforms', (select coalesce(json_object_agg(k, n), '{}'::json) from (select coalesce(platform, '?') k, count(*) n from public.presence where last_seen > now() - interval '30 days' group by 1) a),
    'versions', (select coalesce(json_object_agg(k, n), '{}'::json) from (select coalesce(app_version, '?') k, count(*) n from public.presence where last_seen > now() - interval '30 days' group by 1) b),
    'interest', (select coalesce(json_object_agg(plan, n), '{}'::json) from (select plan, count(*) n from public.plan_interest group by 1) c)
  ) into r;
  return r;
end $$;

do $$ declare f text; begin
  foreach f in array array['admin_can(text)', 'is_admin()', 'can_view_admin()', 'admin_team_list()', 'admin_team_set(text,text)', 'admin_team_remove(text)', 'admin_dash()']
  loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
