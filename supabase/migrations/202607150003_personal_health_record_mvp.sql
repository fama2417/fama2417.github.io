-- PHR MVP: una cuenta puede estar vinculada a una ficha por institución y guardar
-- documentos personales fuera de cualquier tenant.

-- El vínculo sigue viviendo en patients.user_id, pero deja de ser globalmente único.
alter table public.patients drop constraint if exists patients_user_id_key;
create unique index if not exists patients_tenant_user_idx
on public.patients (tenant_id, user_id) where user_id is not null;

create or replace function private.current_patient_owns(p_patient_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.patients p
    where p.id = p_patient_id and p.user_id = (select auth.uid())
  )
$$;
revoke all on function private.current_patient_owns(uuid) from public, anon;
grant execute on function private.current_patient_owns(uuid) to authenticated;

create or replace function private.appointment_released_to_current_patient(p_appointment_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.radiology_reports r
    join public.appointments a on a.id = r.appointment_id
    where r.appointment_id = p_appointment_id
      and r.status = 'final'
      and r.released_to_patient_at is not null
      and private.current_patient_owns(a.patient_id)
  )
$$;
revoke all on function private.appointment_released_to_current_patient(uuid) from public, anon;
grant execute on function private.appointment_released_to_current_patient(uuid) to authenticated;

drop policy if exists "patients read own appointments" on public.appointments;
create policy "patients read own appointments" on public.appointments for select to authenticated
using ((select private.current_patient_owns(patient_id)));

drop policy if exists "patients read own study metadata" on public.imaging_studies;
create policy "patients read own study metadata" on public.imaging_studies for select to authenticated
using (exists (
  select 1 from public.appointments a
  where a.id = appointment_id and private.current_patient_owns(a.patient_id)
));

drop policy if exists "patients read released final reports" on public.radiology_reports;
create policy "patients read released final reports" on public.radiology_reports for select to authenticated
using (
  status = 'final' and released_to_patient_at is not null
  and exists (
    select 1 from public.appointments a
    where a.id = appointment_id and private.current_patient_owns(a.patient_id)
  )
);

drop function if exists private.current_patient_id();

-- Los binarios viven en Storage; Postgres conserva metadata, propiedad y auditoría.
create table public.patient_documents (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  original_filename text not null check (length(trim(original_filename)) between 1 and 255),
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  document_date date,
  document_type text not null default 'other'
    check (document_type in ('imaging', 'laboratory', 'prescription', 'other')),
  source_institution text not null check (length(trim(source_institution)) between 1 and 160),
  created_at timestamptz not null default now()
);

create index patient_documents_owner_created_idx
on public.patient_documents (owner_user_id, created_at desc);

alter table public.patient_documents enable row level security;
grant select on public.patient_documents to authenticated;
grant all on public.patient_documents to service_role;

create policy "owners read personal documents" on public.patient_documents for select to authenticated
using (owner_user_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'patient-documents', 'patient-documents', false, 20971520,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do nothing;

create policy "owners read personal document files" on storage.objects for select to authenticated
using (
  bucket_id = 'patient-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
