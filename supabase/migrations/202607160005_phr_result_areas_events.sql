-- Área clínica del resultado: document_type conserva el tipo técnico y esta columna
-- permite organizar informes de otras especialidades sin multiplicar tipos de archivo.
alter table public.patient_documents
  add column clinical_area text not null default 'other',
  add constraint patient_documents_clinical_area_check check (clinical_area in (
    'laboratory', 'imaging', 'pathology', 'cardiology', 'gastroenterology', 'gynecology',
    'neurology', 'pulmonology', 'ophthalmology', 'otolaryngology', 'urology', 'dermatology', 'other'
  ));

update public.patient_documents set clinical_area = case document_type
  when 'laboratory' then 'laboratory'
  when 'imaging' then 'imaging'
  else 'other'
end;

create index patient_documents_owner_area_date_idx
on public.patient_documents (owner_user_id, clinical_area, document_date desc);

-- Eventos mínimos para validar uso repetido, fallos, tiempos y costo sin guardar contenido clínico.
create table public.phr_product_events (
  id bigint generated always as identity primary key,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid references public.patient_documents(id) on delete cascade,
  event_name text not null check (length(event_name) between 1 and 64),
  properties jsonb not null default '{}'::jsonb check (jsonb_typeof(properties) = 'object'),
  created_at timestamptz not null default now()
);

create index phr_product_events_owner_created_idx on public.phr_product_events (owner_user_id, created_at desc);
create index phr_product_events_name_created_idx on public.phr_product_events (event_name, created_at desc);

alter table public.phr_product_events enable row level security;
grant select on public.phr_product_events to authenticated;
grant all on public.phr_product_events to service_role;
create policy "owners read own PHR product events" on public.phr_product_events for select to authenticated
using (owner_user_id = (select auth.uid()));

notify pgrst, 'reload schema';
