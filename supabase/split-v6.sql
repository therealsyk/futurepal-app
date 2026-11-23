-- Grupos partilhados v6: o criador pode "concluir" as despesas de um grupo (ex.: acabaram as férias).
-- Depois de concluído não se adicionam mais despesas; fica "à espera de pagamentos" até toda a gente pagar
-- e depois aparece como concluído, mas continua visível para todos.
-- Correr no SQL Editor do Supabase depois do split-v5.sql.

alter table public.split_groups add column if not exists closed_at timestamptz;

create or replace function public.close_split_group(p_group uuid, p_closed boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_split_owner(p_group) then raise exception 'only the group owner can close it'; end if;
  update public.split_groups set closed_at = case when p_closed then coalesce(closed_at, now()) end where id = p_group;
end $$;

-- grupo concluído: não entram despesas novas (nem por fora do add_split_bill)
create or replace function public.split_bill_open_group()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.split_groups where id = new.group_id and closed_at is not null) then
    raise exception 'this group is closed';
  end if;
  return new;
end $$;
drop trigger if exists split_bill_open_group on public.split_bills;
create trigger split_bill_open_group before insert on public.split_bills for each row execute function public.split_bill_open_group();

revoke all on function public.close_split_group(uuid, boolean) from public, anon;
grant execute on function public.close_split_group(uuid, boolean) to authenticated;
