-- Repositório de reserva das atualizações (corre uma vez no SQL Editor do Supabase).
-- A app procura atualizações no repositório que vem no instalador. Só se isso FALHAR (ex.: repositório privado,
-- apagado ou com o nome mudado) é que usa o repositório guardado aqui, que se muda no painel de admin.

create table if not exists public.app_config (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;

-- toda a gente (incluindo quem não tem sessão) pode ler; ninguém escreve diretamente
drop policy if exists "app_config read" on public.app_config;
create policy "app_config read" on public.app_config for select using (true);

-- só administradores mudam, e só para o formato dono/repositório do GitHub
create or replace function public.admin_set_config(p_key text, p_value text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  if p_key <> 'update_repo' then raise exception 'unknown key'; end if;
  if p_value <> '' and p_value !~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' then raise exception 'invalid repo'; end if;
  insert into public.app_config (key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

revoke all on function public.admin_set_config(text, text) from public, anon;
grant execute on function public.admin_set_config(text, text) to authenticated;

insert into public.app_config (key, value) values ('update_repo', 'therealsyk/futurepal') on conflict (key) do nothing;
