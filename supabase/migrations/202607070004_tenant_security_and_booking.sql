-- Cierra fugas entre instituciones en auditoría/storage y evita doble reserva concurrente.

-- La validación de solapamiento en React no cubre dos usuarios guardando a la vez.
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
alter table public.appointments add constraint appointments_no_room_overlap
exclude using gist (
  tenant_id with =,
  location_name with =,
  tsrange(appointment_date + start_time, appointment_date + end_time, '[)') with &&
) where (status <> 'cancelled');

-- Cada evento de auditoría queda asociado a su institución; registros históricos
-- sin fila ni tenant recuperable quedan ocultos en vez de exponerse globalmente.
alter table public.audit_log add column if not exists tenant_id uuid references public.tenants(id);
update public.audit_log
set tenant_id = (details ->> 'tenant_id')::uuid
where tenant_id is null and details ->> 'tenant_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
update public.audit_log a set tenant_id = coalesce(
  (select tenant_id from public.patients where id = a.row_id),
  (select tenant_id from public.appointments where id = a.row_id),
  (select tenant_id from public.imaging_studies where id = a.row_id),
  (select tenant_id from public.radiology_reports where id = a.row_id),
  (select tenant_id from public.report_templates where id = a.row_id),
  (select tenant_id from public.report_communications where id = a.row_id),
  (select tenant_id from public.report_addenda where id = a.row_id),
  (select tenant_id from public.report_follow_ups where id = a.row_id),
  (select tenant_id from public.report_key_images where id = a.row_id),
  (select tenant_id from public.report_reopenings where id = a.row_id),
  (select tenant_id from public.profiles where id = a.row_id)
) where tenant_id is null;
create index if not exists audit_log_tenant_idx on public.audit_log (tenant_id, changed_at desc);

create or replace function private.audit_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  diff jsonb;
  row_data jsonb;
  audit_tenant uuid;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  audit_tenant := nullif(row_data ->> 'tenant_id', '')::uuid;
  if audit_tenant is null then audit_tenant := private.current_tenant(); end if;
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(entry.key, entry.value) into diff
    from jsonb_each(to_jsonb(new)) as entry
    where to_jsonb(old) -> entry.key is distinct from entry.value;
  elsif tg_op = 'INSERT' then
    diff := to_jsonb(new);
  end if;
  insert into public.audit_log (tenant_id, actor_id, table_name, row_id, action, details)
  values (audit_tenant, (select auth.uid()), tg_table_name, coalesce(new.id, old.id), tg_op, diff);
  return coalesce(new, old);
end;
$$;
revoke all on function private.audit_change() from public, anon, authenticated;

drop policy if exists "admins read audit" on public.audit_log;
create policy "admins read tenant audit" on public.audit_log for select to authenticated
using (tenant_id = (select private.current_tenant()) and (select private.current_role()) = 'admin');

