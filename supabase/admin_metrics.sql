-- FuturePal: métricas do painel (engajamento, adoção, saúde técnica, suporte, segurança, monetização).
-- Corre UMA vez no Supabase > SQL Editor (depois de admin_team.sql). Só contagens agregadas: nada de valores nem textos.

-- 1. Uso anónimo: minutos por dia em cada ecrã (a app soma 1 minuto por cada minuto aberta) e eventos (ex.: exportar).
create table if not exists public.usage_daily (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null default current_date,
  page text not null check (length(page) <= 40),
  minutes int not null default 0,
  primary key (user_id, day, page)
);
alter table public.usage_daily enable row level security; -- sem políticas: só pelas funções abaixo

create or replace function public.track_minute(p_page text)
returns void language sql security definer set search_path = public as $$
  insert into public.usage_daily (user_id, day, page, minutes) values (auth.uid(), current_date, left(coalesce(p_page, '/'), 40), 1)
  on conflict (user_id, day, page) do update set minutes = public.usage_daily.minutes + 1;
$$;
create or replace function public.track_event(p_event text)
returns void language sql security definer set search_path = public as $$
  insert into public.usage_daily (user_id, day, page, minutes) values (auth.uid(), current_date, 'evt:' || left(coalesce(p_event, ''), 30), 1)
  on conflict (user_id, day, page) do update set minutes = public.usage_daily.minutes + 1;
$$;

-- 2. Erros da app (agregados por dia, plataforma e versão; sem dados da pessoa)
create table if not exists public.client_errors (
  day date not null default current_date,
  platform text not null check (length(platform) <= 20),
  version text not null check (length(version) <= 30),
  kind text not null check (length(kind) <= 80),
  n int not null default 0,
  primary key (day, platform, version, kind)
);
alter table public.client_errors enable row level security;
create or replace function public.report_error(p_platform text, p_version text, p_kind text)
returns void language sql security definer set search_path = public as $$
  insert into public.client_errors (day, platform, version, kind, n) values (current_date, left(p_platform, 20), left(p_version, 30), left(p_kind, 80), 1)
  on conflict (day, platform, version, kind) do update set n = public.client_errors.n + 1;
$$;

-- 3. Métricas para o painel
create or replace function public.admin_metrics()
returns json language plpgsql stable security definer set search_path = public, auth as $$
declare r json; mau bigint; users bigint;
begin
  if not public.admin_can('view') then raise exception 'not allowed'; end if;
  select count(distinct user_id) into mau from public.presence_days where day > current_date - 30;
  select count(*) into users from auth.users where email not like '%@staff.futurepal.invalid';
  select json_build_object(
    'users', users, 'mau', mau,
    'signups_today', (select count(*) from auth.users where created_at >= date_trunc('day', now())),
    -- Engajamento (só contagens)
    'expenses_total', (select count(*) from public.transactions where deleted_at is null and type = 'expense'),
    'expenses_30d', (select count(*) from public.transactions where deleted_at is null and type = 'expense' and created_at > now() - interval '30 days'),
    'goals_total', (select count(*) from public.goals where deleted_at is null),
    'pct_with_goal', (select round(100.0 * count(distinct user_id) / nullif(users, 0), 1) from public.goals where deleted_at is null),
    'avg_session_min', (select round(avg(m), 1) from (select user_id, day, sum(minutes) m from public.usage_daily where page not like 'evt:%' and day > current_date - 30 group by 1, 2) x),
    'days_per_user_30', (select round(avg(n), 1) from (select user_id, count(*) n from public.presence_days where day > current_date - 30 group by 1) y),
    'pct_reports', (select round(100.0 * count(distinct user_id) / nullif(mau, 0), 1) from public.usage_daily where day > current_date - 30 and (page in ('/visao-mensal', '/resumo-ano', '/calendario') or page = '/')),
    -- Adoção de funcionalidades: % de contas que usam cada coisa (pelos dados) e ecrãs mais usados (minutos)
    'adoption', json_build_object(
      'goals', (select count(distinct user_id) from public.goals where deleted_at is null),
      'budgets', (select count(distinct user_id) from public.budgets where deleted_at is null),
      'salaries', (select count(distinct user_id) from public.salaries where deleted_at is null),
      'recurring', (select count(distinct user_id) from public.recurrings where deleted_at is null),
      'groups', (select count(distinct user_id) from public.groups where deleted_at is null),
      'custom_categories', (select count(distinct user_id) from public.categories where deleted_at is null and name_key is null),
      'multi_accounts', (select count(*) from (select user_id from public.accounts where deleted_at is null group by 1 having count(*) > 1) z),
      'exports', (select count(distinct user_id) from public.usage_daily where page in ('evt:export', 'evt:backup') and day > current_date - 90)),
    'pages', (select coalesce(json_object_agg(page, m), '{}'::json) from (select page, sum(minutes) m from public.usage_daily where page not like 'evt:%' and day > current_date - 30 group by 1 order by 2 desc limit 10) p),
    -- Saúde técnica
    'db_size', pg_database_size(current_database()),
    'rows', json_build_object('transactions', (select count(*) from public.transactions), 'accounts', (select count(*) from public.accounts), 'goals', (select count(*) from public.goals)),
    'errors_7d', (select coalesce(sum(n), 0) from public.client_errors where day > current_date - 7),
    'errors_by_version', (select coalesce(json_object_agg(k, n), '{}'::json) from (select platform || ' ' || version k, sum(n) n from public.client_errors where day > current_date - 7 group by 1 order by 2 desc limit 6) e),
    'errors_top', (select coalesce(json_object_agg(kind, n), '{}'::json) from (select kind, sum(n) n from public.client_errors where day > current_date - 7 group by 1 order by 2 desc limit 6) f),
    -- Suporte
    'tickets_open', (select count(*) from public.feedback where status in ('new', 'progress', 'waiting', 'reopened')),
    'tickets_done_30d', (select count(*) from public.feedback where status in ('done', 'closed') and coalesce(updated_at, created_at) > now() - interval '30 days'),
    'tickets_by_kind', (select coalesce(json_object_agg(kind, n), '{}'::json) from (select kind, count(*) n from public.feedback where created_at > now() - interval '90 days' group by 1) g),
    -- Segurança (agregado)
    'suspended', (select count(*) from auth.users where banned_until > now()),
    'deleted_30d', (select count(*) from public.admin_audit where action in ('delete_account') and created_at > now() - interval '30 days'),
    'unconfirmed', (select count(*) from auth.users where email_confirmed_at is null),
    'max_signups_hour_24h', (select coalesce(max(n), 0) from (select date_trunc('hour', created_at) h, count(*) n from auth.users where created_at > now() - interval '24 hours' group by 1) s),
    -- Monetização
    'subs', (select coalesce(json_object_agg(plan, n), '{}'::json) from (select plan, count(*) n from public.subscriptions where status in ('active', 'trialing') and current_period_end > now() group by 1) t),
    'subs_canceled_30d', (select count(*) from public.subscriptions where status = 'canceled' and updated_at > now() - interval '30 days')
  ) into r;
  return r;
end $$;

-- Teste de resposta (o painel mede quanto demora)
create or replace function public.admin_ping() returns int language sql stable security definer set search_path = public as $$ select 1; $$;

do $$ declare f text; begin
  foreach f in array array['track_minute(text)', 'track_event(text)', 'report_error(text,text,text)', 'admin_metrics()', 'admin_ping()']
  loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
