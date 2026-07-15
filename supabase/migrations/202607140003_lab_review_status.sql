-- Estado de revisión para resultados discretos. La ingesta por IA/OCR crea filas 'suggested' que un
-- profesional confirma antes de que cuenten en la ficha (regla clínica: la IA no se presenta como
-- confirmada). El ingreso previo (manual/pruebas) queda 'confirmed' por defecto para no ocultarlo.
alter table public.lab_observations
  add column review_status text not null default 'confirmed'
    check (review_status in ('suggested', 'confirmed'));

-- La tendencia en la ficha solo considera confirmados; los sugeridos se revisan en el informe.
create index lab_observations_confirmed_idx
  on public.lab_observations (patient_id, review_status);

-- Registra el uso de IA de la ingesta de laboratorio (extracción desde PDF).
alter table public.ai_usage_log drop constraint if exists ai_usage_log_request_type_check;
alter table public.ai_usage_log add constraint ai_usage_log_request_type_check
  check (request_type in (
    'extract_findings', 'classify_procedure', 'bootstrap_dictionary',
    'normalize_candidate', 'summarize_clinical_document', 'lab_ingest'
  ));

notify pgrst, 'reload schema';
