-- Ids únicos POR UTILIZADOR (e não globais).
-- A app usa ids fixos iguais para todos ('app-settings', 'acc-default', 'cat-…'). Com a chave primária só em "id",
-- o 2.º utilizador a sincronizar batia na linha do 1.º e a RLS recusava:
--   "new row violates row-level security policy (USING expression) for table settings".
-- Agora a chave é (user_id, id). A app (>= 0.2.13) faz upsert com onConflict 'user_id,id'.
-- Pode correr-se mais do que uma vez.
do $$
declare t text; pk text; cols text;
begin
  foreach t in array array['settings','categories','accounts','transactions','transfers','salaries','budgets','goals','recurrings','groups']
  loop
    select c.conname, string_agg(a.attname, ',' order by k.ord) into pk, cols
      from pg_constraint c
      cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
     where c.conrelid = ('public.' || t)::regclass and c.contype = 'p'
     group by c.conname;
    if cols is distinct from 'user_id,id' then
      if pk is not null then execute format('alter table public.%I drop constraint %I', t, pk); end if;
      execute format('alter table public.%I add primary key (user_id, id)', t);
    end if;
  end loop;
end $$;
