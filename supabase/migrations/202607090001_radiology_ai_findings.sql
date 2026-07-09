-- Base de datos para extraccion asistida por IA de hallazgos radiologicos.
-- Fase 1 solamente: tablas, indices, RLS y seeds iniciales.

create table public.reporting_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  code text not null,
  name text not null,
  modality text not null,
  body_region text,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table public.service_type_reporting_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  service_type_id uuid not null references public.service_types(id) on delete cascade,
  reporting_group_id uuid not null references public.reporting_groups(id) on delete cascade,
  confidence numeric(4,3) not null default 1 check (confidence between 0 and 1),
  assigned_by text not null default 'manual' check (assigned_by in ('auto_rule', 'ai', 'manual')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.finding_dictionary (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  local_code text not null,
  canonical_name text not null,
  normalized_canonical_name text not null,
  body_site text,
  default_status text not null default 'present' check (default_status in ('present', 'absent', 'uncertain')),
  requires_laterality boolean not null default false,
  active boolean not null default true,
  snomed_code text,
  snomed_display text,
  icd10_code text,
  icd11_code text,
  radlex_code text,
  created_from text not null default 'manual' check (created_from in ('manual', 'candidate', 'ai')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, local_code),
  unique (tenant_id, normalized_canonical_name)
);

create table public.finding_synonyms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  finding_id uuid not null references public.finding_dictionary(id) on delete cascade,
  synonym text not null,
  normalized_synonym text not null,
  language text not null default 'es' check (language in ('es', 'en')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, finding_id, normalized_synonym)
);

create table public.finding_group_mappings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  finding_id uuid not null references public.finding_dictionary(id) on delete cascade,
  reporting_group_id uuid not null references public.reporting_groups(id) on delete cascade,
  priority integer not null default 50 check (priority between 0 and 100),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, finding_id, reporting_group_id)
);

