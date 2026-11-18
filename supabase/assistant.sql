-- FuturePal Assistente IA: subscrições (fonte de verdade do plano), quotas mensais e interruptor geral.
-- Como usar: Supabase > SQL Editor > New query > colar TUDO isto > Run. Pode correr-se mais do que uma vez.
-- A Edge Function "ai-ask" (supabase/functions/ai-ask) usa estas tabelas com a service role.

-- ---------------------------------------------------------------- subscrições
-- Só o servidor escreve aqui (webhook do RevenueCat/Paddle, ou tu no painel do Supabase para testes).
-- A pessoa pode LER a sua linha, nunca alterá-la.
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null check (plan in ('plus','family','pro')),
  status text not null default 'active' check (status in ('active','trialing','canceled','expired')),
  current_period_end timestamptz not null,
  source text not null default 'manual', -- 'manual' | 'revenuecat' | 'paddle'
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
drop policy if exists sub_read_own on public.subscriptions;
create policy sub_read_own on public.subscriptions for select to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------- quotas do assistente (por mês)
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null,                 -- 'YYYY-MM'
  questions integer not null default 0,
  photos integer not null default 0,
  cost_microcents bigint not null default 0, -- estimativa do custo (milionésimos de cêntimo)
  primary key (user_id, month)
);
alter table public.ai_usage enable row level security;
drop policy if exists ai_usage_read_own on public.ai_usage;
create policy ai_usage_read_own on public.ai_usage for select to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------- configuração (uma linha)
-- enabled           : interruptor geral do assistente
-- monthly_questions : perguntas por pessoa por mês
-- monthly_photos    : fotos de faturas por pessoa por mês
-- budget_cents      : teto de gastos de IA por mês para TODOS (0 = sem teto); ao chegar lá, o assistente pausa
create table if not exists public.ai_settings (
  id integer primary key default 1 check (id = 1),
  enabled boolean not null default true,
  monthly_questions integer not null default 100,
  monthly_photos integer not null default 30,
  budget_cents integer not null default 1000
);
insert into public.ai_settings (id) values (1) on conflict (id) do nothing;
alter table public.ai_settings enable row level security; -- sem políticas: só a service role lê/escreve

-- Total gasto em IA este mês (para o teto). Só a service role chama.
create or replace function public.ai_month_cost(p_month text)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(sum(cost_microcents), 0) from public.ai_usage where month = p_month;
$$;
revoke all on function public.ai_month_cost(text) from anon, authenticated;

-- Soma uso de forma atómica. Só a service role chama.
create or replace function public.ai_add_usage(p_user uuid, p_month text, p_questions int, p_photos int, p_cost bigint)
returns void language sql security definer set search_path = public as $$
  insert into public.ai_usage (user_id, month, questions, photos, cost_microcents)
  values (p_user, p_month, p_questions, p_photos, p_cost)
  on conflict (user_id, month) do update set
    questions = ai_usage.questions + excluded.questions,
    photos = ai_usage.photos + excluded.photos,
    cost_microcents = ai_usage.cost_microcents + excluded.cost_microcents;
$$;
revoke all on function public.ai_add_usage(uuid, text, int, int, bigint) from anon, authenticated;

-- PARA TESTAR sem pagamentos: dá-te Plus por um ano (troca o email).
-- insert into public.subscriptions (user_id, plan, current_period_end)
--   select id, 'plus', now() + interval '1 year' from auth.users where email = 'o-teu-email'
--   on conflict (user_id) do update set plan = excluded.plan, status = 'active', current_period_end = excluded.current_period_end;
