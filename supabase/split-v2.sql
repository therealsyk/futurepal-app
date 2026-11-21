-- Divisão de contas v2: quem aceita um convite entra logo nas contas criadas depois desse convite,
-- e a conta é dividida outra vez em partes iguais (quem já tinha pago continua marcado como pago).
-- Correr uma vez no Supabase (SQL Editor), depois de split.sql.

create or replace function public.answer_split_invite(p_invite uuid, p_accept boolean, p_display_name text)
returns void language plpgsql security definer set search_path = public as $$
declare gid uuid; inv_at timestamptz; b record; s record; n int; base bigint; rest bigint; i int;
begin
  select mi.group_id, mi.created_at into gid, inv_at from public.my_split_invites() mi where mi.id = p_invite;
  if gid is null then raise exception 'invite not found'; end if;
  update public.split_invites set status = case when p_accept then 'accepted' else 'declined' end where id = p_invite;
  if not p_accept then return; end if;
  insert into public.split_members (group_id, user_id, display_name) values (gid, auth.uid(), trim(p_display_name))
  on conflict do nothing;
  for b in select sb.id, sb.amount_cents from public.split_bills sb
           where sb.group_id = gid and sb.deleted_at is null and sb.created_at >= inv_at
             and not exists (select 1 from public.split_shares x where x.bill_id = sb.id and x.user_id = auth.uid())
  loop
    insert into public.split_shares (bill_id, user_id, share_cents) values (b.id, auth.uid(), 0);
    select count(*) into n from public.split_shares where bill_id = b.id;
    base := b.amount_cents / n; rest := b.amount_cents - base * n; i := 0;
    for s in select ss.user_id from public.split_shares ss where ss.bill_id = b.id order by ss.user_id loop
      update public.split_shares set share_cents = base + case when i < rest then 1 else 0 end
      where bill_id = b.id and user_id = s.user_id;
      i := i + 1;
    end loop;
  end loop;
end $$;

revoke all on function public.answer_split_invite(uuid,boolean,text) from public, anon;
grant execute on function public.answer_split_invite(uuid,boolean,text) to authenticated;
