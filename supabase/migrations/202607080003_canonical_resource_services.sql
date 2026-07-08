-- Normaliza recursos y prestaciones al HealthcareService maestro del tenant.
with canonical as (
  select distinct on (tenant_id, name) id, tenant_id, name
  from public.healthcare_services
  where name in ('Imagenología', 'Laboratorio Clínico', 'Anatomía Patológica', 'Consultas')
  order by tenant_id, name, created_at
)
update public.schedulable_resources r set healthcare_service_id = c.id
from canonical c
where c.tenant_id = r.tenant_id and c.name = case
  when lower(r.name) like '%box 1%' then 'Laboratorio Clínico'
  when lower(r.name) like '%box 2%' then 'Consultas'
  else 'Imagenología'
end;

with canonical as (
  select distinct on (tenant_id, name) id, tenant_id, name
  from public.healthcare_services
  where name in ('Imagenología', 'Laboratorio Clínico', 'Anatomía Patológica', 'Consultas')
  order by tenant_id, name, created_at
)
delete from public.healthcare_service_locations sl
using public.healthcare_services s, canonical c
where sl.healthcare_service_id = s.id and s.tenant_id = c.tenant_id and s.name = c.name and s.id <> c.id;

insert into public.healthcare_service_locations (tenant_id, healthcare_service_id, location_id)
select distinct r.tenant_id, r.healthcare_service_id,
  case when l.kind = 'room' then l.parent_location_id else l.id end
from public.schedulable_resources r
join public.locations l on l.id = r.location_id
where r.healthcare_service_id is not null
  and (case when l.kind = 'room' then l.parent_location_id else l.id end) is not null
on conflict (healthcare_service_id, location_id) do nothing;

insert into public.resource_service_types (tenant_id, resource_id, service_type_id)
select r.tenant_id, r.id, st.id
from public.schedulable_resources r
join public.service_types st on st.tenant_id = r.tenant_id and st.healthcare_service_id = r.healthcare_service_id
where st.name like '[Prueba]%' and mod(hashtext(r.id::text || st.id::text)::bigint, 3) <> 0
on conflict (resource_id, service_type_id) do nothing;

insert into public.resource_service_types (tenant_id, resource_id, service_type_id)
select st.tenant_id, (
  select r.id from public.schedulable_resources r
  where r.tenant_id = st.tenant_id and r.healthcare_service_id = st.healthcare_service_id and r.active
  order by r.created_at limit 1
), st.id
from public.service_types st
where st.name like '[Prueba]%'
  and exists (select 1 from public.schedulable_resources r where r.tenant_id = st.tenant_id and r.healthcare_service_id = st.healthcare_service_id and r.active)
on conflict (resource_id, service_type_id) do nothing;