create table public.finding_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  raw_text text not null,
  normalized_text text not null,
  suggested_canonical_name text,
  service_type_id uuid references public.service_types(id) on delete set null,
  service_type_code text,
  service_type_name text,
  reporting_group_id uuid references public.reporting_groups(id) on delete set null,
  modality text,
  body_site text,
  laterality_detected text check (laterality_detected in ('left', 'right', 'bilateral', 'midline', 'unknown')),
  severity_detected text check (severity_detected in ('mild', 'moderate', 'severe', 'unknown')),
  source_report_id uuid references public.radiology_reports(id) on delete set null,
  source_sentence text,
  source_section text check (source_section in ('findings', 'impression', 'clinical_indication')),
  occurrence_count integer not null default 1 check (occurrence_count >= 1),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ai_confidence numeric(4,3) check (ai_confidence between 0 and 1),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'merged')),
  accepted_finding_id uuid references public.finding_dictionary(id) on delete set null,
  rejected_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.extracted_findings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  report_id uuid not null references public.radiology_reports(id) on delete cascade,
  finding_id uuid references public.finding_dictionary(id) on delete set null,
  finding_candidate_id uuid references public.finding_candidates(id) on delete set null,
  finding_text text not null,
  normalized_text text not null,
  status text not null check (status in ('present', 'absent', 'uncertain', 'history', 'recommendation')),
  importance text not null check (importance in ('principal', 'secondary', 'incidental', 'negative', 'not_relevant')),
  source_section text not null check (source_section in ('findings', 'impression', 'clinical_indication')),
  source_sentence text not null,
  body_site text,
  laterality text check (laterality in ('left', 'right', 'bilateral', 'midline', 'unknown')),
  severity text check (severity in ('mild', 'moderate', 'severe', 'unknown')),
  confidence numeric(4,3) not null default 0 check (confidence between 0 and 1),
  extraction_method text not null check (extraction_method in ('local_rules', 'openai', 'manual')),
  coding_status text not null default 'suggested' check (coding_status in ('suggested', 'confirmed', 'corrected', 'rejected', 'not_required')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.extraction_feedback (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  report_id uuid not null references public.radiology_reports(id) on delete cascade,
  extracted_finding_id uuid references public.extracted_findings(id) on delete set null,
  original_text text,
  original_suggestion text,
  corrected_text text,
  corrected_finding_id uuid references public.finding_dictionary(id) on delete set null,
  action text not null check (action in ('accepted', 'corrected', 'rejected', 'created_new', 'merged_candidate')),
  user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  report_id uuid references public.radiology_reports(id) on delete set null,
  service_type_id uuid references public.service_types(id) on delete set null,
  provider text not null default 'openai' check (provider in ('openai')),
  model text not null,
  request_type text not null check (request_type in ('extract_findings', 'classify_procedure', 'bootstrap_dictionary', 'normalize_candidate')),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  total_tokens integer check (total_tokens is null or total_tokens >= 0),
  estimated_cost_usd numeric(12,6) check (estimated_cost_usd is null or estimated_cost_usd >= 0),
  success boolean not null default false,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_model_pricing (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'openai' check (provider in ('openai')),
  model text not null,
  input_usd_per_1m numeric(12,6) not null,
  output_usd_per_1m numeric(12,6) not null,
  cached_input_usd_per_1m numeric(12,6),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, model)
);

create index reporting_groups_tenant_idx on public.reporting_groups (tenant_id);
create index reporting_groups_code_idx on public.reporting_groups (code);
create index reporting_groups_modality_idx on public.reporting_groups (modality);

create index service_type_reporting_groups_service_type_idx on public.service_type_reporting_groups (service_type_id);
create index service_type_reporting_groups_group_idx on public.service_type_reporting_groups (reporting_group_id);
create index service_type_reporting_groups_tenant_idx on public.service_type_reporting_groups (tenant_id);
create unique index service_type_reporting_groups_active_idx on public.service_type_reporting_groups (tenant_id, service_type_id, reporting_group_id) where active;

create index finding_dictionary_tenant_idx on public.finding_dictionary (tenant_id);
create index finding_dictionary_local_code_idx on public.finding_dictionary (local_code);
create index finding_dictionary_normalized_idx on public.finding_dictionary (normalized_canonical_name);
create index finding_dictionary_active_idx on public.finding_dictionary (active);

create index finding_synonyms_finding_idx on public.finding_synonyms (finding_id);
create index finding_synonyms_normalized_idx on public.finding_synonyms (normalized_synonym);
create index finding_synonyms_tenant_idx on public.finding_synonyms (tenant_id);

create index finding_group_mappings_finding_idx on public.finding_group_mappings (finding_id);
create index finding_group_mappings_group_idx on public.finding_group_mappings (reporting_group_id);
create index finding_group_mappings_tenant_idx on public.finding_group_mappings (tenant_id);

create index finding_candidates_repeat_idx on public.finding_candidates (tenant_id, normalized_text, reporting_group_id);
create index finding_candidates_status_idx on public.finding_candidates (status);
create index finding_candidates_source_report_idx on public.finding_candidates (source_report_id);
create index finding_candidates_group_idx on public.finding_candidates (reporting_group_id);

create index extracted_findings_report_idx on public.extracted_findings (report_id);
create index extracted_findings_tenant_idx on public.extracted_findings (tenant_id);
create index extracted_findings_coding_status_idx on public.extracted_findings (coding_status);
create index extracted_findings_finding_idx on public.extracted_findings (finding_id);
create index extracted_findings_candidate_idx on public.extracted_findings (finding_candidate_id);

create index extraction_feedback_report_idx on public.extraction_feedback (report_id);
create index extraction_feedback_extracted_idx on public.extraction_feedback (extracted_finding_id);
create index extraction_feedback_user_idx on public.extraction_feedback (user_id);
create index extraction_feedback_tenant_idx on public.extraction_feedback (tenant_id);

create index ai_usage_log_tenant_idx on public.ai_usage_log (tenant_id);
create index ai_usage_log_report_idx on public.ai_usage_log (report_id);
create index ai_usage_log_created_idx on public.ai_usage_log (created_at);
create index ai_usage_log_request_type_idx on public.ai_usage_log (request_type);
create index ai_usage_log_success_idx on public.ai_usage_log (success);

alter table public.reporting_groups enable row level security;
alter table public.service_type_reporting_groups enable row level security;
alter table public.finding_dictionary enable row level security;
alter table public.finding_synonyms enable row level security;
alter table public.finding_group_mappings enable row level security;
alter table public.finding_candidates enable row level security;
alter table public.extracted_findings enable row level security;
alter table public.extraction_feedback enable row level security;
alter table public.ai_usage_log enable row level security;
alter table public.ai_model_pricing enable row level security;

create policy "tenant reads reporting groups" on public.reporting_groups for select to authenticated
using (tenant_id = (select private.current_tenant()));
create policy "admins manage reporting groups" on public.reporting_groups for all to authenticated
using (tenant_id = (select private.current_tenant()) and (select private.current_role()) = 'admin')
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) = 'admin');

