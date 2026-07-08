-- Catálogo maestro institucional + oferta por sucursal/recurso.
-- Reutiliza Location, HealthcareService, ServiceType y SchedulableResource.

alter table public.locations add column if not exists kind text;
alter table public.locations add column if not exists parent_location_id uuid references public.locations(id) on delete cascade;
update public.locations set kind = 'branch' where kind is null;
update public.locations l set kind = 'room'
where exists (
  select 1 from public.catalog_items c
  where c.tenant_id = l.tenant_id and c.category = 'sala' and c.label = l.name
);
update public.locations room set parent_location_id = (
  select branch.id from public.locations branch
  where branch.tenant_id = room.tenant_id and branch.kind = 'branch'
  order by branch.created_at limit 1
)
where room.kind = 'room' and room.parent_location_id is null;
alter table public.locations alter column kind set default 'branch';
alter table public.locations alter column kind set not null;
alter table public.locations add constraint locations_kind_check check (kind in ('branch', 'room'));

create table public.healthcare_service_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  healthcare_service_id uuid not null references public.healthcare_services(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  unique (healthcare_service_id, location_id)
);
create index healthcare_service_locations_location_idx on public.healthcare_service_locations (location_id, healthcare_service_id);
alter table public.healthcare_service_locations enable row level security;
create policy "tenant reads healthcare service locations" on public.healthcare_service_locations for select to authenticated
  using (tenant_id = (select private.current_tenant()));
create policy "admins manage healthcare service locations" on public.healthcare_service_locations for all to authenticated
  using (tenant_id = (select private.current_tenant()) and (select private.current_role()) = 'admin')
  with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) = 'admin');

alter table public.service_types add column if not exists healthcare_service_id uuid references public.healthcare_services(id) on delete set null;
create index service_types_service_idx on public.service_types (healthcare_service_id, active, name);

-- Cuatro áreas para probar que el catálogo no mezcla dominios clínicos.
insert into public.healthcare_services (tenant_id, organization_id, name, specialty)
select o.tenant_id, o.id, v.name, v.specialty
from public.organizations o
cross join (values
  ('Imagenología', 'Radiología'),
  ('Laboratorio Clínico', 'Laboratorio'),
  ('Anatomía Patológica', 'Anatomía Patológica'),
  ('Consultas', 'Medicina ambulatoria')
) as v(name, specialty)
on conflict (tenant_id, organization_id, name) do nothing;

-- Imagenología y Consultas en todas las sucursales; las otras áreas quedan distribuidas
-- para comprobar que cada sede puede tener una oferta diferente.
with branches as (
  select l.*, row_number() over (partition by l.tenant_id order by l.created_at) as rn
  from public.locations l where l.kind = 'branch'
), services as (
  select s.* from public.healthcare_services s
  where s.name in ('Imagenología', 'Laboratorio Clínico', 'Anatomía Patológica', 'Consultas')
)
insert into public.healthcare_service_locations (tenant_id, healthcare_service_id, location_id)
select b.tenant_id, s.id, b.id
from branches b join services s on s.tenant_id = b.tenant_id and s.organization_id = b.organization_id
where s.name in ('Imagenología', 'Consultas')
   or (s.name = 'Laboratorio Clínico' and mod(b.rn, 2) = 1)
   or (s.name = 'Anatomía Patológica' and b.rn = 1)
on conflict (healthcare_service_id, location_id) do nothing;

