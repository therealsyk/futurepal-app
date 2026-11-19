-- FuturePal: correção de permissões (revisão de 19/11/2026). Corre UMA vez no Supabase > SQL Editor.
-- Problema: no Postgres, as funções novas ficam executáveis pelo grupo PUBLIC (toda a gente, incluindo
-- quem não tem sessão). Tirar a permissão só a "anon"/"authenticated" não chega: herdam-na do PUBLIC.
-- Isto deixava qualquer pessoa chamar ai_add_usage (mexer nas quotas e no teto de custos da IA).

-- 1. Assistente: só a Edge Function (service role) pode chamar.
revoke all on function public.ai_month_cost(text) from public, anon, authenticated;
revoke all on function public.ai_add_usage(uuid, text, int, int, bigint) from public, anon, authenticated;

-- 2. Família: só quem tem sessão.
revoke all on function public.create_household(text, text, text), public.join_household(text, text),
  public.leave_household(uuid), public.new_invite_code(uuid) from public, anon;
grant execute on function public.create_household(text, text, text), public.join_household(text, text),
  public.leave_household(uuid), public.new_invite_code(uuid) to authenticated;

-- 3. Despesas partilhadas: só quem tem sessão.
do $$ declare f text; begin
  foreach f in array array['my_contact()','create_split_group(text,text,text)','invite_to_split(uuid,text,text)','my_split_invites()',
    'answer_split_invite(uuid,boolean,text)','add_split_bill(uuid,text,bigint,date,uuid[],boolean)','set_split_paid(uuid,uuid,boolean)','leave_split_group(uuid)']
  loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;

-- 4. Para o futuro: funções novas deixam de ficar abertas ao PUBLIC por defeito.
alter default privileges in schema public revoke execute on functions from public;
