-- FuturePal: painel de administração.
-- Corre este ficheiro no Supabase (SQL Editor) DEPOIS do schema.sql.
-- Segurança: a tabela "admins" não tem políticas (ninguém a lê pela app); as funções abaixo
-- verificam se quem chama está nessa tabela e só devolvem números agregados e a lista de contas.
-- Nenhuma chave secreta é usada na app nem no site.

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- Números gerais
create or replace function public.admin_stats()
returns json language plpgsql stable security definer set search_path = public, auth as $$
declare r json;
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  select json_build_object(
    'users_total',      (select count(*) from auth.users),
    'users_7d',         (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'users_30d',        (select count(*) from auth.users where created_at > now() - interval '30 days'),
    'active_7d',        (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
    'active_30d',       (select count(*) from auth.users where last_sign_in_at > now() - interval '30 days'),
    'unconfirmed',      (select count(*) from auth.users where email_confirmed_at is null),
    'with_data',        (select count(distinct user_id) from public.transactions),
    'tx_total',         (select count(*) from public.transactions where deleted_at is null),
    'tx_30d',           (select count(*) from public.transactions where deleted_at is null and created_at > now() - interval '30 days'),
    'accounts_total',   (select count(*) from public.accounts where deleted_at is null),
    'goals_total',      (select count(*) from public.goals where deleted_at is null),
    'providers',        (select coalesce(json_object_agg(p, n), '{}'::json) from (select coalesce(raw_app_meta_data->>'provider', 'email') p, count(*) n from auth.users group by 1) x),
    'languages',        (select coalesce(json_object_agg(l, n), '{}'::json) from (select coalesce(language, '?') l, count(*) n from public.settings group by 1) y),
    'signups_by_day',   (select coalesce(json_agg(json_build_object('day', d, 'n', n) order by d), '[]'::json) from (select date(created_at) d, count(*) n from auth.users where created_at > now() - interval '30 days' group by 1) z)
  ) into r;
  return r;
end $$;

-- Últimas contas criadas (para suporte). Não devolve dados financeiros, só contagens.
create or replace function public.admin_users(max_rows int default 50)
returns table (email text, created_at timestamptz, last_sign_in_at timestamptz, provider text, confirmed boolean, tx_count bigint)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  return query
    select u.email::text, u.created_at, u.last_sign_in_at, coalesce(u.raw_app_meta_data->>'provider', 'email'),
           u.email_confirmed_at is not null,
           (select count(*) from public.transactions t where t.user_id = u.id and t.deleted_at is null)
    from auth.users u order by u.created_at desc limit least(max_rows, 500);
end $$;

-- Publicar uma versão nova (aviso de atualização nas apps)
create or replace function public.admin_set_version(p_platform text, p_version text, p_min text, p_notes text, p_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  insert into public.app_versions (platform, latest_version, min_version, notes, download_url, published_at)
  values (p_platform, p_version, coalesce(nullif(p_min, ''), '0.0.0'), coalesce(p_notes, ''), coalesce(p_url, ''), now())
  on conflict (platform) do update set latest_version = excluded.latest_version, min_version = excluded.min_version,
    notes = excluded.notes, download_url = excluded.download_url, published_at = now();
end $$;

revoke all on function public.is_admin(), public.admin_stats(), public.admin_users(int), public.admin_set_version(text, text, text, text, text) from public, anon;
grant execute on function public.is_admin(), public.admin_stats(), public.admin_users(int), public.admin_set_version(text, text, text, text, text) to authenticated;

-- Para te tornares administrador, corre UMA vez (troca pelo email da tua conta no FuturePal):
-- insert into public.admins (user_id) select id from auth.users where email = 'o-teu-email@exemplo.com';