-- 50 prestaciones claramente marcadas como datos de prueba.
with test_services(area, code, name, duration_min) as (values
  ('Imagenología','TST-IMG-001','[Prueba] Ecografía abdominal',30),
  ('Imagenología','TST-IMG-002','[Prueba] Radiografía de tórax',15),
  ('Imagenología','TST-IMG-003','[Prueba] TC cerebral sin contraste',20),
  ('Imagenología','TST-IMG-004','[Prueba] RM cerebral con contraste',45),
  ('Imagenología','TST-IMG-005','[Prueba] Mamografía bilateral',20),
  ('Imagenología','TST-IMG-006','[Prueba] AngioTC de aorta',40),
  ('Imagenología','TST-IMG-007','[Prueba] Doppler carotídeo',30),
  ('Imagenología','TST-IMG-008','[Prueba] Ecografía tiroidea',20),
  ('Imagenología','TST-IMG-009','[Prueba] Radiografía de pelvis',15),
  ('Imagenología','TST-IMG-010','[Prueba] TC abdomen y pelvis',30),
  ('Imagenología','TST-IMG-011','[Prueba] RM columna lumbar',40),
  ('Imagenología','TST-IMG-012','[Prueba] Densitometría ósea',20),
  ('Imagenología','TST-IMG-013','[Prueba] Ecografía obstétrica',30),
  ('Imagenología','TST-IMG-014','[Prueba] UroTC',35),
  ('Imagenología','TST-IMG-015','[Prueba] Radiografía de columna',20),
  ('Laboratorio Clínico','TST-LAB-001','[Prueba] Hemograma completo',10),
  ('Laboratorio Clínico','TST-LAB-002','[Prueba] Perfil bioquímico',10),
  ('Laboratorio Clínico','TST-LAB-003','[Prueba] Glicemia',10),
  ('Laboratorio Clínico','TST-LAB-004','[Prueba] Hemoglobina glicosilada',10),
  ('Laboratorio Clínico','TST-LAB-005','[Prueba] Creatinina plasmática',10),
  ('Laboratorio Clínico','TST-LAB-006','[Prueba] Perfil lipídico',10),
  ('Laboratorio Clínico','TST-LAB-007','[Prueba] TSH',10),
  ('Laboratorio Clínico','TST-LAB-008','[Prueba] T4 libre',10),
  ('Laboratorio Clínico','TST-LAB-009','[Prueba] Orina completa',10),
  ('Laboratorio Clínico','TST-LAB-010','[Prueba] Urocultivo',10),
  ('Laboratorio Clínico','TST-LAB-011','[Prueba] Proteína C reactiva',10),
  ('Laboratorio Clínico','TST-LAB-012','[Prueba] Electrolitos plasmáticos',10),
  ('Laboratorio Clínico','TST-LAB-013','[Prueba] Pruebas hepáticas',10),
  ('Laboratorio Clínico','TST-LAB-014','[Prueba] Perfil de coagulación',10),
  ('Laboratorio Clínico','TST-LAB-015','[Prueba] Vitamina D',10),
  ('Anatomía Patológica','TST-APA-001','[Prueba] Biopsia gástrica',30),
  ('Anatomía Patológica','TST-APA-002','[Prueba] Biopsia de colon',30),
  ('Anatomía Patológica','TST-APA-003','[Prueba] Biopsia de piel',30),
  ('Anatomía Patológica','TST-APA-004','[Prueba] Biopsia mamaria',30),
  ('Anatomía Patológica','TST-APA-005','[Prueba] Biopsia prostática',30),
  ('Anatomía Patológica','TST-APA-006','[Prueba] Citología cervical',20),
  ('Anatomía Patológica','TST-APA-007','[Prueba] Citología de líquidos',20),
  ('Anatomía Patológica','TST-APA-008','[Prueba] Pieza quirúrgica',45),
  ('Anatomía Patológica','TST-APA-009','[Prueba] Inmunohistoquímica',40),
  ('Anatomía Patológica','TST-APA-010','[Prueba] Estudio molecular',45),
  ('Consultas','TST-CON-001','[Prueba] Consulta medicina general',30),
  ('Consultas','TST-CON-002','[Prueba] Consulta medicina interna',30),
  ('Consultas','TST-CON-003','[Prueba] Consulta pediatría',30),
  ('Consultas','TST-CON-004','[Prueba] Consulta ginecología',30),
  ('Consultas','TST-CON-005','[Prueba] Consulta traumatología',30),
  ('Consultas','TST-CON-006','[Prueba] Consulta neurología',30),
  ('Consultas','TST-CON-007','[Prueba] Consulta cardiología',30),
  ('Consultas','TST-CON-008','[Prueba] Consulta gastroenterología',30),
  ('Consultas','TST-CON-009','[Prueba] Consulta endocrinología',30),
  ('Consultas','TST-CON-010','[Prueba] Consulta urología',30)
), canonical_services as (
  select distinct on (tenant_id, name) id, tenant_id, name
  from public.healthcare_services
  where name in ('Imagenología', 'Laboratorio Clínico', 'Anatomía Patológica', 'Consultas')
  order by tenant_id, name, created_at
)
insert into public.service_types (tenant_id, healthcare_service_id, code, name, duration_min)
select s.tenant_id, s.id, t.code, t.name, t.duration_min
from canonical_services s join test_services t on t.area = s.name
on conflict (tenant_id, name) do update set
  healthcare_service_id = excluded.healthcare_service_id,
  code = excluded.code,
  duration_min = excluded.duration_min;

-- Conserva prestaciones previas dentro de un área, sin duplicarlas.
update public.service_types st set healthcare_service_id = s.id
from (
  select distinct on (tenant_id) id, tenant_id
  from public.healthcare_services where name = 'Imagenología'
  order by tenant_id, created_at
) s
where st.healthcare_service_id is null and s.tenant_id = st.tenant_id;

