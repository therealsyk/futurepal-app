-- Painel de administração: ver e mudar a subscrição de qualquer conta.
-- Como usar: Supabase > SQL Editor > colar TUDO isto > Run (depois de admin.sql e assistant.sql).

-- Lista as contas com o plano atual (as que não têm linha em subscriptions estão no Grátis).
create or replace function public.admin_subscriptions(p_search text default '', max_rows int default 100)
returns table (email text, plan text, status text, current_period_end timestamptz, source text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  return query
    select u.email::text,
           coalesce(case when s.status in ('active','trialing') and s.current_period_end > now() then s.plan end, 'free'),
           coalesce(s.status, '—'), s.current_period_end, coalesce(s.source, '—'), u.created_at
    from auth.users u left join public.subscriptions s on s.user_id = u.id
    where coalesce(p_search, '') = '' or u.email ilike '%' || p_search || '%'
    order by (s.user_id is null), u.created_at desc
    limit least(max_rows, 500);
end $$;

-- Muda o plano de uma conta. 'free' termina a subscrição. p_until = até quando (vazio = 1 ano).
create or replace function public.admin_set_subscription(p_email text, p_plan text, p_until timestamptz default null)
returns void language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'user not found'; end if;
  if p_plan = 'free' then
    update public.subscriptions set status = 'canceled', current_period_end = now(), source = 'manual', updated_at = now() where user_id = uid;
    return;
  end if;
  if p_plan not in ('plus','family','pro') then raise exception 'invalid plan'; end if;
  insert into public.subscriptions (user_id, plan, status, current_period_end, source, updated_at)
  values (uid, p_plan, 'active', coalesce(p_until, now() + interval '1 year'), 'manual', now())
  on conflict (user_id) do update set plan = excluded.plan, status = 'active',
    current_period_end = excluded.current_period_end, source = 'manual', updated_at = now();
end $$;

revoke all on function public.admin_subscriptions(text, int), public.admin_set_subscription(text, text, timestamptz) from public, anon;
grant execute on function public.admin_subscriptions(text, int), public.admin_set_subscription(text, text, timestamptz) to authenticated;
