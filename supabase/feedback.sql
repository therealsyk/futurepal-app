-- Feedback e relatórios de erros enviados a partir da app (Definições > Enviar feedback).
-- Como usar: Supabase > SQL Editor > colar TUDO isto > Run (depois de admin.sql).
-- Qualquer pessoa (com ou sem conta) pode ENVIAR; só o admin pode LER e marcar como tratado.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  email text check (email is null or length(email) <= 200),
  kind text not null check (kind in ('idea', 'bug', 'other')),
  message text not null check (length(message) between 3 and 4000),
  app_version text check (length(app_version) <= 30),
  platform text check (length(platform) <= 30),
  language text check (length(language) <= 10),
  status text not null default 'new' check (status in ('new', 'done'))
);

alter table public.feedback enable row level security;

drop policy if exists "feedback: enviar" on public.feedback;
drop policy if exists "feedback: admin lê" on public.feedback;
drop policy if exists "feedback: admin muda" on public.feedback;

-- Enviar: sem conta (user_id vazio) ou com a própria conta; o estado começa sempre como 'new'.
create policy "feedback: enviar" on public.feedback for insert to anon, authenticated
  with check ((user_id is null or user_id = auth.uid()) and status = 'new');
create policy "feedback: admin lê" on public.feedback for select to authenticated using (public.is_admin());
create policy "feedback: admin muda" on public.feedback for update to authenticated using (public.is_admin()) with check (public.is_admin());

grant insert on public.feedback to anon, authenticated;
grant select, update on public.feedback to authenticated;

notify pgrst, 'reload schema';
