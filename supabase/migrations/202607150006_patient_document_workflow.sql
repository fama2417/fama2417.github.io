-- Solicitudes, revisión clínica append-only y copias institucionales del PHR.
alter table public.patient_documents drop constraint if exists patient_documents_mime_type_check;
alter table public.patient_documents add constraint patient_documents_mime_type_check
  check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'application/dicom'));

update storage.buckets set allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'application/dicom']
where id = 'patient-documents';

create table public.patient_document_requests (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  message text not null check (length(trim(message)) between 1 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check ((status = 'pending' and responded_at is null) or (status <> 'pending' and responded_at is not null))
);
create unique index patient_document_requests_pending_idx on public.patient_document_requests(patient_id) where status = 'pending';
alter table public.patient_document_requests enable row level security;
grant select on public.patient_document_requests to authenticated;
grant all on public.patient_document_requests to service_role;
create policy "patients read own document requests" on public.patient_document_requests for select to authenticated
using ((select private.current_patient_owns(patient_id)));
create policy "staff read tenant document requests" on public.patient_document_requests for select to authenticated
using (exists (select 1 from public.patients p where p.id = patient_id and p.tenant_id = (select private.current_tenant())));

create table public.patient_document_reviews (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.patient_documents(id) on delete set null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id),
  status text not null check (status in ('accepted', 'rejected')),
  note text not null default '' check (length(note) <= 1000),
  original_filename text not null,
  mime_type text not null,
  source_institution text not null,
  document_date date,
  clinical_storage_path text unique,
  created_at timestamptz not null default now(),
  check ((status = 'accepted' and clinical_storage_path is not null) or (status = 'rejected' and clinical_storage_path is null))
);
create unique index patient_document_reviews_accepted_idx on public.patient_document_reviews(document_id, patient_id)
where status = 'accepted' and document_id is not null;
create index patient_document_reviews_patient_idx on public.patient_document_reviews(patient_id, created_at desc);
alter table public.patient_document_reviews enable row level security;
grant select on public.patient_document_reviews to authenticated;
grant all on public.patient_document_reviews to service_role;
create policy "patients read own document reviews" on public.patient_document_reviews for select to authenticated
using ((select private.current_patient_owns(patient_id)));
create policy "staff read tenant document reviews" on public.patient_document_reviews for select to authenticated
using (exists (select 1 from public.patients p where p.id = patient_id and p.tenant_id = (select private.current_tenant())));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clinical-documents', 'clinical-documents', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png', 'application/dicom'])
on conflict (id) do nothing;

create or replace function private.current_tenant_can_read_clinical_document(p_storage_path text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.patient_document_reviews r
    join public.patients p on p.id = r.patient_id
    where r.clinical_storage_path = p_storage_path and p.tenant_id = private.current_tenant()
  )
$$;
revoke all on function private.current_tenant_can_read_clinical_document(text) from public, anon;
grant execute on function private.current_tenant_can_read_clinical_document(text) to authenticated;
create policy "staff read accepted clinical document files" on storage.objects for select to authenticated
using (bucket_id = 'clinical-documents' and private.current_tenant_can_read_clinical_document(name));
