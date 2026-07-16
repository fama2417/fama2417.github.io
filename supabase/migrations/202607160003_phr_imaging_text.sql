alter table public.patient_documents
  add column extracted_text jsonb not null default '{}'::jsonb,
  add column text_extracted_at timestamptz,
  add constraint patient_documents_extracted_text_object check (jsonb_typeof(extracted_text) = 'object');
