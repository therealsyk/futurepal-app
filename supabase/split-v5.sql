-- Divisão de contas v5 (substitui o split-v4.sql: quem já o correu corre este por cima; quem não correu só precisa deste).
-- O nome, a foto e a cor do grupo são iguais para todos. Só altera o grupo (nome, foto, transações, apagar) quem o criou
-- e as pessoas a quem o criador deu permissão.
-- Correr uma vez no Supabase (SQL Editor), depois de split.sql, split-v2.sql e split-v3.sql. Pode correr-se mais do que uma vez.

alter table public.split_groups add column if not exists image text;
alter table public.split_groups add column if not exists color text;
alter table public.split_members add column if not exists can_edit boolean not null default false;

create or replace function public.is_split_owner(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.split_groups where id = gid and owner_id = auth.uid());
$$;

-- Quem criou o grupo, ou um participante com permissão
create or replace function public.can_edit_split(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_split_owner(gid)
      or exists (select 1 from public.split_members where group_id = gid and user_id = auth.uid() and can_edit);
$$;

-- Só quem criou o grupo escolhe quem mais o pode alterar (a lista substitui a anterior)
create or replace function public.set_split_editors(p_group uuid, p_users uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_split_owner(p_group) then raise exception 'only the group owner can change permissions'; end if;
  update public.split_members set can_edit = (user_id = any(coalesce(p_users, '{}'::uuid[])) and user_id <> auth.uid())
   where group_id = p_group;
end $$;

drop function if exists public.update_split_group(uuid, text, text, text, boolean); -- versão do v4
create or replace function public.update_split_group(p_group uuid, p_name text, p_color text, p_image text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_edit_split(p_group) then raise exception 'not allowed to change this group'; end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 80 then raise exception 'invalid name'; end if;
  if coalesce(p_color, '') !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'invalid color'; end if;
  if coalesce(p_image, '') <> '' and (length(p_image) > 200000 or p_image !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$') then raise exception 'invalid image'; end if;
  update public.split_groups set name = trim(p_name), color = p_color, image = coalesce(p_image, '') where id = p_group;
end $$;

create or replace function public.add_split_bill(p_group uuid, p_description text, p_amount_cents bigint, p_date date, p_members uuid[], p_creator_paid boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid; n int; base bigint; rest bigint; i int := 0; m uuid;
begin
  if not public.is_split_member(p_group) then raise exception 'not member'; end if;
  if not public.can_edit_split(p_group) then raise exception 'not allowed to add'; end if;
  if p_amount_cents <= 0 then raise exception 'invalid amount'; end if;
  select array_agg(x) into p_members from (select distinct x from unnest(p_members) x
    where exists (select 1 from public.split_members sm where sm.group_id = p_group and sm.user_id = x)) s;
  n := coalesce(array_length(p_members, 1), 0);
  if n = 0 then raise exception 'no members'; end if;
  insert into public.split_bills (group_id, description, amount_cents, date) values (p_group, trim(p_description), p_amount_cents, coalesce(p_date, current_date)) returning id into bid;
  base := p_amount_cents / n; rest := p_amount_cents - base * n;
  foreach m in array p_members loop
    insert into public.split_shares (bill_id, user_id, share_cents, paid_at, marked_by)
    values (bid, m, base + case when i < rest then 1 else 0 end,
            case when p_creator_paid and m = auth.uid() then now() end,
            case when p_creator_paid and m = auth.uid() then auth.uid() end);
    i := i + 1;
  end loop;
  return bid;
end $$;

create or replace function public.delete_split_group(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_edit_split(p_group) then raise exception 'not allowed to delete this group'; end if;
  delete from public.split_groups where id = p_group; -- membros, convites, transações e partes saem em cascata
end $$;

drop policy if exists sb_delete on public.split_bills;
create policy sb_delete on public.split_bills for update to authenticated
  using (public.can_edit_split(group_id)) with check (public.can_edit_split(group_id));

do $$ declare f text; begin
  foreach f in array array['is_split_owner(uuid)','can_edit_split(uuid)','set_split_editors(uuid,uuid[])','update_split_group(uuid,text,text,text)','add_split_bill(uuid,text,bigint,date,uuid[],boolean)','delete_split_group(uuid)']
  loop execute 'revoke all on function public.' || f || ' from public, anon'; execute 'grant execute on function public.' || f || ' to authenticated'; end loop;
end $$;
