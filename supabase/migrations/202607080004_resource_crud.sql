-- CRUD transaccional y simple para salas/equipos/box agendables.
create or replace function public.save_location_resource(
  p_id uuid, p_branch uuid, p_service uuid, p_name text, p_active boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_org uuid;
  v_location uuid;
  v_id uuid;
begin
  if private.current_role() is distinct from 'admin' then raise exception 'Solo administradores pueden gestionar recursos'; end if;
  if length(trim(p_name)) = 0 then raise exception 'El nombre es obligatorio'; end if;
  select tenant_id, organization_id into v_tenant, v_org from public.locations
  where id = p_branch and kind = 'branch' and tenant_id = private.current_tenant();
  if v_tenant is null then raise exception 'Sucursal inexistente'; end if;
  if not exists (select 1 from public.healthcare_service_locations where location_id = p_branch and healthcare_service_id = p_service and tenant_id = v_tenant) then
    raise exception 'El servicio no está habilitado en la sucursal';
  end if;

  if p_id is null then
    insert into public.locations (tenant_id, organization_id, name, kind, parent_location_id, active)
    values (v_tenant, v_org, trim(p_name), 'room', p_branch, p_active) returning id into v_location;
    insert into public.schedulable_resources (tenant_id, organization_id, location_id, healthcare_service_id, kind, name, active)
    values (v_tenant, v_org, v_location, p_service, 'location', trim(p_name), p_active) returning id into v_id;
  else
    select id, location_id into v_id, v_location from public.schedulable_resources
    where id = p_id and tenant_id = v_tenant;
    if v_id is null then raise exception 'Recurso inexistente'; end if;
    update public.schedulable_resources set name = trim(p_name), healthcare_service_id = p_service, active = p_active where id = v_id;
    update public.locations set name = trim(p_name), parent_location_id = p_branch, active = p_active
    where id = v_location and kind = 'room';
  end if;
  return v_id;
end;
$$;

create or replace function public.delete_location_resource(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_location uuid;
  v_name text;
begin
  if private.current_role() is distinct from 'admin' then raise exception 'Solo administradores pueden eliminar recursos'; end if;
  if exists (select 1 from public.appointments where schedulable_resource_id = p_id and tenant_id = private.current_tenant()) then
    raise exception 'El recurso tiene citas: desactívalo para conservar el historial';
  end if;
  select location_id, name into v_location, v_name from public.schedulable_resources where id = p_id and tenant_id = private.current_tenant();
  if v_location is null then raise exception 'Recurso inexistente'; end if;
  delete from public.room_schedules where tenant_id = private.current_tenant() and room_label = v_name;
  delete from public.schedulable_resources where id = p_id and tenant_id = private.current_tenant();
  delete from public.locations l where l.id = v_location and l.kind = 'room'
    and not exists (select 1 from public.schedulable_resources r where r.location_id = l.id);
end;
$$;

revoke all on function public.save_location_resource(uuid, uuid, uuid, text, boolean) from public, anon;
revoke all on function public.delete_location_resource(uuid) from public, anon;
grant execute on function public.save_location_resource(uuid, uuid, uuid, text, boolean) to authenticated;
grant execute on function public.delete_location_resource(uuid) to authenticated;
