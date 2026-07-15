-- PHR MVP: grants revocables desde un documento personal hacia una ficha institucional.
create table public.patient_document_shares (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.patient_documents(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  granted_by uuid not null references auth.users(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (revoked_at is null or revoked_at >= granted_at)
);

create unique index patient_document_shares_active_idx
on public.patient_document_shares (document_id, patient_id) where revoked_at is null;
create index patient_document_shares_patient_idx
on public.patient_document_shares (patient_id, granted_at desc);

alter table public.patient_document_shares enable row level security;
grant select on public.patient_document_shares to authenticated;
grant all on public.patient_document_shares to service_role;

create policy "owners read document shares" on public.patient_document_shares for select to authenticated
using (
  granted_by = (select auth.uid())
  and exists (
    select 1 from public.patients p
    where p.id = patient_id and p.user_id = (select auth.uid())
  )
);

create policy "staff read active shared documents" on public.patient_document_shares for select to authenticated
using (
  revoked_at is null
  and exists (
    select 1 from public.patients p
    where p.id = patient_id and p.tenant_id = (select private.current_tenant())
  )
);

create policy "staff read shared patient documents" on public.patient_documents for select to authenticated
using (
  exists (
    select 1
    from public.patient_document_shares s
    join public.patients p on p.id = s.patient_id
    where s.document_id = patient_documents.id
      and s.revoked_at is null
      and p.tenant_id = (select private.current_tenant())
  )
);

create or replace function private.current_tenant_can_read_patient_document(p_storage_path text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.patient_documents d
    join public.patient_document_shares s on s.document_id = d.id and s.revoked_at is null
    join public.patients p on p.id = s.patient_id
    where d.storage_path = p_storage_path
      and p.tenant_id = private.current_tenant()
  )
$$;
revoke all on function private.current_tenant_can_read_patient_document(text) from public, anon;
grant execute on function private.current_tenant_can_read_patient_document(text) to authenticated;

create policy "staff read shared patient document files" on storage.objects for select to authenticated
using (
  bucket_id = 'patient-documents'
  and private.current_tenant_can_read_patient_document(name)
);
