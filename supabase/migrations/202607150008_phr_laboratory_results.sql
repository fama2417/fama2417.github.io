-- Resultados de laboratorio personales derivados de documentos PHR. El PDF original permanece
-- en patient-documents y estas filas son sugerencias editables hasta que el propietario confirma.
alter table public.patient_documents
  add constraint patient_documents_id_owner_key unique (id, owner_user_id);

create table public.phr_lab_imports (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null,
  extraction_method text not null check (extraction_method in ('local', 'ai_text', 'ai_visual')),
  patient_name text not null default '',
  patient_identifier text not null default '',
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  created_at timestamptz not null default now(),
  unique (document_id),
  unique (id, owner_user_id, document_id),
  foreign key (document_id, owner_user_id)
    references public.patient_documents(id, owner_user_id) on delete cascade
);

create table public.phr_lab_results (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null,
  import_id uuid not null,
  loinc_code text not null default '',
  analyte text not null check (length(trim(analyte)) between 1 and 160),
  value_num numeric,
  value_text text not null default '' check (length(value_text) <= 80),
  unit text not null default '' check (length(unit) <= 32),
  ref_low numeric,
  ref_high numeric,
  ref_text text not null default '' check (length(ref_text) <= 120),
  flag text not null default ''
    check (flag in ('', 'normal', 'low', 'high', 'critical_low', 'critical_high', 'abnormal')),
  observed_at date not null,
  source text not null check (source in ('ocr', 'ai')),
  source_sentence text not null default '',
  review_status text not null default 'suggested' check (review_status in ('suggested', 'confirmed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint phr_lab_result_has_value check (value_num is not null or length(trim(value_text)) > 0),
  foreign key (import_id, owner_user_id, document_id)
    references public.phr_lab_imports(id, owner_user_id, document_id) on delete cascade
);

create index phr_lab_imports_owner_created_idx on public.phr_lab_imports (owner_user_id, created_at desc);
create index phr_lab_results_owner_date_idx on public.phr_lab_results (owner_user_id, observed_at desc);
create index phr_lab_results_trend_idx on public.phr_lab_results (owner_user_id, loinc_code, analyte, observed_at);

alter table public.phr_lab_imports enable row level security;
alter table public.phr_lab_results enable row level security;

grant select on public.phr_lab_imports, public.phr_lab_results to authenticated;
grant all on public.phr_lab_imports, public.phr_lab_results to service_role;

create policy "owners read own PHR lab imports" on public.phr_lab_imports for select to authenticated
using (owner_user_id = (select auth.uid()));

create policy "owners read own PHR lab results" on public.phr_lab_results for select to authenticated
using (owner_user_id = (select auth.uid()));

create trigger set_updated_at_phr_lab_results before update on public.phr_lab_results
for each row execute function private.set_updated_at();

notify pgrst, 'reload schema';
