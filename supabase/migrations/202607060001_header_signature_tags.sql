-- Encabezado de informe parametrizable por institución (variables {{paciente}}, {{medico}}, etc.)
alter table public.tenants add column if not exists report_header text not null default '';

-- Firma digital (imagen) por usuario; guarda la RUTA dentro del bucket privado "firmas"
alter table public.profiles add column if not exists signature_url text not null default '';

-- Los cambios de usuarios quedan auditados (fecha, actor y qué cambió)
drop trigger if exists audit_profiles on public.profiles;
create trigger audit_profiles after insert or update or delete on public.profiles
for each row execute function private.audit_change();

insert into storage.buckets (id, name, public) values ('firmas', 'firmas', false)
on conflict (id) do nothing;

drop policy if exists "admins upload signatures" on storage.objects;
drop policy if exists "admins replace signatures" on storage.objects;
drop policy if exists "clinical read signatures" on storage.objects;
create policy "admins upload signatures" on storage.objects for insert to authenticated
with check (bucket_id = 'firmas' and (select private.current_role()) = 'admin');
create policy "admins replace signatures" on storage.objects for update to authenticated
using (bucket_id = 'firmas' and (select private.current_role()) = 'admin');
create policy "clinical read signatures" on storage.objects for select to authenticated
using (bucket_id = 'firmas');
