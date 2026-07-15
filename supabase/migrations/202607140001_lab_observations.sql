-- Resultados de laboratorio DISCRETOS (una fila por analito), forma-Observation de FHIR sin la
-- ceremonia JSON: base para tendencia en la ficha, alertas de valor crítico e interoperabilidad.
-- Convive con el texto libre existente (radiology_reports.findings/interpretation): esto NO lo
-- reemplaza; lo complementa con datos estructurados cuando el perfil es laboratory.
create table public.lab_observations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  report_id uuid not null references public.radiology_reports(id) on delete cascade,
  -- Denormalizados desde el informe: appointment_id gobierna permisos (can_sign_report) y
  -- patient_id + observed_at permiten graficar la tendencia del analito sin recorrer informes.
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  -- Observation.code: LOINC preferido; analyte es el nombre legible (display o local).
  loinc_code text not null default '',
  analyte text not null,
  -- Observation.value[x]: numérico cuando aplica; value_text para resultados no numéricos
  -- ("Positivo", "No reactivo"). No se usan ambos a la vez.
  value_num numeric,
  value_text text not null default '',
  unit text not null default '',
  -- Observation.referenceRange: numérico y/o textual.
  ref_low numeric,
  ref_high numeric,
  ref_text text not null default '',
  -- Observation.interpretation (subconjunto): '' = no evaluado. critical_* alimentará el flujo de
  -- hallazgo/resultado crítico existente cuando se conecte (por ahora se registra, no dispara nada).
  flag text not null default '' check (flag in ('', 'normal', 'low', 'high', 'critical_low', 'critical_high', 'abnormal')),
  -- Observation.effective: fecha del resultado/muestra; eje X de la tendencia.
  observed_at timestamptz not null default now(),
  -- ponytail: seam para el track de escaneo. 'manual' hoy; 'ocr'/'ai' cuando se ingiera una orden o
  -- impresión de laboratorio. source_sentence conserva la frase de origen para trazabilidad.
  source text not null default 'manual' check (source in ('manual', 'ocr', 'ai')),
  source_sentence text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  -- Un resultado no puede quedar vacío: exige valor numérico o textual.
  constraint lab_observation_has_value check (value_num is not null or length(trim(value_text)) > 0)
);

-- Tendencia por paciente y analito (clave LOINC cuando existe, si no el nombre normalizado en la app).
create index lab_observations_trend_idx on public.lab_observations (tenant_id, patient_id, loinc_code, observed_at);
create index lab_observations_report_idx on public.lab_observations (report_id);

alter table public.lab_observations enable row level security;

-- Lectura: cualquier miembro del tenant (el filtro por rol/visibilidad de informe se aplica en la app,
-- igual que visibleFindings para hallazgos).
create policy "tenant reads lab observations" on public.lab_observations for select to authenticated
  using (tenant_id = (select private.current_tenant()));

-- Escritura: admin o profesional habilitado, y SOLO mientras el informe está en borrador
-- (paridad con la inmutabilidad del informe definitivo: para corregir se reabre el informe).
create policy "report authors manage lab observations" on public.lab_observations for all to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and ((select private.current_role()) = 'admin' or public.can_sign_report(appointment_id))
    and exists (select 1 from public.radiology_reports r
                where r.id = lab_observations.report_id and r.tenant_id = lab_observations.tenant_id and r.status = 'draft')
  )
  with check (
    tenant_id = (select private.current_tenant())
    and ((select private.current_role()) = 'admin' or public.can_sign_report(appointment_id))
    and exists (select 1 from public.radiology_reports r
                where r.id = lab_observations.report_id and r.tenant_id = lab_observations.tenant_id and r.status = 'draft')
  );

grant select, insert, update, delete on public.lab_observations to authenticated;

create trigger audit_lab_observations after insert or update or delete on public.lab_observations
  for each row execute function private.audit_change();

notify pgrst, 'reload schema';