create policy "tenant reads service type reporting groups" on public.service_type_reporting_groups for select to authenticated
using (tenant_id = (select private.current_tenant()));
create policy "admins manage service type reporting groups" on public.service_type_reporting_groups for all to authenticated
using (tenant_id = (select private.current_tenant()) and (select private.current_role()) = 'admin')
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) = 'admin'
  and exists (select 1 from public.service_types st where st.id = service_type_id and st.tenant_id = (select private.current_tenant()))
  and exists (select 1 from public.reporting_groups rg where rg.id = reporting_group_id and rg.tenant_id = (select private.current_tenant())));

create policy "tenant reads finding dictionary" on public.finding_dictionary for select to authenticated
using (tenant_id = (select private.current_tenant()));
create policy "admins manage finding dictionary" on public.finding_dictionary for all to authenticated
using (tenant_id = (select private.current_tenant()) and (select private.current_role()) = 'admin')
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) = 'admin');

create policy "tenant reads finding synonyms" on public.finding_synonyms for select to authenticated
using (tenant_id = (select private.current_tenant()));
create policy "admins manage finding synonyms" on public.finding_synonyms for all to authenticated
using (tenant_id = (select private.current_tenant()) and (select private.current_role()) = 'admin')
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) = 'admin'
  and exists (select 1 from public.finding_dictionary fd where fd.id = finding_id and fd.tenant_id = (select private.current_tenant())));

create policy "tenant reads finding group mappings" on public.finding_group_mappings for select to authenticated
using (tenant_id = (select private.current_tenant()));
create policy "admins manage finding group mappings" on public.finding_group_mappings for all to authenticated
using (tenant_id = (select private.current_tenant()) and (select private.current_role()) = 'admin')
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) = 'admin'
  and exists (select 1 from public.finding_dictionary fd where fd.id = finding_id and fd.tenant_id = (select private.current_tenant()))
  and exists (select 1 from public.reporting_groups rg where rg.id = reporting_group_id and rg.tenant_id = (select private.current_tenant())));

create policy "tenant reads finding candidates" on public.finding_candidates for select to authenticated
using (tenant_id = (select private.current_tenant()));
create policy "report staff manage finding candidates" on public.finding_candidates for all to authenticated
using (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'radiologist'))
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'radiologist')
  and (service_type_id is null or exists (select 1 from public.service_types st where st.id = service_type_id and st.tenant_id = (select private.current_tenant())))
  and (reporting_group_id is null or exists (select 1 from public.reporting_groups rg where rg.id = reporting_group_id and rg.tenant_id = (select private.current_tenant())))
  and (source_report_id is null or exists (select 1 from public.radiology_reports rr where rr.id = source_report_id and rr.tenant_id = (select private.current_tenant())))
  and (accepted_finding_id is null or exists (select 1 from public.finding_dictionary fd where fd.id = accepted_finding_id and fd.tenant_id = (select private.current_tenant()))));

create policy "tenant reads extracted findings" on public.extracted_findings for select to authenticated
using (tenant_id = (select private.current_tenant()));
create policy "report staff manage extracted findings" on public.extracted_findings for all to authenticated
using (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'radiologist'))
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'radiologist')
  and exists (select 1 from public.radiology_reports rr where rr.id = report_id and rr.tenant_id = (select private.current_tenant()))
  and (finding_id is null or exists (select 1 from public.finding_dictionary fd where fd.id = finding_id and fd.tenant_id = (select private.current_tenant())))
  and (finding_candidate_id is null or exists (select 1 from public.finding_candidates fc where fc.id = finding_candidate_id and fc.tenant_id = (select private.current_tenant()))));

create policy "tenant reads extraction feedback" on public.extraction_feedback for select to authenticated
using (tenant_id = (select private.current_tenant()));
create policy "report staff manage extraction feedback" on public.extraction_feedback for all to authenticated
using (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'radiologist'))
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'radiologist')
  and exists (select 1 from public.radiology_reports rr where rr.id = report_id and rr.tenant_id = (select private.current_tenant()))
  and (extracted_finding_id is null or exists (select 1 from public.extracted_findings ef where ef.id = extracted_finding_id and ef.tenant_id = (select private.current_tenant())))
  and (corrected_finding_id is null or exists (select 1 from public.finding_dictionary fd where fd.id = corrected_finding_id and fd.tenant_id = (select private.current_tenant()))));

