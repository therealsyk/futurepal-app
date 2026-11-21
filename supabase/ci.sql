-- FuturePal: Consumer Intelligence (estatística agregada e anonimizada). Corre UMA vez no Supabase > SQL Editor
-- (depois de admin_staff.sql). Regras de privacidade aplicadas AQUI, no servidor:
--   • nenhum resultado com menos de K pessoas (K = 10); dominância: nenhuma pessoa pode valer > 50% de um valor;
--   • valores extremos (acima do percentil 99,5) fora das médias; valores arredondados ao euro;
--   • nunca devolve linhas individuais, IDs, emails, descrições ou valores de uma pessoa; período mínimo = mês;
--   • contas da equipa (@staff) e quem desligou "Contribuir para estatísticas anónimas" ficam de fora.
-- Arquitetura: tudo no schema "ci" (separado dos dados das pessoas). Uma futura API B2B lê só public.ci_get(...).

create schema if not exists ci;
revoke all on schema ci from public, anon, authenticated;

-- Opção da pessoa: não contribuir para as estatísticas (Definições)
create table if not exists public.ci_optout (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.ci_optout enable row level security;
drop policy if exists ci_optout_own on public.ci_optout;
create policy ci_optout_own on public.ci_optout for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, delete on public.ci_optout to authenticated;

-- Cache dos resultados (6 horas), para não pesar na base de dados
create table if not exists ci.cache (key text primary key, data json not null, computed_at timestamptz not null default now());

-- Permissão: super, admin e finance
create or replace function public.ci_allowed() returns boolean language sql stable security definer set search_path = public, auth as $$
  select coalesce((select role in ('super', 'admin', 'finance') from public.admins where user_id = auth.uid()), false)
    and (not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
         or coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2');
$$;

-- Movimentos válidos para análise (só uso interno destas funções; nunca sai para o painel)
create or replace function ci.base(p_from date, p_to date, p_cur text)
returns table (uid uuid, month date, kind text, cat text, amount bigint, descr text, day date, has_cat boolean)
language sql stable security definer set search_path = public, auth as $$
  with t as (
    select x.user_id as uid, date_trunc('month', x.date)::date as month, x.type as kind,
           coalesce(c.name_key, 'custom') as cat, x.amount_cents as amount, x.description as descr, x.date as day, (c.id is not null) as has_cat
    from public.transactions x
    join auth.users u on u.id = x.user_id and u.email not like '%@staff.futurepal.invalid'
    left join public.categories c on c.id = x.category_id and c.user_id = x.user_id and c.deleted_at is null
    where x.deleted_at is null and x.date between p_from and p_to and x.currency = p_cur
      and not exists (select 1 from public.ci_optout o where o.user_id = x.user_id)
  ), cap as (select percentile_cont(0.995) within group (order by amount) as p from t where kind = 'expense')
  select t.uid, t.month, t.kind, t.cat, t.amount, t.descr, t.day, t.has_cat from t, cap
  where t.kind = 'income' or cap.p is null or t.amount <= cap.p;
$$;
revoke all on function ci.base(date, date, text) from public, anon, authenticated;

-- Cálculo de cada página (devolve só agregados que passam as regras)
create or replace function ci.compute(p_kind text, p_from date, p_to date, p_cur text, p_cat text)
returns json language plpgsql volatile security definer set search_path = public, auth, ci as $$
declare k int := 10; r json; plen int := (p_to - p_from) + 1; pf date := p_from - plen; pt date := p_from - 1;
begin
  create temporary table if not exists _b (uid uuid, month date, kind text, cat text, amount bigint, descr text, day date, has_cat boolean) on commit drop;
  delete from _b;
  insert into _b select * from ci.base(p_from, p_to, p_cur) where coalesce(p_cat, '') = '' or cat = p_cat or kind = 'income';

  if p_kind = 'overview' then
    with ue as (select uid, sum(amount) s, count(*) n from _b where kind = 'expense' group by uid),
         ui as (select uid, sum(amount) s from _b where kind = 'income' group by uid),
         sr as (select (i.s - coalesce(e.s, 0))::numeric / i.s as rate from ui i left join ue e using (uid) where i.s > 0),
         cu as (select cat, uid, sum(amount) s from _b where kind = 'expense' group by cat, uid),
         ca as (select cat, count(*) nu, sum(s) tot, max(s) mx from cu group by cat),
         mo as (select month, count(distinct uid) nu, sum(amount) tot from _b where kind = 'expense' group by month)
    select json_build_object(
      'k', k,
      'users_with_data', (select count(*) from ue where n >= 3),
      'expenses', (select count(*) from _b where kind = 'expense'),
      'volume', case when (select count(*) from ue) >= k then (select round(sum(s) / 100.0) from ue) end,
      'avg_user', case when (select count(*) from ue) >= k then (select round(avg(s) / 100.0) from ue) end,
      'median_user', case when (select count(*) from ue) >= k then (select round((percentile_cont(0.5) within group (order by s)) / 100.0) from ue) end,
      'savings_rate', case when (select count(*) from sr) >= k then (select round(100 * (percentile_cont(0.5) within group (order by rate))::numeric, 1) from sr) end,
      'savers', (select count(*) from sr),
      'by_cat', (select coalesce(json_object_agg(cat, round(100.0 * tot / nullif((select sum(tot) from ca where nu >= k and mx <= tot / 2), 0), 1)), '{}'::json) from ca where nu >= k and mx <= tot / 2),
      'monthly', (select coalesce(json_agg(json_build_object('m', month, 'v', round(tot / 100.0), 'u', nu) order by month), '[]'::json) from mo where nu >= k),
      'active_users', (select coalesce(json_agg(json_build_object('m', month, 'u', nu) order by month), '[]'::json) from mo)
    ) into r;

  elsif p_kind = 'categories' then
    with cu as (select cat, uid, sum(amount) s from _b where kind = 'expense' group by cat, uid),
         ca as (select cat, count(*) nu, sum(s) tot, max(s) mx, avg(s) av, percentile_cont(0.5) within group (order by s) md from cu group by cat),
         half as (select cat,
                    sum(amount) filter (where day >= p_from + plen / 2) as h2, sum(amount) filter (where day < p_from + plen / 2) as h1
                  from _b where kind = 'expense' group by cat)
    select json_build_object('k', k, 'rows', coalesce(json_agg(json_build_object(
        'cat', ca.cat, 'users', ca.nu, 'avg', round(ca.av / 100.0), 'median', round(ca.md / 100.0),
        'pct', round(100.0 * ca.tot / nullif((select sum(tot) from ca c2 where c2.nu >= k and c2.mx <= c2.tot / 2), 0), 1),
        'trend', case when coalesce(h.h1, 0) > 0 then round(100.0 * (coalesce(h.h2, 0) - h.h1) / h.h1) end
      ) order by ca.tot desc), '[]'::json),
      'monthly', (select coalesce(json_agg(json_build_object('m', month, 'cat', cat, 'v', round(v / 100.0)) order by month), '[]'::json)
                  from (select month, cat, sum(amount) v, count(distinct uid) nu from _b where kind = 'expense' group by month, cat) z where nu >= k))
    into r from ca left join half h using (cat) where ca.nu >= k and ca.mx <= ca.tot / 2;

  elsif p_kind = 'trends' then
    with mo as (select month, count(distinct uid) nu, sum(amount) tot from _b where kind = 'expense' group by month),
         qu as (select date_trunc('quarter', month)::date q, count(distinct uid) nu, sum(amount) tot from _b where kind = 'expense' group by 1),
         prev as (select count(distinct uid) nu, sum(amount) tot from ci.base(pf, pt, p_cur) where kind = 'expense' and (coalesce(p_cat, '') = '' or cat = p_cat)),
         yoy as (select count(distinct uid) nu, sum(amount) tot from ci.base((p_from - interval '1 year')::date, (p_to - interval '1 year')::date, p_cur) where kind = 'expense' and (coalesce(p_cat, '') = '' or cat = p_cat)),
         cur as (select count(distinct uid) nu, sum(amount) tot from _b where kind = 'expense')
    select json_build_object('k', k,
      'monthly', (select coalesce(json_agg(json_build_object('m', month, 'v', round(tot / 100.0), 'u', nu) order by month), '[]'::json) from mo where nu >= k),
      'quarterly', (select coalesce(json_agg(json_build_object('q', q, 'v', round(tot / 100.0), 'u', nu) order by q), '[]'::json) from qu where nu >= k),
      'vs_prev', (select case when cur.nu >= k and prev.nu >= k and prev.tot > 0 then round(100.0 * (cur.tot - prev.tot) / prev.tot, 1) end from cur, prev),
      'vs_year', (select case when cur.nu >= k and yoy.nu >= k and yoy.tot > 0 then round(100.0 * (cur.tot - yoy.tot) / yoy.tot, 1) end from cur, yoy),
      'per_user_now', (select case when nu >= k then round(tot / nu / 100.0) end from cur),
      'per_user_prev', (select case when nu >= k then round(tot / nu / 100.0) end from prev)
    ) into r;

  elsif p_kind = 'savings' then
    with um as (select uid, month, sum(amount) filter (where kind = 'income') inc, sum(amount) filter (where kind = 'expense') exp from _b group by uid, month),
         rt as (select month, (inc - coalesce(exp, 0))::numeric / inc as rate, inc - coalesce(exp, 0) as saved from um where inc > 0),
         g as (select x.target_cents, x.current_cents from public.goals x join auth.users u on u.id = x.user_id and u.email not like '%@staff.futurepal.invalid'
               where x.deleted_at is null and x.target_cents > 0 and not exists (select 1 from public.ci_optout o where o.user_id = x.user_id))
    select json_build_object('k', k,
      'savers', (select count(distinct uid) from um where inc > 0),
      'rate_median', case when (select count(*) from rt) >= k then (select round(100 * (percentile_cont(0.5) within group (order by rate))::numeric, 1) from rt) end,
      'saved_avg', case when (select count(*) from rt) >= k then (select round(avg(saved) / 100.0) from rt) end,
      'saved_median', case when (select count(*) from rt) >= k then (select round((percentile_cont(0.5) within group (order by saved)) / 100.0) from rt) end,
      'monthly', (select coalesce(json_agg(json_build_object('m', month, 'rate', round(100 * md::numeric, 1)) order by month), '[]'::json)
                  from (select month, count(*) n, percentile_cont(0.5) within group (order by rate) md from rt group by month) z where n >= k),
      'goals', (select count(*) from g),
      'goals_reached_pct', case when (select count(*) from g) >= k then (select round(100.0 * count(*) filter (where current_cents >= target_cents) / count(*), 1) from g) end,
      'goal_buckets', (select coalesce(json_object_agg(b, n), '{}'::json) from (
          select case when target_cents < 50000 then '< 500 €' when target_cents < 200000 then '500–2 000 €' when target_cents < 1000000 then '2 000–10 000 €' else '> 10 000 €' end b, count(*) n
          from g group by 1) z where n >= k)
    ) into r;

  elsif p_kind = 'quality' then
    with um as (select uid, month, count(*) n from _b group by uid, month)
    select json_build_object('k', k,
      'records', (select count(*) from _b),
      'users', (select count(distinct uid) from _b),
      'users_sufficient', (select count(distinct uid) from um where n >= 5),
      'pct_categorized', (select round(100.0 * count(*) filter (where has_cat and cat <> 'custom') / nullif(count(*), 0), 1) from _b where kind = 'expense'),
      'uncategorized', (select count(*) from _b where kind = 'expense' and not has_cat),
      'custom_cat', (select count(*) from _b where kind = 'expense' and has_cat and cat = 'custom'),
      'no_description', (select count(*) from _b where coalesce(trim(descr), '') = ''),
      'duplicates', (select coalesce(sum(c - 1), 0) from (select count(*) c from _b group by uid, day, amount, descr having count(*) > 1) d),
      'first_day', (select min(day) from _b), 'last_day', (select max(day) from _b),
      'months', (select count(distinct month) from _b),
      'growth', (select coalesce(json_agg(json_build_object('m', month, 'n', n) order by month), '[]'::json) from (select month, count(*) n from _b group by month) z)
    ) into r;
  else
    raise exception 'unknown kind';
  end if;
  return r;
end $$;
revoke all on function ci.compute(text, date, date, text, text) from public, anon, authenticated;

-- Única porta de entrada (painel agora; API B2B no futuro): permissões + cache de 6 horas
create or replace function public.ci_get(p_kind text, p_from date, p_to date, p_cur text default 'EUR', p_cat text default '', p_fresh boolean default false)
returns json language plpgsql volatile security definer set search_path = public, ci as $$
declare v_key text := p_kind || '|' || p_from || '|' || p_to || '|' || coalesce(p_cur, 'EUR') || '|' || coalesce(p_cat, ''); r json;
begin
  if not public.ci_allowed() then raise exception 'not allowed'; end if;
  if p_to < p_from or p_to - p_from > 3660 then raise exception 'invalid period'; end if;
  if not p_fresh then
    select c.data into r from ci.cache c where c.key = v_key and c.computed_at > now() - interval '6 hours';
    if r is not null then return r; end if;
  end if;
  r := ci.compute(p_kind, date_trunc('month', p_from)::date, (date_trunc('month', p_to) + interval '1 month - 1 day')::date, coalesce(p_cur, 'EUR'), p_cat);
  insert into ci.cache (key, data, computed_at) values (v_key, r, now()) on conflict (key) do update set data = excluded.data, computed_at = now();
  perform public._audit('ci_view', p_kind, null, json_build_object('from', p_from, 'to', p_to, 'cat', p_cat)::jsonb, null);
  return r;
end $$;
revoke all on function public.ci_get(text, date, date, text, text, boolean) from public, anon;
grant execute on function public.ci_get(text, date, date, text, text, boolean) to authenticated;
revoke all on function public.ci_allowed() from public, anon;
grant execute on function public.ci_allowed() to authenticated;

-- Moedas com dados (para o filtro)
create or replace function public.ci_currencies() returns json language sql stable security definer set search_path = public as $$
  select case when public.ci_allowed() then (select coalesce(json_agg(currency order by n desc), '["EUR"]'::json)
    from (select currency, count(distinct user_id) n from public.transactions where deleted_at is null group by 1 having count(distinct user_id) >= 10) z) end;
$$;
revoke all on function public.ci_currencies() from public, anon;
grant execute on function public.ci_currencies() to authenticated;
