-- Foto própria de cada grupo (para aparecer em todos os aparelhos da pessoa).
-- Correr uma vez no Supabase (SQL Editor). Sem isto a app funciona, mas a foto fica só no aparelho onde foi escolhida.
alter table public.groups add column if not exists image text;