create policy "admins read ai usage log" on public.ai_usage_log for select to authenticated
using (tenant_id = (select private.current_tenant()) and (select private.current_role()) = 'admin');
create policy "report staff insert ai usage log" on public.ai_usage_log for insert to authenticated
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'radiologist')
  and (report_id is null or exists (select 1 from public.radiology_reports rr where rr.id = report_id and rr.tenant_id = (select private.current_tenant())))
  and (service_type_id is null or exists (select 1 from public.service_types st where st.id = service_type_id and st.tenant_id = (select private.current_tenant()))));

create policy "authenticated read ai model pricing" on public.ai_model_pricing for select to authenticated
using (true);
create policy "platform manages ai model pricing" on public.ai_model_pricing for all to authenticated
using ((select private.is_platform())) with check ((select private.is_platform()));

create trigger audit_reporting_groups after insert or update or delete on public.reporting_groups for each row execute function private.audit_change();
create trigger audit_service_type_reporting_groups after insert or update or delete on public.service_type_reporting_groups for each row execute function private.audit_change();
create trigger audit_finding_dictionary after insert or update or delete on public.finding_dictionary for each row execute function private.audit_change();
create trigger audit_finding_synonyms after insert or update or delete on public.finding_synonyms for each row execute function private.audit_change();
create trigger audit_finding_group_mappings after insert or update or delete on public.finding_group_mappings for each row execute function private.audit_change();
create trigger audit_finding_candidates after insert or update or delete on public.finding_candidates for each row execute function private.audit_change();
create trigger audit_extracted_findings after insert or update or delete on public.extracted_findings for each row execute function private.audit_change();
create trigger audit_extraction_feedback after insert or update or delete on public.extraction_feedback for each row execute function private.audit_change();
create trigger audit_ai_usage_log after insert or update or delete on public.ai_usage_log for each row execute function private.audit_change();

insert into public.reporting_groups (tenant_id, code, name, modality, body_region, description)
select t.id, v.code, v.name, v.modality, v.body_region, v.description
from public.tenants t
cross join (values
  ('CT_CHEST', 'TC torax', 'CT', 'chest', 'Tomografia computada de torax'),
  ('CT_ABDOMEN_PELVIS', 'TC abdomen y pelvis', 'CT', 'abdomen_pelvis', 'Tomografia computada de abdomen y pelvis'),
  ('CT_URO', 'Uro-TC', 'CT', 'urinary', 'Estudios TC de via urinaria'),
  ('CT_HEAD', 'TC craneo', 'CT', 'head', 'Tomografia computada de craneo'),
  ('CT_SPINE', 'TC columna', 'CT', 'spine', 'Tomografia computada de columna'),
  ('CT_ANGIO', 'Angio-TC', 'CT', 'vascular', 'Estudios angiograficos por TC'),
  ('CT_MSK', 'TC musculoesqueletica', 'CT', 'msk', 'Tomografia musculoesqueletica'),
  ('MR_BRAIN', 'RM cerebro', 'MR', 'brain', 'Resonancia magnetica de cerebro'),
  ('MR_SPINE', 'RM columna', 'MR', 'spine', 'Resonancia magnetica de columna'),
  ('MR_KNEE', 'RM rodilla', 'MR', 'knee', 'Resonancia magnetica de rodilla'),
  ('MR_SHOULDER', 'RM hombro', 'MR', 'shoulder', 'Resonancia magnetica de hombro'),
  ('MR_HIP', 'RM cadera', 'MR', 'hip', 'Resonancia magnetica de cadera'),
  ('MR_ABDOMEN', 'RM abdomen', 'MR', 'abdomen', 'Resonancia magnetica de abdomen'),
  ('MR_PELVIS', 'RM pelvis', 'MR', 'pelvis', 'Resonancia magnetica de pelvis'),
  ('MR_BREAST', 'RM mama', 'MR', 'breast', 'Resonancia magnetica mamaria'),
  ('DX_CHEST', 'Radiografia torax', 'DX', 'chest', 'Radiografia de torax'),
  ('DX_SPINE', 'Radiografia columna', 'DX', 'spine', 'Radiografia de columna'),
  ('DX_UPPER_LIMB', 'Radiografia extremidad superior', 'DX', 'upper_limb', 'Radiografia de extremidad superior'),
  ('DX_LOWER_LIMB', 'Radiografia extremidad inferior', 'DX', 'lower_limb', 'Radiografia de extremidad inferior'),
  ('DX_PELVIS', 'Radiografia pelvis', 'DX', 'pelvis', 'Radiografia de pelvis'),
  ('DX_ABDOMEN', 'Radiografia abdomen', 'DX', 'abdomen', 'Radiografia de abdomen'),
  ('DX_BONE', 'Radiografia osteoarticular', 'DX', 'bone', 'Radiografia osteoarticular general'),
  ('US_ABDOMEN', 'Ecografia abdomen', 'US', 'abdomen', 'Ecografia abdominal'),
  ('US_RENAL', 'Ecografia renal', 'US', 'renal', 'Ecografia renal y vias urinarias'),
  ('US_THYROID', 'Ecografia tiroides', 'US', 'thyroid', 'Ecografia tiroidea'),
  ('US_BREAST', 'Ecografia mamaria', 'US', 'breast', 'Ecografia de mama'),
  ('US_PELVIS', 'Ecografia pelvis', 'US', 'pelvis', 'Ecografia pelvica'),
  ('US_OBSTETRIC', 'Ecografia obstetrica', 'US', 'obstetric', 'Ecografia obstetrica'),
  ('US_DOPPLER', 'Ecografia Doppler', 'US', 'vascular', 'Estudios Doppler'),
  ('MG_BREAST', 'Mamografia', 'MG', 'breast', 'Mamografia y estudios mamarios'),
  ('NM_GENERAL', 'Medicina nuclear general', 'NM', 'general', 'Estudios de medicina nuclear'),
  ('UNKNOWN_RADIOLOGY', 'Radiologia sin clasificar', 'UNKNOWN', null, 'Grupo por defecto para prestaciones no clasificadas')
) as v(code, name, modality, body_region, description)
on conflict (tenant_id, code) do nothing;

