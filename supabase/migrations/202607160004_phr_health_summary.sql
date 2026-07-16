-- Antecedentes estructurados y portables del registro personal.
create table public.phr_health_items (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('allergy', 'condition', 'medication', 'immunization', 'procedure')),
  label text not null check (length(trim(label)) between 1 and 1000),
  status text not null default 'active' check (status in ('active', 'inactive', 'completed')),
  event_date date,
  source text not null default 'patient' check (source in ('patient', 'document')),
  source_document_id uuid references public.patient_documents(id) on delete set null,
  notes text not null default '' check (length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index phr_health_items_owner_kind_idx
  on public.phr_health_items (owner_user_id, kind, status, event_date desc nulls last);

alter table public.phr_health_items enable row level security;
grant select on public.phr_health_items to authenticated;
grant all on public.phr_health_items to service_role;

create policy "owners and caregivers read health items" on public.phr_health_items for select to authenticated
using ((select private.can_read_phr_owner(owner_user_id)));

create trigger set_updated_at_phr_health_items before update on public.phr_health_items
for each row execute function private.set_updated_at();

-- Conserva la información ya declarada; separa sólo líneas o punto y coma para no romper nombres clínicos.
insert into public.phr_health_items (owner_user_id, kind, label)
select p.user_id, source.kind, trim(source.label)
from public.phr_profiles p
cross join lateral (
  select 'allergy'::text as kind, value as label from regexp_split_to_table(p.allergies, E'[\n;]+') value
  union all
  select 'condition', value from regexp_split_to_table(p.conditions, E'[\n;]+') value
  union all
  select 'medication', value from regexp_split_to_table(p.medications, E'[\n;]+') value
) source
where trim(source.label) <> '';

notify pgrst, 'reload schema';
