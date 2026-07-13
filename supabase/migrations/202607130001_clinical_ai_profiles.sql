create or replace function public.ai_usage_totals()
returns table (daily_count bigint, monthly_cost_usd numeric)
language sql stable security definer set search_path = ''
as $$
  select
    count(*) filter (where l.created_at >= current_date)::bigint,
    coalesce(sum(l.estimated_cost_usd) filter (where l.created_at >= date_trunc('month', current_date)), 0)::numeric
  from public.ai_usage_log l
  where l.tenant_id = private.current_tenant()
    and l.success
    and private.current_role() in ('admin', 'radiologist', 'clinician');
$$;

drop policy if exists "report staff manage report ai summaries" on public.report_ai_summaries;
create policy "report staff manage report ai summaries" on public.report_ai_summaries for all to authenticated
using (
  tenant_id = (select private.current_tenant())
  and (
    (select private.current_role()) = 'admin'
    or exists (
      select 1 from public.radiology_reports rr
      where rr.id = report_ai_summaries.report_id
        and rr.tenant_id = report_ai_summaries.tenant_id
        and public.can_sign_report(rr.appointment_id)
    )
  )
)
with check (
  tenant_id = (select private.current_tenant())
  and (
    (select private.current_role()) = 'admin'
    or exists (
      select 1 from public.radiology_reports rr
      where rr.id = report_ai_summaries.report_id
        and rr.tenant_id = report_ai_summaries.tenant_id
        and public.can_sign_report(rr.appointment_id)
    )
  )
);

drop policy if exists "report staff insert ai usage log" on public.ai_usage_log;
create policy "report staff insert ai usage log" on public.ai_usage_log for insert to authenticated
with check (
  tenant_id = (select private.current_tenant())
  and (
    (select private.current_role()) = 'admin'
    or exists (
      select 1 from public.radiology_reports rr
      where rr.id = ai_usage_log.report_id
        and rr.tenant_id = ai_usage_log.tenant_id
        and public.can_sign_report(rr.appointment_id)
    )
  )
  and (service_type_id is null or exists (
    select 1 from public.service_types st
    where st.id = ai_usage_log.service_type_id
      and st.tenant_id = ai_usage_log.tenant_id
  ))
);

revoke all on function public.ai_usage_totals() from public, anon;
grant execute on function public.ai_usage_totals() to authenticated;

notify pgrst, 'reload schema';