insert into public.finding_dictionary (tenant_id, local_code, canonical_name, normalized_canonical_name, created_from)
select t.id, v.local_code, v.canonical_name, lower(v.canonical_name), 'manual'
from public.tenants t
cross join (values
  ('FD-0001', 'Sin hallazgos patologicos significativos'),
  ('FD-0002', 'Colelitiasis'),
  ('FD-0003', 'Colecistitis aguda'),
  ('FD-0004', 'Esteatosis hepatica'),
  ('FD-0005', 'Dilatacion de via biliar'),
  ('FD-0006', 'Apendicitis aguda'),
  ('FD-0007', 'Diverticulitis'),
  ('FD-0008', 'Obstruccion intestinal'),
  ('FD-0009', 'Ascitis'),
  ('FD-0010', 'Coleccion intraabdominal'),
  ('FD-0011', 'Litiasis renal'),
  ('FD-0012', 'Litiasis ureteral'),
  ('FD-0013', 'Hidronefrosis'),
  ('FD-0014', 'Hidroureteronefrosis'),
  ('FD-0015', 'Uropatia obstructiva'),
  ('FD-0016', 'Quiste renal simple'),
  ('FD-0017', 'Neumonia'),
  ('FD-0018', 'Derrame pleural'),
  ('FD-0019', 'Neumotorax'),
  ('FD-0020', 'Atelectasia'),
  ('FD-0021', 'Consolidacion pulmonar'),
  ('FD-0022', 'Nodulo pulmonar'),
  ('FD-0023', 'Masa pulmonar'),
  ('FD-0024', 'Edema pulmonar'),
  ('FD-0025', 'Cardiomegalia'),
  ('FD-0026', 'Fractura'),
  ('FD-0027', 'Luxacion'),
  ('FD-0028', 'Artrosis'),
  ('FD-0029', 'Derrame articular'),
  ('FD-0030', 'Rotura meniscal'),
  ('FD-0031', 'Tendinopatia'),
  ('FD-0032', 'Hernia discal'),
  ('FD-0033', 'Estenosis de canal'),
  ('FD-0034', 'Hemorragia intracraneana'),
  ('FD-0035', 'Infarto cerebral'),
  ('FD-0036', 'Hidrocefalia')
) as v(local_code, canonical_name)
on conflict (tenant_id, local_code) do nothing;

insert into public.ai_model_pricing (provider, model, input_usd_per_1m, output_usd_per_1m, cached_input_usd_per_1m)
values
  ('openai', 'gpt-5.4-nano', 0, 0, null),
  ('openai', 'gpt-5.4-mini', 0, 0, null)
on conflict (provider, model) do nothing;

notify pgrst, 'reload schema';
