-- Capturas del visor como imágenes clave (CT/MR/PET-CT): una imagen puntual con anotaciones,
-- sin agregar series al estudio. Se guardan en el bucket privado "capturas";
-- report_key_images.instance_id lleva la ruta (contiene "/") o un ID de instancia Orthanc.
insert into storage.buckets (id, name, public) values ('capturas', 'capturas', false)
on conflict (id) do nothing;

drop policy if exists "report staff upload captures" on storage.objects;
drop policy if exists "clinical read captures" on storage.objects;
create policy "report staff upload captures" on storage.objects for insert to authenticated
with check (bucket_id = 'capturas' and (select private.current_role()) in ('admin', 'radiologist'));
create policy "clinical read captures" on storage.objects for select to authenticated
using (bucket_id = 'capturas');
