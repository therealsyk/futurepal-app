-- FuturePal: contas do painel com NOME DE UTILIZADOR e senha (separadas das contas normais da app).
-- Corre UMA vez no Supabase > SQL Editor (depois de admin_team.sql).
-- Cada conta do painel é um utilizador do Supabase Auth com um email interno "<nome>@staff.futurepal.app"
-- (a pessoa só vê e escreve o nome de utilizador). O 2FA continua obrigatório no primeiro login.

create extension if not exists pgcrypto with schema extensions;

-- Cria (ou atualiza a senha e o cargo de) uma conta do painel. Uso interno.
create or replace function public._staff_upsert(p_username text, p_password text, p_role text)
returns uuid language plpgsql security definer set search_path = public, auth, extensions as $$
declare uid uuid; em text;
begin
  p_username := lower(trim(p_username));
  if p_username !~ '^[a-z0-9._-]{3,32}$' then raise exception 'invalid username'; end if;
  if length(coalesce(p_password, '')) < 10 then raise exception 'password too short'; end if;
  if p_role not in ('super', 'admin', 'moderator', 'support', 'finance', 'readonly') then raise exception 'invalid role'; end if;
  em := p_username || '@staff.futurepal.app';
  select id into uid from auth.users where email = em;
  if uid is null then
    uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', em, extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('username', p_username, 'staff', true),
      now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text, jsonb_build_object('sub', uid::text, 'email', em, 'email_verified', true), 'email', now(), now(), now());
  else
    update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now() where id = uid;
  end if;
  insert into public.admins (user_id, role) values (uid, p_role) on conflict (user_id) do update set role = excluded.role;
  return uid;
end $$;
revoke all on function public._staff_upsert(text, text, text) from public, anon, authenticated;

-- Pelo painel (só o super): criar conta com cargo e senha inicial
create or replace function public.admin_staff_create(p_username text, p_password text, p_role text)
returns void language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if not public.admin_can('team') then raise exception 'not allowed'; end if;
  if p_role = 'super' then raise exception 'invalid role'; end if;
  if exists (select 1 from auth.users where email = lower(trim(p_username)) || '@staff.futurepal.app') then raise exception 'username taken'; end if;
  uid := public._staff_upsert(p_username, p_password, p_role);
  perform public._audit('staff_create', lower(trim(p_username)), null, json_build_object('role', p_role)::jsonb, null);
end $$;

-- Pelo painel (só o super): definir uma senha nova (ex.: a pessoa esqueceu-se) e repor o 2FA
create or replace function public.admin_staff_reset(p_username text, p_password text)
returns void language plpgsql security definer set search_path = public, auth, extensions as $$
declare uid uuid; r text;
begin
  if not public.admin_can('team') then raise exception 'not allowed'; end if;
  select u.id, a.role into uid, r from auth.users u join public.admins a on a.user_id = u.id where u.email = lower(trim(p_username)) || '@staff.futurepal.app';
  if uid is null or uid = auth.uid() then raise exception 'not allowed'; end if;
  perform public._staff_upsert(p_username, p_password, r);
  delete from auth.mfa_factors where user_id = uid;  -- volta a configurar o 2FA no próximo login
  delete from auth.sessions where user_id = uid;
  perform public._audit('staff_reset', lower(trim(p_username)), null, null, null);
end $$;

-- Pelo painel (só o super): apagar a conta do painel por completo
create or replace function public.admin_staff_delete(p_username text)
returns void language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if not public.admin_can('team') then raise exception 'not allowed'; end if;
  select id into uid from auth.users where email = lower(trim(p_username)) || '@staff.futurepal.app';
  if uid is null or uid = auth.uid() then raise exception 'not allowed'; end if;
  if exists (select 1 from public.admins where user_id = uid and role = 'super') then raise exception 'not allowed'; end if;
  perform public._audit('staff_delete', lower(trim(p_username)), null, null, null);
  delete from auth.users where id = uid;
end $$;

-- Mudar o cargo de uma conta do painel
create or replace function public.admin_staff_role(p_username text, p_role text)
returns void language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if not public.admin_can('team') then raise exception 'not allowed'; end if;
  if p_role not in ('admin', 'moderator', 'support', 'finance', 'readonly') then raise exception 'invalid role'; end if;
  select id into uid from auth.users where email = lower(trim(p_username)) || '@staff.futurepal.app';
  if uid is null or uid = auth.uid() then raise exception 'not allowed'; end if;
  update public.admins set role = p_role where user_id = uid and role <> 'super';
  perform public._audit('staff_role', lower(trim(p_username)), null, json_build_object('role', p_role)::jsonb, null);
end $$;

-- Lista da equipa (contas do painel)
create or replace function public.admin_staff_list()
returns table (username text, role text, created_at timestamptz, last_sign_in_at timestamptz, has_2fa boolean)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.admin_can('team') then raise exception 'not allowed'; end if;
  return query select split_part(u.email, '@', 1)::text, a.role, u.created_at, u.last_sign_in_at,
    exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified')
    from public.admins a join auth.users u on u.id = a.user_id
    where u.email like '%@staff.futurepal.app'
    order by (a.role = 'super') desc, u.created_at;
end $$;

do $$ declare f text; begin
  foreach f in array array['admin_staff_create(text,text,text)', 'admin_staff_reset(text,text)', 'admin_staff_delete(text)', 'admin_staff_role(text,text)', 'admin_staff_list()']
  loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;

-- ============================================================================================
-- A TUA CONTA (super, acesso a tudo). Troca A_TUA_SENHA pela tua senha (mínimo 10 caracteres)
-- e corre só esta linha no SQL Editor:
--
-- select public._staff_upsert('adminrafael', 'A_TUA_SENHA', 'super');
-- ============================================================================================