-- Las rutas empiezan con appointmentId, userId o tenantId. Esta función evita
-- repetir joins y los ejecuta sin quedar limitada por las RLS de la tabla dueña.
create or replace function private.storage_object_in_current_tenant(object_name text, owner_kind text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select case owner_kind
    when 'appointment' then exists (
      select 1 from public.appointments a
      where a.id::text = (storage.foldername(object_name))[1]
        and a.tenant_id = private.current_tenant()
    )
    when 'profile' then exists (
      select 1 from public.profiles p
      where p.id::text = (storage.foldername(object_name))[1]
        and p.tenant_id = private.current_tenant()
    )
    when 'tenant' then (storage.foldername(object_name))[1] = private.current_tenant()::text
    else false
  end
$$;
revoke all on function private.storage_object_in_current_tenant(text, text) from public, anon;
grant execute on function private.storage_object_in_current_tenant(text, text) to authenticated;

drop policy if exists "clinical users read orders" on storage.objects;
drop policy if exists "staff upload orders" on storage.objects;
create policy "clinical users read tenant orders" on storage.objects for select to authenticated
using (bucket_id = 'ordenes' and private.storage_object_in_current_tenant(name, 'appointment'));
create policy "staff insert tenant orders" on storage.objects for insert to authenticated
with check (bucket_id = 'ordenes' and private.storage_object_in_current_tenant(name, 'appointment') and private.current_role() in ('admin', 'operator', 'radiologist'));
create policy "staff update tenant orders" on storage.objects for update to authenticated
using (bucket_id = 'ordenes' and private.storage_object_in_current_tenant(name, 'appointment') and private.current_role() in ('admin', 'operator', 'radiologist'))
with check (bucket_id = 'ordenes' and private.storage_object_in_current_tenant(name, 'appointment') and private.current_role() in ('admin', 'operator', 'radiologist'));
create policy "staff delete tenant orders" on storage.objects for delete to authenticated
using (bucket_id = 'ordenes' and private.storage_object_in_current_tenant(name, 'appointment') and private.current_role() in ('admin', 'operator', 'radiologist'));

drop policy if exists "admins upload branding" on storage.objects;
drop policy if exists "admins replace branding" on storage.objects;
create policy "admins insert tenant branding" on storage.objects for insert to authenticated
with check (bucket_id = 'branding' and private.storage_object_in_current_tenant(name, 'tenant') and private.current_role() = 'admin');
create policy "admins update tenant branding" on storage.objects for update to authenticated
using (bucket_id = 'branding' and private.storage_object_in_current_tenant(name, 'tenant') and private.current_role() = 'admin')
with check (bucket_id = 'branding' and private.storage_object_in_current_tenant(name, 'tenant') and private.current_role() = 'admin');
create policy "admins delete tenant branding" on storage.objects for delete to authenticated
using (bucket_id = 'branding' and private.storage_object_in_current_tenant(name, 'tenant') and private.current_role() = 'admin');

drop policy if exists "admins upload signatures" on storage.objects;
drop policy if exists "admins replace signatures" on storage.objects;
drop policy if exists "clinical read signatures" on storage.objects;
create policy "clinical read tenant signatures" on storage.objects for select to authenticated
using (bucket_id = 'firmas' and private.storage_object_in_current_tenant(name, 'profile'));
create policy "admins insert tenant signatures" on storage.objects for insert to authenticated
with check (bucket_id = 'firmas' and private.storage_object_in_current_tenant(name, 'profile') and private.current_role() = 'admin');
create policy "admins update tenant signatures" on storage.objects for update to authenticated
using (bucket_id = 'firmas' and private.storage_object_in_current_tenant(name, 'profile') and private.current_role() = 'admin')
with check (bucket_id = 'firmas' and private.storage_object_in_current_tenant(name, 'profile') and private.current_role() = 'admin');
create policy "admins delete tenant signatures" on storage.objects for delete to authenticated
using (bucket_id = 'firmas' and private.storage_object_in_current_tenant(name, 'profile') and private.current_role() = 'admin');

drop policy if exists "report staff upload captures" on storage.objects;
drop policy if exists "clinical read captures" on storage.objects;
create policy "clinical read tenant captures" on storage.objects for select to authenticated
using (bucket_id = 'capturas' and private.storage_object_in_current_tenant(name, 'appointment'));
create policy "report staff insert tenant captures" on storage.objects for insert to authenticated
with check (bucket_id = 'capturas' and private.storage_object_in_current_tenant(name, 'appointment') and private.current_role() in ('admin', 'radiologist'));
create policy "report staff update tenant captures" on storage.objects for update to authenticated
using (bucket_id = 'capturas' and private.storage_object_in_current_tenant(name, 'appointment') and private.current_role() in ('admin', 'radiologist'))
with check (bucket_id = 'capturas' and private.storage_object_in_current_tenant(name, 'appointment') and private.current_role() in ('admin', 'radiologist'));
create policy "report staff delete tenant captures" on storage.objects for delete to authenticated
using (bucket_id = 'capturas' and private.storage_object_in_current_tenant(name, 'appointment') and private.current_role() in ('admin', 'radiologist'));

-- Reabrir/eliminar eran varias consultas desde el navegador: un fallo intermedio
-- podía dejar el motivo registrado sin ejecutar la acción o residuos de adendas.
create or replace function public.reopen_report(p_appointment_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare report_tenant uuid;
begin
  if private.current_role() is distinct from 'admin' then raise exception 'Solo administradores pueden reabrir informes'; end if;
  if length(trim(p_reason)) = 0 then raise exception 'El motivo es obligatorio'; end if;
  select tenant_id into report_tenant from public.appointments
  where id = p_appointment_id and tenant_id = private.current_tenant();
  if report_tenant is null then raise exception 'Cita inexistente'; end if;
  insert into public.report_reopenings (appointment_id, tenant_id, action, reason)
  values (p_appointment_id, report_tenant, 'reopen', trim(p_reason));
  update public.radiology_reports set status = 'draft'
  where appointment_id = p_appointment_id and tenant_id = report_tenant and status = 'final';
  if not found then raise exception 'Informe definitivo inexistente'; end if;
end;
$$;

create or replace function public.delete_report(p_appointment_id uuid, p_reason text)
returns text[] language plpgsql security definer set search_path = ''
as $$
declare
  report_tenant uuid;
  capture_paths text[];
begin
  if private.current_role() is distinct from 'admin' then raise exception 'Solo administradores pueden eliminar informes'; end if;
  if length(trim(p_reason)) = 0 then raise exception 'El motivo es obligatorio'; end if;
  select tenant_id into report_tenant from public.appointments
  where id = p_appointment_id and tenant_id = private.current_tenant();
  if report_tenant is null then raise exception 'Cita inexistente'; end if;
  select coalesce(array_agg(instance_id) filter (where position('/' in instance_id) > 0), '{}')
  into capture_paths from public.report_key_images
  where appointment_id = p_appointment_id and tenant_id = report_tenant;
  insert into public.report_reopenings (appointment_id, tenant_id, action, reason)
  values (p_appointment_id, report_tenant, 'delete', trim(p_reason));
  delete from public.radiology_reports
  where appointment_id = p_appointment_id and tenant_id = report_tenant;
  if not found then raise exception 'Informe inexistente'; end if;
  delete from public.report_key_images where appointment_id = p_appointment_id and tenant_id = report_tenant;
  delete from public.report_addenda where appointment_id = p_appointment_id and tenant_id = report_tenant;
  return capture_paths;
end;
$$;

revoke all on function public.reopen_report(uuid, text) from public, anon;
revoke all on function public.delete_report(uuid, text) from public, anon;
grant execute on function public.reopen_report(uuid, text) to authenticated;
grant execute on function public.delete_report(uuid, text) to authenticated;
