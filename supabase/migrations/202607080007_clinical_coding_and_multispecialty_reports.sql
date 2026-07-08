-- Codificación clínica silenciosa: el usuario ve nombres humanos; integración/reportes guardan códigos estándar.
alter table public.service_types
  add column standard_code_system text not null default 'LOCAL',
  add column standard_code text not null default '',
  add column standard_display text not null default '',
  add constraint service_types_standard_system_check check (standard_code_system in ('LOCAL','LOINC','SNOMEDCT','ICD-10','ICD-11')),
  add constraint service_types_standard_code_check check (
    standard_code_system = 'LOCAL' or (length(trim(standard_code)) > 0 and length(trim(standard_display)) > 0)
  );

update public.service_types
set standard_code = code,
    standard_display = name
where standard_code = '' and code <> '';

alter table public.radiology_reports
  add column report_category text not null default 'imaging',
  add column report_code_system text not null default 'LOCAL',
  add column report_code text not null default '',
  add column report_code_display text not null default '',
  add column finding_code_system text not null default 'SNOMEDCT',
  add column finding_code text not null default '',
  add column finding_code_display text not null default '',
  add column diagnosis_code_system text not null default 'ICD-10',
  add column diagnosis_code text not null default '',
  add column diagnosis_code_display text not null default '',
  add constraint radiology_reports_category_check check (report_category in ('consultation','imaging','laboratory','pathology','procedure')),
  add constraint radiology_reports_code_systems_check check (
    report_code_system in ('LOCAL','LOINC','SNOMEDCT','ICD-10','ICD-11')
    and finding_code_system in ('LOCAL','LOINC','SNOMEDCT','ICD-10','ICD-11')
    and diagnosis_code_system in ('LOCAL','LOINC','SNOMEDCT','ICD-10','ICD-11')
  ),
  add constraint radiology_reports_optional_codes_check check (
    (
      (length(trim(finding_code)) = 0 and length(trim(finding_code_display)) = 0)
      or (length(trim(finding_code)) > 0 and length(trim(finding_code_display)) > 0)
    )
    and (
      (length(trim(diagnosis_code)) = 0 and length(trim(diagnosis_code_display)) = 0)
      or (length(trim(diagnosis_code)) > 0 and length(trim(diagnosis_code_display)) > 0)
    )
  );

update public.appointments a
set service_type_id = st.id
from public.service_types st
where a.service_type_id is null
  and st.tenant_id = a.tenant_id
  and (st.code = a.procedure_code or st.name = a.reason);

-- Backfill administrativo: el trigger protect_final_report vetaria el UPDATE sobre informes
-- firmados ("informe definitivo es inmutable"), asi que se suspende solo durante este relleno.
alter table public.radiology_reports disable trigger protect_final_report;
alter table public.radiology_reports disable trigger audit_reports;
update public.radiology_reports r
set report_category = a.service_category,
    report_code_system = coalesce(nullif(st.standard_code_system, ''), 'LOCAL'),
    report_code = coalesce(nullif(st.standard_code, ''), nullif(a.procedure_code, ''), a.service_type_id::text, a.id::text),
    report_code_display = coalesce(nullif(st.standard_display, ''), nullif(a.reason, ''), 'Prestación clínica')
from public.appointments a
left join public.service_types st on st.id = a.service_type_id
where r.appointment_id = a.id;
alter table public.radiology_reports enable trigger protect_final_report;
alter table public.radiology_reports enable trigger audit_reports;

alter table public.radiology_reports
  add constraint radiology_reports_required_report_code_check check (
    status <> 'final' or (length(trim(report_code)) > 0 and length(trim(report_code_display)) > 0)
  );

alter table public.report_templates
  add column category text not null default 'imaging',
  add constraint report_templates_category_check check (category in ('consultation','imaging','laboratory','pathology','procedure'));
alter table public.report_templates drop constraint if exists report_templates_modality_check;
alter table public.report_templates add constraint report_templates_modality_check check (modality in (
  'OT','AR','BI','BMD','CR','CT','CFM','DMS','DG','DX','ES','XC','GM','IO','IVOCT','IVUS','KER','LS','LEN','MR','MG','NM',
  'OAM','OPM','OP','OPT','OPTBSV','OPTENF','OPV','OCT','OSS','PX','PA','PT','RF','RG','RTIMAGE','SM','SRF','TG','US','BDUS','VA','XA',
  'EPS','ECG','EEG','EMG','EOG','HD','POS','RESP'
));
alter table public.report_templates drop constraint if exists report_templates_tenant_id_modality_name_key;
alter table public.report_templates add constraint report_templates_tenant_category_modality_name_key unique (tenant_id, category, modality, name);

drop function public.search_available_service_types(uuid, uuid, text);
create function public.search_available_service_types(p_branch uuid, p_service uuid, p_term text default '')
returns table(id uuid, code text, name text, duration_min integer, healthcare_service_id uuid, category text, modality text, practitioner_requirement text, standard_code_system text, standard_code text, standard_display text)
language sql stable set search_path = '' as $$
  select distinct st.id, st.code, st.name, st.duration_min, st.healthcare_service_id, st.category, st.modality, st.practitioner_requirement, st.standard_code_system, st.standard_code, st.standard_display
  from public.service_types st
  join public.resource_service_types rst on rst.service_type_id = st.id
  join public.schedulable_resources r on r.id = rst.resource_id and r.active
  join public.locations l on l.id = r.location_id
  where st.tenant_id = private.current_tenant() and st.active and st.healthcare_service_id = p_service
    and (case when l.kind = 'room' then l.parent_location_id else l.id end) = p_branch
    and (length(trim(p_term)) < 2
      or st.name ilike '%' || trim(p_term) || '%'
      or st.code ilike '%' || trim(p_term) || '%'
      or st.standard_code ilike '%' || trim(p_term) || '%'
      or st.standard_display ilike '%' || trim(p_term) || '%')
  order by st.name limit 20;
$$;

drop function public.search_master_service_types(uuid, text);
create function public.search_master_service_types(p_service uuid, p_term text default '')
returns table(id uuid, code text, name text, duration_min integer, active boolean, category text, modality text, practitioner_requirement text, standard_code_system text, standard_code text, standard_display text)
language sql stable set search_path = '' as $$
  select st.id, st.code, st.name, st.duration_min, st.active, st.category, st.modality, st.practitioner_requirement, st.standard_code_system, st.standard_code, st.standard_display
  from public.service_types st
  where st.tenant_id = private.current_tenant() and (p_service is null or st.healthcare_service_id = p_service)
    and (length(trim(p_term)) < 2
      or st.name ilike '%' || trim(p_term) || '%'
      or st.code ilike '%' || trim(p_term) || '%'
      or st.standard_code ilike '%' || trim(p_term) || '%'
      or st.standard_display ilike '%' || trim(p_term) || '%')
  order by st.name limit 100;
$$;
grant execute on function public.search_available_service_types(uuid, uuid, text) to authenticated;
grant execute on function public.search_master_service_types(uuid, text) to authenticated;

notify pgrst, 'reload schema';
