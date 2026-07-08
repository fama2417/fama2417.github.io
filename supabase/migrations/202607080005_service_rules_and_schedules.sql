-- Reglas propias de la prestación y horarios para recursos o profesionales.
alter table public.service_types
  add column category text not null default 'procedure',
  add column modality text not null default '',
  add column practitioner_requirement text not null default 'optional',
  add constraint service_types_category_check check (category in ('consultation','imaging','laboratory','pathology','procedure')),
  add constraint service_types_practitioner_check check (practitioner_requirement in ('none','optional','required'));

update public.service_types st set
  category = case s.name
    when 'Consultas' then 'consultation'
    when 'Imagenología' then 'imaging'
    when 'Laboratorio Clínico' then 'laboratory'
    when 'Anatomía Patológica' then 'pathology'
    else 'procedure' end,
  practitioner_requirement = case when s.name = 'Consultas' then 'required' else 'none' end,
  modality = case
    when st.name ilike '%resonancia%' or st.name ilike '% RM %' or st.name ilike 'RM %' then 'MR'
    when st.name ilike '%tomografía%' or st.name ilike '% TC %' or st.name ilike 'TC %' or st.name ilike '%AngioTC%' or st.name ilike '%UroTC%' then 'CT'
    when st.name ilike '%ecografía%' or st.name ilike '%doppler%' then 'US'
    when st.name ilike '%radiografía%' then 'DX'
    when st.name ilike '%mamografía%' then 'MG'
    else '' end
from public.healthcare_services s where s.id = st.healthcare_service_id;

alter table public.appointments
  add column service_category text not null default 'procedure',
  add column practitioner_requirement text not null default 'optional';
update public.appointments set service_category = case
  when service = 'Consultas' then 'consultation'
  when service = 'Imagenología' then 'imaging'
  when service = 'Laboratorio Clínico' then 'laboratory'
  when service = 'Anatomía Patológica' then 'pathology'
  else 'procedure' end;

alter table public.room_schedules add column target_kind text not null default 'resource';
alter table public.room_schedules add constraint room_schedules_target_kind_check check (target_kind in ('resource','practitioner'));
alter table public.room_schedules drop constraint room_schedules_tenant_id_room_label_key;
alter table public.room_schedules add constraint room_schedules_tenant_target_key unique (tenant_id, target_kind, room_label);

drop function public.search_available_service_types(uuid, uuid, text);
create function public.search_available_service_types(p_branch uuid, p_service uuid, p_term text default '')
returns table(id uuid, code text, name text, duration_min integer, healthcare_service_id uuid, category text, modality text, practitioner_requirement text)
language sql stable set search_path = '' as $$
  select distinct st.id, st.code, st.name, st.duration_min, st.healthcare_service_id, st.category, st.modality, st.practitioner_requirement
  from public.service_types st
  join public.resource_service_types rst on rst.service_type_id = st.id
  join public.schedulable_resources r on r.id = rst.resource_id and r.active
  join public.locations l on l.id = r.location_id
  where st.tenant_id = private.current_tenant() and st.active and st.healthcare_service_id = p_service
    and (case when l.kind = 'room' then l.parent_location_id else l.id end) = p_branch
    and (length(trim(p_term)) < 2 or st.name ilike '%' || trim(p_term) || '%' or st.code ilike '%' || trim(p_term) || '%')
  order by st.name limit 20;
$$;

drop function public.search_master_service_types(uuid, text);
create function public.search_master_service_types(p_service uuid, p_term text default '')
returns table(id uuid, code text, name text, duration_min integer, active boolean, category text, modality text, practitioner_requirement text)
language sql stable set search_path = '' as $$
  select st.id, st.code, st.name, st.duration_min, st.active, st.category, st.modality, st.practitioner_requirement
  from public.service_types st
  where st.tenant_id = private.current_tenant() and (p_service is null or st.healthcare_service_id = p_service)
    and (length(trim(p_term)) < 2 or st.name ilike '%' || trim(p_term) || '%' or st.code ilike '%' || trim(p_term) || '%')
  order by st.name limit 100;
$$;
grant execute on function public.search_available_service_types(uuid, uuid, text) to authenticated;
grant execute on function public.search_master_service_types(uuid, text) to authenticated;
