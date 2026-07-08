-- En los selectores muestra primero los servicios que ya tienen recursos en la sucursal.
create or replace function public.available_branch_services(p_branch uuid)
returns table(id uuid, name text)
language sql stable set search_path = '' as $$
  select s.id, s.name
  from public.healthcare_service_locations sl
  join public.healthcare_services s on s.id = sl.healthcare_service_id
  where sl.location_id = p_branch and sl.tenant_id = private.current_tenant() and s.active
  order by exists (
    select 1 from public.schedulable_resources r
    join public.locations l on l.id = r.location_id
    where r.tenant_id = sl.tenant_id and r.healthcare_service_id = s.id and r.active
      and (case when l.kind = 'room' then l.parent_location_id else l.id end) = p_branch
  ) desc, s.name;
$$;

revoke all on function public.available_branch_services(uuid) from public, anon;
grant execute on function public.available_branch_services(uuid) to authenticated;
