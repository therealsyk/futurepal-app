-- Divisão de contas v3: só quem criou o grupo pode apagar transações dele ou apagar o grupo. Qualquer pessoa pode sair.
-- Correr uma vez no Supabase (SQL Editor), depois de split.sql e split-v2.sql. Pode correr-se mais do que uma vez.

create or replace function public.is_split_owner(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.split_groups where id = gid and owner_id = auth.uid());
$$;

drop policy if exists sb_delete on public.split_bills;
create policy sb_delete on public.split_bills for update to authenticated
  using (public.is_split_owner(group_id)) with check (public.is_split_owner(group_id));

create or replace function public.delete_split_group(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_split_owner(p_group) then raise exception 'only the group owner can delete it'; end if;
  delete from public.split_groups where id = p_group; -- membros, convites, transações e partes saem em cascata
end $$;

do $$ declare f text; begin
  foreach f in array array['is_split_owner(uuid)','delete_split_group(uuid)']
  loop execute 'revoke all on function public.' || f || ' from public, anon'; execute 'grant execute on function public.' || f || ' to authenticated'; end loop;
end $$;
