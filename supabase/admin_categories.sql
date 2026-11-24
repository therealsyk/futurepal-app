-- MyFuturePal: categorias criadas pelas pessoas (painel de admin).
-- Mostra quantas pessoas criaram categorias próprias e os nomes mais usados, sem dizer quem as criou.
-- Corre no Supabase > SQL Editor (pode correr-se mais do que uma vez).

create or replace function public.admin_custom_categories(max_rows int default 100)
returns json language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  if not public.admin_can('view') then raise exception 'not allowed'; end if;
  with own as (
    select user_id, trim(name) as name, created_at from public.categories
    where deleted_at is null and name_key is null and trim(coalesce(name, '')) <> ''
  ), names as (
    select lower(name) as k, min(name) as name, count(distinct user_id) as people, count(*) as n, max(created_at) as last_at
    from own group by lower(name)
  )
  select json_build_object(
    'people', (select count(distinct user_id) from own),
    'total', (select count(*) from own),
    'last_30d', (select count(*) from own where created_at > now() - interval '30 days'),
    'names', coalesce((select json_agg(json_build_object('name', x.name, 'people', x.people, 'n', x.n, 'last_at', x.last_at) order by x.people desc, x.n desc, x.name)
                       from (select * from names order by people desc, n desc, name limit greatest(1, least(max_rows, 500))) x), '[]'::json)
  ) into r;
  return r;
end $$;
revoke all on function public.admin_custom_categories(int) from public, anon;
grant execute on function public.admin_custom_categories(int) to authenticated;
