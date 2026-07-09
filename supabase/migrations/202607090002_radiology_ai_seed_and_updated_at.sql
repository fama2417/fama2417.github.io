-- Hardening para extraccion asistida por IA de hallazgos radiologicos.
-- Fase 1.1: updated_at automatico y seeds por tenant nuevo.

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;

create or replace function private.create_updated_at_trigger(p_table text, p_trigger text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = p_table
      and column_name = 'updated_at'
  ) then
    execute format('drop trigger if exists %I on public.%I', p_trigger, p_table);
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.set_updated_at()',
      p_trigger,
      p_table
    );
  end if;
end;
$$;

select private.create_updated_at_trigger('reporting_groups', 'set_updated_at_reporting_groups');
select private.create_updated_at_trigger('service_type_reporting_groups', 'set_updated_at_service_type_reporting_groups');
select private.create_updated_at_trigger('finding_dictionary', 'set_updated_at_finding_dictionary');
select private.create_updated_at_trigger('finding_synonyms', 'set_updated_at_finding_synonyms');
select private.create_updated_at_trigger('finding_group_mappings', 'set_updated_at_finding_group_mappings');
select private.create_updated_at_trigger('finding_candidates', 'set_updated_at_finding_candidates');
select private.create_updated_at_trigger('extracted_findings', 'set_updated_at_extracted_findings');
select private.create_updated_at_trigger('extraction_feedback', 'set_updated_at_extraction_feedback');
select private.create_updated_at_trigger('ai_usage_log', 'set_updated_at_ai_usage_log');
select private.create_updated_at_trigger('ai_model_pricing', 'set_updated_at_ai_model_pricing');

drop function private.create_updated_at_trigger(text, text);

