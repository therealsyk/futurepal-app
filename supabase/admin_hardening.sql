-- FuturePal: reforço de segurança do painel de administração. Corre UMA vez no Supabase > SQL Editor
-- (depois de admin_phase1.sql).
--
-- 1. is_admin() passa a exigir o 2FA (quem o ativou tem de entrar com o código) e só conta os papéis
--    'super' e 'admin'. Assim TODAS as funções antigas (estatísticas, apagar conta, versões, aviso…)
--    ficam também protegidas pelo 2FA e não podem ser usadas por papéis menores (suporte, só leitura).
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and role in ('super', 'admin'))
    and (not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
         or coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2');
$$;

-- 2. Tickets (feedback): ler e mudar só com permissão de tickets (e 2FA, via admin_can).
drop policy if exists "feedback: admin lê" on public.feedback;
drop policy if exists "feedback: admin muda" on public.feedback;
create policy "feedback: admin lê" on public.feedback for select to authenticated using (public.admin_can('tickets'));
create policy "feedback: admin muda" on public.feedback for update to authenticated using (public.admin_can('tickets')) with check (public.admin_can('tickets'));

-- 3. Ninguém pode tornar-se administrador pela app: a tabela admins não tem políticas (só o SQL Editor).
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;
revoke all on public.admin_audit, public.plan_history from anon, authenticated;

-- 4. Confirma quem é administrador (deve aparecer só o teu email):
select u.email, a.role, a.created_at from public.admins a join auth.users u on u.id = a.user_id;
