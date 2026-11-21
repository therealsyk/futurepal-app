-- FuturePal: painel de administração — Fase 1 (MVP).
-- Corre UMA vez no Supabase > SQL Editor, DEPOIS de admin.sql, assistant.sql, feedback.sql e admin_extra.sql.
-- Privacidade: nenhuma função aqui devolve valores, descrições, categorias ou metas das pessoas.
-- Só contagens, datas, plano, plataforma e um ID pseudónimo (U-xxxxxx). O email completo só no detalhe e fica auditado.

-- 1. Papéis ---------------------------------------------------------------------------------
alter table public.admins add column if not exists role text not null default 'super'
  check (role in ('super', 'admin', 'support', 'finance', 'readonly'));

create or replace function public.admin_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.admins where user_id = auth.uid();
$$;

-- Permissões: view (ver painéis), users (gerir contas), plans (mudar planos), tickets, config, team (gerir admins)
create or replace function public.admin_can(p_perm text)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select coalesce((
    select case role
      when 'super' then true
      when 'admin' then p_perm in ('view', 'users', 'plans', 'tickets', 'config')
      when 'support' then p_perm in ('view', 'users_basic', 'tickets')
      when 'finance' then p_perm in ('view', 'plans')
      when 'readonly' then p_perm = 'view'
    end from public.admins where user_id = auth.uid()), false)
  -- 2FA: quem ativou a verificação em dois passos tem de entrar com ela (sessão aal2) para usar o painel
  and (not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
       or coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2');
$$;

-- ID pseudónimo estável (não revela o UUID nem o email)
create or replace function public.user_ref(p uuid)
returns text language sql immutable as $$ select 'U-' || upper(substr(md5(p::text), 1, 6)); $$;

-- 2. Auditoria ------------------------------------------------------------------------------
create table if not exists public.admin_audit (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  admin_id uuid references auth.users(id) on delete set null,
  action text not null,
  target text,          -- ID pseudónimo (U-xxxxxx) ou nome da configuração
  before jsonb,
  after jsonb,
  reason text check (length(reason) <= 500)
);
alter table public.admin_audit enable row level security; -- sem políticas: só pelas funções

create or replace function public._audit(p_action text, p_target text, p_before jsonb, p_after jsonb, p_reason text)
returns void language sql security definer set search_path = public as $$
  insert into public.admin_audit (admin_id, action, target, before, after, reason) values (auth.uid(), p_action, p_target, p_before, p_after, p_reason);
$$;
revoke all on function public._audit(text, text, jsonb, jsonb, text) from public, anon, authenticated;

create or replace function public.admin_audit_list(p_target text default '', max_rows int default 200)
returns table (created_at timestamptz, admin_email text, action text, target text, before jsonb, after jsonb, reason text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.admin_can('view') then raise exception 'not allowed'; end if;
  return query select a.created_at, u.email::text, a.action, a.target, a.before, a.after, a.reason
    from public.admin_audit a left join auth.users u on u.id = a.admin_id
    where coalesce(p_target, '') = '' or a.target = p_target
    order by a.created_at desc limit least(max_rows, 1000);
end $$;

-- 3. Histórico de planos --------------------------------------------------------------------
create table if not exists public.plan_history (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete cascade,
  from_plan text, to_plan text, until timestamptz,
  admin_id uuid references auth.users(id) on delete set null,
  reason text
);
alter table public.plan_history enable row level security;

-- 4. Presença por dia (para DAU/WAU/MAU e retenção). A app insere 1 linha por dia, sem dados financeiros.
create table if not exists public.presence_days (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null default current_date,
  platform text check (length(platform) <= 20),
  primary key (user_id, day)
);
alter table public.presence_days enable row level security;
drop policy if exists presence_days_own on public.presence_days;
create policy presence_days_own on public.presence_days for insert to authenticated with check (user_id = auth.uid());
grant insert on public.presence_days to authenticated;

-- 5. Lista de utilizadores (pseudónima) -----------------------------------------------------
create or replace function public.admin_user_list(p_search text default '', p_plan text default '', p_status text default '',
  p_platform text default '', p_active text default '', max_rows int default 100, p_offset int default 0)
returns table (id uuid, ref text, email_masked text, plan text, plan_until timestamptz, status text, platform text,
  app_version text, created_at timestamptz, last_seen timestamptz, total bigint)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not (public.admin_can('users') or public.admin_can('users_basic') or public.admin_can('plans')) then raise exception 'not allowed'; end if;
  return query
  with base as (
    select u.id, public.user_ref(u.id) as ref,
      regexp_replace(split_part(u.email, '@', 1), '^(.).*$', '\1•••') || '@' || split_part(u.email, '@', 2) as email_masked,
      coalesce(case when s.status in ('active', 'trialing') and s.current_period_end > now() then s.plan end, 'free') as plan,
      case when s.status in ('active', 'trialing') then s.current_period_end end as plan_until,
      case when u.banned_until > now() then 'suspended' when u.email_confirmed_at is null then 'unconfirmed' else 'active' end as status,
      p.platform, p.app_version, u.created_at, greatest(p.last_seen, u.last_sign_in_at) as last_seen, u.email
    from auth.users u
    left join public.subscriptions s on s.user_id = u.id
    left join public.presence p on p.user_id = u.id
  )
  select b.id, b.ref, b.email_masked, b.plan, b.plan_until, b.status, b.platform, b.app_version, b.created_at, b.last_seen, count(*) over ()
  from base b
  where (coalesce(p_search, '') = '' or b.ref = upper(trim(p_search)) or lower(b.email) = lower(trim(p_search)))
    and (coalesce(p_plan, '') = '' or b.plan = p_plan)
    and (coalesce(p_status, '') = '' or b.status = p_status)
    and (coalesce(p_platform, '') = '' or b.platform = p_platform)
    and (coalesce(p_active, '') = ''
      or (p_active = 'now' and b.last_seen > now() - interval '5 minutes')
      or (p_active = '24h' and b.last_seen > now() - interval '24 hours')
      or (p_active = '7d' and b.last_seen > now() - interval '7 days')
      or (p_active = 'inactive' and (b.last_seen is null or b.last_seen < now() - interval '30 days')))
  order by b.last_seen desc nulls last
  limit least(max_rows, 500) offset greatest(p_offset, 0);
end $$;

-- Detalhe: dados mínimos + contagens. Ver o email completo fica auditado.
create or replace function public.admin_user_detail(p_user uuid)
returns json language plpgsql security definer set search_path = public, auth as $$
declare r json;
begin
  if not (public.admin_can('users') or public.admin_can('users_basic') or public.admin_can('plans')) then raise exception 'not allowed'; end if;
  perform public._audit('view_user', public.user_ref(p_user), null, null, null);
  select json_build_object(
    'ref', public.user_ref(u.id), 'email', u.email, 'created_at', u.created_at, 'confirmed', u.email_confirmed_at is not null,
    'suspended_until', u.banned_until, 'provider', coalesce(u.raw_app_meta_data->>'provider', 'email'),
    'plan', (select json_build_object('plan', s.plan, 'status', s.status, 'until', s.current_period_end, 'source', s.source) from public.subscriptions s where s.user_id = u.id),
    'presence', (select json_build_object('platform', p.platform, 'version', p.app_version, 'last_seen', p.last_seen) from public.presence p where p.user_id = u.id),
    'counts', json_build_object(
      'transactions', (select count(*) from public.transactions t where t.user_id = u.id and t.deleted_at is null),
      'goals', (select count(*) from public.goals g where g.user_id = u.id and g.deleted_at is null),
      'active_days_30', (select count(*) from public.presence_days d where d.user_id = u.id and d.day > current_date - 30)),
    'plan_history', (select coalesce(json_agg(json_build_object('at', h.created_at, 'from', h.from_plan, 'to', h.to_plan, 'until', h.until, 'reason', h.reason, 'by', a.email) order by h.created_at desc), '[]'::json)
      from public.plan_history h left join auth.users a on a.id = h.admin_id where h.user_id = u.id),
    'audit', (select coalesce(json_agg(json_build_object('at', x.created_at, 'action', x.action, 'reason', x.reason, 'by', a.email) order by x.created_at desc), '[]'::json)
      from (select * from public.admin_audit where target = public.user_ref(u.id) order by created_at desc limit 30) x left join auth.users a on a.id = x.admin_id)
  ) into r from auth.users u where u.id = p_user;
  return r;
end $$;

-- 6. Ações sobre contas (motivo obrigatório, tudo auditado) ---------------------------------
create or replace function public.admin_change_plan(p_user uuid, p_plan text, p_until timestamptz, p_reason text)
returns void language plpgsql security definer set search_path = public, auth as $$
declare old text;
begin
  if not public.admin_can('plans') then raise exception 'not allowed'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason required'; end if;
  select coalesce(case when status in ('active', 'trialing') and current_period_end > now() then plan end, 'free') into old from public.subscriptions where user_id = p_user;
  old := coalesce(old, 'free');
  if p_plan = 'free' then
    update public.subscriptions set status = 'canceled', current_period_end = now(), source = 'manual', updated_at = now() where user_id = p_user;
  elsif p_plan in ('plus', 'family', 'pro') then
    insert into public.subscriptions (user_id, plan, status, current_period_end, source, updated_at)
    values (p_user, p_plan, 'active', coalesce(p_until, now() + interval '1 year'), 'manual', now())
    on conflict (user_id) do update set plan = excluded.plan, status = 'active', current_period_end = excluded.current_period_end, source = 'manual', updated_at = now();
  else raise exception 'invalid plan'; end if;
  insert into public.plan_history (user_id, from_plan, to_plan, until, admin_id, reason) values (p_user, old, p_plan, p_until, auth.uid(), p_reason);
  perform public._audit('change_plan', public.user_ref(p_user), json_build_object('plan', old)::jsonb, json_build_object('plan', p_plan, 'until', p_until)::jsonb, p_reason);
end $$;

-- Suspender (bloqueia o login) ou reativar. Nunca a um administrador.
create or replace function public.admin_set_suspended(p_user uuid, p_suspend boolean, p_reason text)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.admin_can('users') then raise exception 'not allowed'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason required'; end if;
  if exists (select 1 from public.admins where user_id = p_user) then raise exception 'cannot suspend an admin'; end if;
  update auth.users set banned_until = case when p_suspend then 'infinity'::timestamptz else null end where id = p_user;
  if p_suspend then delete from auth.sessions where user_id = p_user; end if; -- termina as sessões
  perform public._audit(case when p_suspend then 'suspend' else 'reactivate' end, public.user_ref(p_user), null, null, p_reason);
end $$;

-- Forçar logout (termina as sessões; a pessoa volta a entrar normalmente)
create or replace function public.admin_force_logout(p_user uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not (public.admin_can('users') or public.admin_can('users_basic')) then raise exception 'not allowed'; end if;
  delete from auth.sessions where user_id = p_user;
  perform public._audit('force_logout', public.user_ref(p_user), null, null, p_reason);
end $$;

-- Eliminar (substitui admin_delete_user por uma versão com motivo e auditoria)
create or replace function public.admin_delete_account(p_user uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.admin_can('users') then raise exception 'not allowed'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason required'; end if;
  if exists (select 1 from public.admins where user_id = p_user) then raise exception 'cannot delete an admin'; end if;
  perform public._audit('delete_account', public.user_ref(p_user), null, null, p_reason);
  delete from auth.users where id = p_user;
end $$;

-- 7. Métricas de atividade: DAU/WAU/MAU, ativos por dia e retenção D1/D7/D30 --------------------
create or replace function public.admin_activity()
returns json language plpgsql stable security definer set search_path = public, auth as $$
declare r json;
begin
  if not public.admin_can('view') then raise exception 'not allowed'; end if;
  select json_build_object(
    'dau', (select count(distinct user_id) from public.presence_days where day = current_date),
    'wau', (select count(distinct user_id) from public.presence_days where day > current_date - 7),
    'mau', (select count(distinct user_id) from public.presence_days where day > current_date - 30),
    'wau_prev', (select count(distinct user_id) from public.presence_days where day <= current_date - 7 and day > current_date - 14),
    'mau_prev', (select count(distinct user_id) from public.presence_days where day <= current_date - 30 and day > current_date - 60),
    'daily', (select coalesce(json_agg(json_build_object('day', d, 'n', n) order by d), '[]'::json)
      from (select day d, count(distinct user_id) n from public.presence_days where day > current_date - 90 group by 1) x),
    -- retenção: das pessoas registadas há pelo menos N dias (últimos 120 dias), quantas voltaram no dia N ou depois
    'ret_d1', (select round(100.0 * count(*) filter (where exists (select 1 from public.presence_days d where d.user_id = u.id and d.day >= u.created_at::date + 1)) / nullif(count(*), 0), 1)
      from auth.users u where u.created_at < now() - interval '1 day' and u.created_at > now() - interval '120 days'),
    'ret_d7', (select round(100.0 * count(*) filter (where exists (select 1 from public.presence_days d where d.user_id = u.id and d.day >= u.created_at::date + 7)) / nullif(count(*), 0), 1)
      from auth.users u where u.created_at < now() - interval '7 days' and u.created_at > now() - interval '120 days'),
    'ret_d30', (select round(100.0 * count(*) filter (where exists (select 1 from public.presence_days d where d.user_id = u.id and d.day >= u.created_at::date + 30)) / nullif(count(*), 0), 1)
      from auth.users u where u.created_at < now() - interval '30 days' and u.created_at > now() - interval '150 days'),
    -- churn mensal: ativos no mês anterior que não voltaram este mês
    'churn', (select round(100.0 * count(*) filter (where not exists (select 1 from public.presence_days d2 where d2.user_id = x.user_id and d2.day > current_date - 30)) / nullif(count(*), 0), 1)
      from (select distinct user_id from public.presence_days where day <= current_date - 30 and day > current_date - 60) x)
  ) into r;
  return r;
end $$;

-- 8. Tickets (a partir do feedback) ---------------------------------------------------------
alter table public.feedback drop constraint if exists feedback_status_check;
alter table public.feedback add constraint feedback_status_check check (status in ('new', 'progress', 'waiting', 'done', 'closed', 'reopened'));
alter table public.feedback add column if not exists priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent'));
alter table public.feedback add column if not exists assigned_to uuid references auth.users(id) on delete set null;
alter table public.feedback add column if not exists admin_notes text check (length(admin_notes) <= 4000);
alter table public.feedback add column if not exists updated_at timestamptz;

create or replace function public.admin_ticket_update(p_id uuid, p_status text, p_priority text, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare old record;
begin
  if not public.admin_can('tickets') then raise exception 'not allowed'; end if;
  select status, priority into old from public.feedback where id = p_id;
  update public.feedback set status = coalesce(p_status, status), priority = coalesce(p_priority, priority),
    admin_notes = coalesce(p_notes, admin_notes), assigned_to = coalesce(assigned_to, auth.uid()), updated_at = now() where id = p_id;
  perform public._audit('ticket_update', 'T-' || upper(substr(p_id::text, 1, 6)), to_jsonb(old), json_build_object('status', p_status, 'priority', p_priority)::jsonb, null);
end $$;

-- Permissões das funções
do $$ declare f text; begin
  foreach f in array array['admin_role()', 'admin_can(text)', 'admin_audit_list(text,int)', 'admin_user_list(text,text,text,text,text,int,int)',
    'admin_user_detail(uuid)', 'admin_change_plan(uuid,text,timestamptz,text)', 'admin_set_suspended(uuid,boolean,text)',
    'admin_force_logout(uuid,text)', 'admin_delete_account(uuid,text)', 'admin_activity()', 'admin_ticket_update(uuid,text,text,text)']
  loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;

-- Para dar um papel a outra pessoa (ex.: suporte):
-- insert into public.admins (user_id, role) select id, 'support' from auth.users where email = 'pessoa@exemplo.com';
