-- Fotos dos membros na Divisão de contas. Correr DEPOIS de split.sql (idempotente).
-- Sem esta migração a app continua a funcionar e mostra as iniciais.

alter table public.split_members add column if not exists avatar_url text;

-- A app chama isto ao abrir a aba: guarda a minha foto (ou null) em todos os grupos onde estou.
create or replace function public.set_split_avatar(p_url text)
returns void language plpgsql security definer set search_path = public as $$
declare u text := nullif(trim(coalesce(p_url, '')), '');
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if u is not null and (length(u) > 2048 or u !~* '^https://') then u := null; end if;
  update public.split_members set avatar_url = u
   where user_id = auth.uid() and avatar_url is distinct from u;
end $$;

revoke all on function public.set_split_avatar(text) from public, anon;
grant execute on function public.set_split_avatar(text) to authenticated;