create or replace function public.seed_radiology_ai_defaults_for_tenant(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_tenant_id is null then
    return;
  end if;

  insert into public.reporting_groups (tenant_id, code, name, modality, body_region, description)
  values
    (p_tenant_id, 'CT_CHEST', 'TC torax', 'CT', 'chest', 'Tomografia computada de torax'),
    (p_tenant_id, 'CT_ABDOMEN_PELVIS', 'TC abdomen y pelvis', 'CT', 'abdomen_pelvis', 'Tomografia computada de abdomen y pelvis'),
    (p_tenant_id, 'CT_URO', 'Uro-TC', 'CT', 'urinary', 'Estudios TC de via urinaria'),
    (p_tenant_id, 'CT_HEAD', 'TC craneo', 'CT', 'head', 'Tomografia computada de craneo'),
    (p_tenant_id, 'CT_SPINE', 'TC columna', 'CT', 'spine', 'Tomografia computada de columna'),
    (p_tenant_id, 'CT_ANGIO', 'Angio-TC', 'CT', 'vascular', 'Estudios angiograficos por TC'),
    (p_tenant_id, 'CT_MSK', 'TC musculoesqueletica', 'CT', 'msk', 'Tomografia musculoesqueletica'),
    (p_tenant_id, 'MR_BRAIN', 'RM cerebro', 'MR', 'brain', 'Resonancia magnetica de cerebro'),
    (p_tenant_id, 'MR_SPINE', 'RM columna', 'MR', 'spine', 'Resonancia magnetica de columna'),
    (p_tenant_id, 'MR_KNEE', 'RM rodilla', 'MR', 'knee', 'Resonancia magnetica de rodilla'),
    (p_tenant_id, 'MR_SHOULDER', 'RM hombro', 'MR', 'shoulder', 'Resonancia magnetica de hombro'),
    (p_tenant_id, 'MR_HIP', 'RM cadera', 'MR', 'hip', 'Resonancia magnetica de cadera'),
    (p_tenant_id, 'MR_ABDOMEN', 'RM abdomen', 'MR', 'abdomen', 'Resonancia magnetica de abdomen'),
    (p_tenant_id, 'MR_PELVIS', 'RM pelvis', 'MR', 'pelvis', 'Resonancia magnetica de pelvis'),
    (p_tenant_id, 'MR_BREAST', 'RM mama', 'MR', 'breast', 'Resonancia magnetica mamaria'),
    (p_tenant_id, 'DX_CHEST', 'Radiografia torax', 'DX', 'chest', 'Radiografia de torax'),
    (p_tenant_id, 'DX_SPINE', 'Radiografia columna', 'DX', 'spine', 'Radiografia de columna'),
    (p_tenant_id, 'DX_UPPER_LIMB', 'Radiografia extremidad superior', 'DX', 'upper_limb', 'Radiografia de extremidad superior'),
    (p_tenant_id, 'DX_LOWER_LIMB', 'Radiografia extremidad inferior', 'DX', 'lower_limb', 'Radiografia de extremidad inferior'),
    (p_tenant_id, 'DX_PELVIS', 'Radiografia pelvis', 'DX', 'pelvis', 'Radiografia de pelvis'),
    (p_tenant_id, 'DX_ABDOMEN', 'Radiografia abdomen', 'DX', 'abdomen', 'Radiografia de abdomen'),
    (p_tenant_id, 'DX_BONE', 'Radiografia osteoarticular', 'DX', 'bone', 'Radiografia osteoarticular general'),
    (p_tenant_id, 'US_ABDOMEN', 'Ecografia abdomen', 'US', 'abdomen', 'Ecografia abdominal'),
    (p_tenant_id, 'US_RENAL', 'Ecografia renal', 'US', 'renal', 'Ecografia renal y vias urinarias'),
    (p_tenant_id, 'US_THYROID', 'Ecografia tiroides', 'US', 'thyroid', 'Ecografia tiroidea'),
    (p_tenant_id, 'US_BREAST', 'Ecografia mamaria', 'US', 'breast', 'Ecografia de mama'),
    (p_tenant_id, 'US_PELVIS', 'Ecografia pelvis', 'US', 'pelvis', 'Ecografia pelvica'),
    (p_tenant_id, 'US_OBSTETRIC', 'Ecografia obstetrica', 'US', 'obstetric', 'Ecografia obstetrica'),
    (p_tenant_id, 'US_DOPPLER', 'Ecografia Doppler', 'US', 'vascular', 'Estudios Doppler'),
    (p_tenant_id, 'MG_BREAST', 'Mamografia', 'MG', 'breast', 'Mamografia y estudios mamarios'),
    (p_tenant_id, 'NM_GENERAL', 'Medicina nuclear general', 'NM', 'general', 'Estudios de medicina nuclear'),
    (p_tenant_id, 'UNKNOWN_RADIOLOGY', 'Radiologia sin clasificar', 'UNKNOWN', null, 'Grupo por defecto para prestaciones no clasificadas')
  on conflict (tenant_id, code) do nothing;

  insert into public.finding_dictionary (tenant_id, local_code, canonical_name, normalized_canonical_name, created_from)
  values
    (p_tenant_id, 'FD-0001', 'Sin hallazgos patologicos significativos', lower('Sin hallazgos patologicos significativos'), 'manual'),
    (p_tenant_id, 'FD-0002', 'Colelitiasis', lower('Colelitiasis'), 'manual'),
    (p_tenant_id, 'FD-0003', 'Colecistitis aguda', lower('Colecistitis aguda'), 'manual'),
    (p_tenant_id, 'FD-0004', 'Esteatosis hepatica', lower('Esteatosis hepatica'), 'manual'),
    (p_tenant_id, 'FD-0005', 'Dilatacion de via biliar', lower('Dilatacion de via biliar'), 'manual'),
    (p_tenant_id, 'FD-0006', 'Apendicitis aguda', lower('Apendicitis aguda'), 'manual'),
    (p_tenant_id, 'FD-0007', 'Diverticulitis', lower('Diverticulitis'), 'manual'),
    (p_tenant_id, 'FD-0008', 'Obstruccion intestinal', lower('Obstruccion intestinal'), 'manual'),
    (p_tenant_id, 'FD-0009', 'Ascitis', lower('Ascitis'), 'manual'),
    (p_tenant_id, 'FD-0010', 'Coleccion intraabdominal', lower('Coleccion intraabdominal'), 'manual'),
    (p_tenant_id, 'FD-0011', 'Litiasis renal', lower('Litiasis renal'), 'manual'),
    (p_tenant_id, 'FD-0012', 'Litiasis ureteral', lower('Litiasis ureteral'), 'manual'),
    (p_tenant_id, 'FD-0013', 'Hidronefrosis', lower('Hidronefrosis'), 'manual'),
    (p_tenant_id, 'FD-0014', 'Hidroureteronefrosis', lower('Hidroureteronefrosis'), 'manual'),
    (p_tenant_id, 'FD-0015', 'Uropatia obstructiva', lower('Uropatia obstructiva'), 'manual'),
    (p_tenant_id, 'FD-0016', 'Quiste renal simple', lower('Quiste renal simple'), 'manual'),
    (p_tenant_id, 'FD-0017', 'Neumonia', lower('Neumonia'), 'manual'),
    (p_tenant_id, 'FD-0018', 'Derrame pleural', lower('Derrame pleural'), 'manual'),
    (p_tenant_id, 'FD-0019', 'Neumotorax', lower('Neumotorax'), 'manual'),
    (p_tenant_id, 'FD-0020', 'Atelectasia', lower('Atelectasia'), 'manual'),
    (p_tenant_id, 'FD-0021', 'Consolidacion pulmonar', lower('Consolidacion pulmonar'), 'manual'),
    (p_tenant_id, 'FD-0022', 'Nodulo pulmonar', lower('Nodulo pulmonar'), 'manual'),
    (p_tenant_id, 'FD-0023', 'Masa pulmonar', lower('Masa pulmonar'), 'manual'),
    (p_tenant_id, 'FD-0024', 'Edema pulmonar', lower('Edema pulmonar'), 'manual'),
    (p_tenant_id, 'FD-0025', 'Cardiomegalia', lower('Cardiomegalia'), 'manual'),
    (p_tenant_id, 'FD-0026', 'Fractura', lower('Fractura'), 'manual'),
    (p_tenant_id, 'FD-0027', 'Luxacion', lower('Luxacion'), 'manual'),
    (p_tenant_id, 'FD-0028', 'Artrosis', lower('Artrosis'), 'manual'),
    (p_tenant_id, 'FD-0029', 'Derrame articular', lower('Derrame articular'), 'manual'),
    (p_tenant_id, 'FD-0030', 'Rotura meniscal', lower('Rotura meniscal'), 'manual'),
    (p_tenant_id, 'FD-0031', 'Tendinopatia', lower('Tendinopatia'), 'manual'),
    (p_tenant_id, 'FD-0032', 'Hernia discal', lower('Hernia discal'), 'manual'),
    (p_tenant_id, 'FD-0033', 'Estenosis de canal', lower('Estenosis de canal'), 'manual'),
    (p_tenant_id, 'FD-0034', 'Hemorragia intracraneana', lower('Hemorragia intracraneana'), 'manual'),
    (p_tenant_id, 'FD-0035', 'Infarto cerebral', lower('Infarto cerebral'), 'manual'),
    (p_tenant_id, 'FD-0036', 'Hidrocefalia', lower('Hidrocefalia'), 'manual')
  on conflict (tenant_id, local_code) do nothing;
end;
$$;

revoke all on function public.seed_radiology_ai_defaults_for_tenant(uuid) from public, anon, authenticated;

select public.seed_radiology_ai_defaults_for_tenant(id)
from public.tenants;

create or replace function public.handle_new_tenant_radiology_ai_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_radiology_ai_defaults_for_tenant(new.id);
  return new;
end;
$$;

revoke all on function public.handle_new_tenant_radiology_ai_defaults() from public, anon, authenticated;

drop trigger if exists on_tenant_created_seed_radiology_ai_defaults on public.tenants;
create trigger on_tenant_created_seed_radiology_ai_defaults
after insert on public.tenants
for each row execute function public.handle_new_tenant_radiology_ai_defaults();

notify pgrst, 'reload schema';
