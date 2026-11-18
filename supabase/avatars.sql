-- Fotos de perfil: bucket público "avatars"; cada pessoa só mexe na sua pasta (avatars/<user id>/...).
-- Como usar: Supabase > SQL Editor > colar TUDO isto > Run.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars: ver" on storage.objects;
drop policy if exists "avatars: enviar a minha" on storage.objects;
drop policy if exists "avatars: mudar a minha" on storage.objects;
drop policy if exists "avatars: apagar a minha" on storage.objects;

create policy "avatars: ver" on storage.objects for select
  using (bucket_id = 'avatars');
create policy "avatars: enviar a minha" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: mudar a minha" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: apagar a minha" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