-- Clasificación inicial de los recursos migrados; luego puede corregirse desde Configuración.
update public.schedulable_resources r set healthcare_service_id = s.id
from public.healthcare_services s
where r.healthcare_service_id is null and s.tenant_id = r.tenant_id and s.organization_id = r.organization_id
  and s.name = case
    when lower(r.name) like '%box 1%' then 'Laboratorio Clínico'
    when lower(r.name) like '%box 2%' then 'Consultas'
    else 'Imagenología'
  end;

-- Asegura que el servicio del recurso esté habilitado en su sucursal.
insert into public.healthcare_service_locations (tenant_id, healthcare_service_id, location_id)
select distinct r.tenant_id, r.healthcare_service_id,
  case when l.kind = 'room' then l.parent_location_id else l.id end
from public.schedulable_resources r
join public.locations l on l.id = r.location_id
where r.healthcare_service_id is not null
  and (case when l.kind = 'room' then l.parent_location_id else l.id end) is not null
on conflict (healthcare_service_id, location_id) do nothing;

-- Distribución determinista: cada recurso recibe cerca de 2/3 de las prestaciones de su área.
insert into public.resource_service_types (tenant_id, resource_id, service_type_id)
select r.tenant_id, r.id, st.id
from public.schedulable_resources r
join public.service_types st on st.tenant_id = r.tenant_id and st.healthcare_service_id = r.healthcare_service_id
where st.name like '[Prueba]%' and mod(hashtext(r.id::text || st.id::text)::bigint, 3) <> 0
on conflict (resource_id, service_type_id) do nothing;

-- Ninguna prestación de prueba queda huérfana si existe al menos un recurso del área.
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

create or replace function public.available_branch_services(p_branch uuid)
returns table(id uuid, name text)
language sql stable set search_path = '' as $$
  select s.id, s.name
  from public.healthcare_service_locations sl
  join public.healthcare_services s on s.id = sl.healthcare_service_id
  where sl.location_id = p_branch and sl.tenant_id = private.current_tenant() and s.active
  order by s.name;
$$;

create or replace function public.search_available_service_types(p_branch uuid, p_service uuid, p_term text default '')
returns table(id uuid, code text, name text, duration_min integer, healthcare_service_id uuid)
language sql stable set search_path = '' as $$
  select distinct st.id, st.code, st.name, st.duration_min, st.healthcare_service_id
  from public.service_types st
  join public.resource_service_types rst on rst.service_type_id = st.id
  join public.schedulable_resources r on r.id = rst.resource_id and r.active
  join public.locations l on l.id = r.location_id
  where st.tenant_id = private.current_tenant() and st.active
    and st.healthcare_service_id = p_service
    and (case when l.kind = 'room' then l.parent_location_id else l.id end) = p_branch
    and (length(trim(p_term)) < 2 or st.name ilike '%' || trim(p_term) || '%' or st.code ilike '%' || trim(p_term) || '%')
  order by st.name
  limit 20;
$$;

create or replace function public.available_branch_resources(p_branch uuid, p_service_type uuid)
returns table(id uuid, name text, kind public.schedulable_resource_kind)
language sql stable set search_path = '' as $$
  select distinct r.id, r.name, r.kind
  from public.schedulable_resources r
  join public.resource_service_types rst on rst.resource_id = r.id and rst.service_type_id = p_service_type
  join public.locations l on l.id = r.location_id
  where r.tenant_id = private.current_tenant() and r.active
    and (case when l.kind = 'room' then l.parent_location_id else l.id end) = p_branch
  order by r.name;
$$;

create or replace function public.search_master_service_types(p_service uuid, p_term text default '')
returns table(id uuid, code text, name text, duration_min integer, active boolean)
language sql stable set search_path = '' as $$
  select st.id, st.code, st.name, st.duration_min, st.active
  from public.service_types st
  where st.tenant_id = private.current_tenant()
    and (p_service is null or st.healthcare_service_id = p_service)
    and (length(trim(p_term)) < 2 or st.name ilike '%' || trim(p_term) || '%' or st.code ilike '%' || trim(p_term) || '%')
  order by st.name
  limit 50;
$$;

revoke all on function public.available_branch_services(uuid) from public, anon;
revoke all on function public.search_available_service_types(uuid, uuid, text) from public, anon;
revoke all on function public.available_branch_resources(uuid, uuid) from public, anon;
revoke all on function public.search_master_service_types(uuid, text) from public, anon;
grant execute on function public.available_branch_services(uuid) to authenticated;
grant execute on function public.search_available_service_types(uuid, uuid, text) to authenticated;
grant execute on function public.available_branch_resources(uuid, uuid) to authenticated;
grant execute on function public.search_master_service_types(uuid, text) to authenticated;
