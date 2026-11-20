-- Histórico das entradas em cada meta (para a previsão aprender o ritmo de poupança).
-- Correr ANTES de instalar a versão que traz isto (senão a sincronização das metas falha).
alter table public.goals add column if not exists contributions jsonb;

-- Transferências recorrentes entre contas (ex.: 500 € para a poupança todos os meses)
alter table public.recurrings add column if not exists to_account_id text;
