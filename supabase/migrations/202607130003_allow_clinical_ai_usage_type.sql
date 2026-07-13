alter table public.ai_usage_log
  drop constraint if exists ai_usage_log_request_type_check;

alter table public.ai_usage_log
  add constraint ai_usage_log_request_type_check
  check (request_type in (
    'extract_findings',
    'classify_procedure',
    'bootstrap_dictionary',
    'normalize_candidate',
    'summarize_clinical_document'
  ));
