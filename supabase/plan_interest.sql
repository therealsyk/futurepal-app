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
