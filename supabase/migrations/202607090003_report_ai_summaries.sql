create table public.report_ai_summaries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  report_id uuid not null references public.radiology_reports(id) on delete cascade,
  summary_json jsonb not null,
  model text,
  provider text not null default 'openai' check (provider in ('openai')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, report_id)
);

create index report_ai_summaries_report_idx on public.report_ai_summaries (report_id);

alter table public.report_ai_summaries enable row level security;

create policy "tenant reads report ai summaries" on public.report_ai_summaries for select to authenticated
using (tenant_id = (select private.current_tenant()));

create policy "report staff manage report ai summaries" on public.report_ai_summaries for all to authenticated
using (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'radiologist'))
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'radiologist')
  and exists (select 1 from public.radiology_reports rr where rr.id = report_id and rr.tenant_id = (select private.current_tenant())));

create trigger set_updated_at_report_ai_summaries before update on public.report_ai_summaries
for each row execute function private.set_updated_at();

create trigger audit_report_ai_summaries after insert or update or delete on public.report_ai_summaries
for each row execute function private.audit_change();
