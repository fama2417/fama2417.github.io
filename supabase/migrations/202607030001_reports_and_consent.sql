alter table public.patients add column privacy_consent_at timestamptz;

create type public.report_status as enum ('draft', 'final');

create table public.radiology_reports (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references public.appointments(id),
  clinical_indication text not null default '',
  technique text not null default '',
  comparison text not null default '',
  findings text not null default '',
  impression text not null default '',
  status public.report_status not null default 'draft',
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger audit_reports after insert or update or delete on public.radiology_reports for each row execute function private.audit_change();

alter table public.radiology_reports enable row level security;

create policy "clinical users read reports" on public.radiology_reports for select to authenticated using (true);
create policy "radiology staff manage reports" on public.radiology_reports for all to authenticated
using ((select private.current_role()) in ('admin', 'radiologist'))
with check ((select private.current_role()) in ('admin', 'radiologist'));
