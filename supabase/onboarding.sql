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
