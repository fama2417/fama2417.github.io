-- Base documental multiespecialidad sin duplicar profesionales, servicios ni permisos.
create unique index if not exists practitioners_profile_unique_idx
  on public.practitioners (profile_id) where profile_id is not null;

alter table public.radiology_reports
  add column content jsonb not null default '{}'::jsonb,
  add column content_schema_version smallint not null default 1,
  add constraint radiology_reports_content_object_check check (jsonb_typeof(content) = 'object'),
  add constraint radiology_reports_content_version_check check (content_schema_version = 1);

create or replace function private.build_report_content(
  p_category text,
  p_clinical_indication text,
  p_technique text,
  p_comparison text,
  p_findings text,
  p_impression text
) returns jsonb
language sql immutable set search_path = ''
as $$
  select case p_category
    when 'consultation' then jsonb_build_object(
      'reason', p_clinical_indication, 'history', p_technique, 'physicalExam', p_comparison,
      'assessment', p_findings, 'plan', p_impression
    )
    when 'laboratory' then jsonb_build_object(
      'request', p_clinical_indication, 'sampleMethod', p_technique, 'referenceValues', p_comparison,
      'results', p_findings, 'interpretation', p_impression
    )
    when 'pathology' then jsonb_build_object(
      'clinicalHistory', p_clinical_indication, 'specimenMacroscopy', p_technique, 'processing', p_comparison,
      'microscopy', p_findings, 'diagnosis', p_impression
    )
    when 'procedure' then jsonb_build_object(
      'indication', p_clinical_indication, 'technique', p_technique, 'incidents', p_comparison,
      'findings', p_findings, 'plan', p_impression
    )
    else jsonb_build_object(
      'clinicalIndication', p_clinical_indication, 'technique', p_technique, 'comparison', p_comparison,
      'findings', p_findings, 'impression', p_impression
    )
  end;
$$;

-- El backfill no modifica contenido clínico; evita que la inmutabilidad de informes finales lo bloquee.
alter table public.radiology_reports disable trigger protect_final_report;
alter table public.radiology_reports disable trigger validate_critical_report_communication;
alter table public.radiology_reports disable trigger audit_reports;
update public.radiology_reports set content = private.build_report_content(
  report_category, clinical_indication, technique, comparison, findings, impression
);
alter table public.radiology_reports enable trigger audit_reports;
alter table public.radiology_reports enable trigger validate_critical_report_communication;
alter table public.radiology_reports enable trigger protect_final_report;

create or replace function private.sync_report_content() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.content := private.build_report_content(
    new.report_category, new.clinical_indication, new.technique, new.comparison, new.findings, new.impression
  );
  new.content_schema_version := 1;
  return new;
end;
$$;

drop trigger if exists sync_report_content on public.radiology_reports;
create trigger sync_report_content
before insert or update of report_category, clinical_indication, technique, comparison, findings, impression
on public.radiology_reports for each row execute function private.sync_report_content();

-- Usa la relación FHIR existente: usuario -> Practitioner -> PractitionerRole -> HealthcareService.
create or replace function private.current_practitioner_can_report(p_appointment_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.appointments a
    join public.service_types st on st.id = a.service_type_id and st.tenant_id = a.tenant_id and st.active
    join public.healthcare_services hs on hs.id = st.healthcare_service_id and hs.tenant_id = a.tenant_id and hs.active
    join public.practitioner_roles pr on pr.healthcare_service_id = hs.id
      and pr.organization_id = hs.organization_id and pr.tenant_id = a.tenant_id and pr.active
    join public.practitioners p on p.id = pr.practitioner_id and p.tenant_id = a.tenant_id and p.active
    where a.id = p_appointment_id
      and a.tenant_id = private.current_tenant()
      and p.profile_id = (select auth.uid())
      and st.category = a.service_category
  );
$$;

create or replace function public.can_sign_report(p_appointment_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when private.current_role() = 'radiologist' then exists (
      select 1 from public.appointments a
      where a.id = p_appointment_id and a.tenant_id = private.current_tenant() and a.service_category = 'imaging'
    )
    when private.current_role() in ('admin', 'clinician') then private.current_practitioner_can_report(p_appointment_id)
    else false
  end;
$$;

drop policy if exists "radiology staff manage reports" on public.radiology_reports;
drop policy if exists "report authors manage reports" on public.radiology_reports;
create policy "report authors manage reports" on public.radiology_reports for all to authenticated
using (
  tenant_id = (select private.current_tenant())
  and ((select private.current_role()) = 'admin' or public.can_sign_report(appointment_id))
)
with check (
  tenant_id = (select private.current_tenant())
  and ((select private.current_role()) = 'admin' or public.can_sign_report(appointment_id))
);

create or replace function private.protect_final_report() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_category text;
  v_role public.clinical_role;
begin
  if tg_op = 'UPDATE' and old.status = 'final' then
    if new.status = 'draft' and (select private.current_role()) = 'admin'
       and exists (select 1 from public.report_reopenings r
                   where r.appointment_id = new.appointment_id and r.action = 'reopen'
                     and r.created_at > now() - interval '1 minute') then
      new.signed_by := null; new.signed_at := null; new.signer_name := ''; new.signer_registration := '';
      return new;
    end if;
    raise exception 'El informe definitivo es inmutable; agregue una adenda o reábralo como administrador';
  end if;

  select a.service_category into v_category
  from public.appointments a
  where a.id = new.appointment_id and a.tenant_id = new.tenant_id;
  if v_category is null or new.report_category is distinct from v_category then
    raise exception 'La categoría del documento no corresponde a la prestación';
  end if;

  if new.status = 'final' then
    if not public.can_sign_report(new.appointment_id) then
      raise exception 'El profesional no está habilitado para firmar esta prestación';
    end if;

    v_role := private.current_role();
    if v_role = 'radiologist' then
      select p.full_name, p.professional_registration
        into new.signer_name, new.signer_registration
      from public.profiles p where p.id = (select auth.uid());
    else
      select p.full_name, p.professional_registration
        into new.signer_name, new.signer_registration
      from public.practitioners p
      where p.profile_id = (select auth.uid()) and p.tenant_id = new.tenant_id and p.active;
    end if;
    if coalesce(length(trim(new.signer_registration)), 0) = 0 then
      raise exception 'Configure el registro profesional antes de firmar';
    end if;

    if new.report_category in ('imaging', 'consultation')
       and (length(trim(new.findings)) = 0 or length(trim(new.impression)) = 0) then
      raise exception 'Faltan las secciones obligatorias del documento';
    elsif new.report_category = 'laboratory' and length(trim(new.findings)) = 0 then
      raise exception 'Los resultados son obligatorios';
    elsif new.report_category = 'pathology' and length(trim(new.impression)) = 0 then
      raise exception 'El diagnóstico es obligatorio';
    elsif new.report_category = 'procedure'
       and (length(trim(new.technique)) = 0 or length(trim(new.impression)) = 0) then
      raise exception 'La técnica y la conclusión o plan son obligatorios';
    end if;
    if not new.identity_confirmed or not new.clinical_question_answered then
      raise exception 'Faltan las confirmaciones clínicas';
    end if;
    if new.critical_finding and length(trim(new.critical_finding_type)) = 0 then
      raise exception 'Indique el tipo de hallazgo crítico';
    end if;
    new.signed_by := (select auth.uid()); new.signed_at := now();
  end if;
  return new;
end;
$$;

drop policy if exists "report staff sign report addenda" on public.report_addenda;
create policy "report staff sign report addenda" on public.report_addenda for insert to authenticated
with check (tenant_id = (select private.current_tenant()) and public.can_sign_report(appointment_id));

create or replace function private.validate_report_addendum() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.can_sign_report(new.appointment_id)
     or not exists (select 1 from public.radiology_reports r
                    where r.appointment_id = new.appointment_id and r.tenant_id = new.tenant_id and r.status = 'final') then
    raise exception 'La adenda requiere un documento definitivo y un profesional habilitado';
  end if;
  new.signed_by := (select auth.uid()); new.signed_at := now();
  if private.current_role() = 'radiologist' then
    select p.full_name, p.professional_registration into new.signer_name, new.signer_registration
    from public.profiles p where p.id = (select auth.uid());
  else
    select p.full_name, p.professional_registration into new.signer_name, new.signer_registration
    from public.practitioners p
    where p.profile_id = (select auth.uid()) and p.tenant_id = new.tenant_id and p.active;
  end if;
  if coalesce(length(trim(new.signer_registration)), 0) = 0 then
    raise exception 'Configure el registro profesional antes de firmar';
  end if;
  return new;
end;
$$;

drop policy if exists "report staff record report communications" on public.report_communications;
create policy "report staff record report communications" on public.report_communications for insert to authenticated
with check (
  tenant_id = (select private.current_tenant()) and report_id is not null
  and ((select private.current_role()) = 'admin' or public.can_sign_report(appointment_id))
  and exists (select 1 from public.radiology_reports r
              where r.id = report_communications.report_id
                and r.appointment_id = report_communications.appointment_id
                and r.tenant_id = report_communications.tenant_id)
);

drop policy if exists "report staff create report follow ups" on public.report_follow_ups;
create policy "report staff create report follow ups" on public.report_follow_ups for insert to authenticated
with check (
  tenant_id = (select private.current_tenant())
  and ((select private.current_role()) = 'admin' or public.can_sign_report(appointment_id))
);

drop policy if exists "clinical users update report follow ups" on public.report_follow_ups;
create policy "clinical users update report follow ups" on public.report_follow_ups for update to authenticated
using (
  tenant_id = (select private.current_tenant())
  and ((select private.current_role()) in ('admin', 'operator') or public.can_sign_report(appointment_id))
)
with check (
  tenant_id = (select private.current_tenant())
  and ((select private.current_role()) in ('admin', 'operator') or public.can_sign_report(appointment_id))
);

revoke all on function private.build_report_content(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function private.sync_report_content() from public, anon, authenticated;
revoke all on function private.current_practitioner_can_report(uuid) from public, anon, authenticated;
revoke all on function public.can_sign_report(uuid) from public, anon;
grant execute on function public.can_sign_report(uuid) to authenticated;
revoke all on function private.protect_final_report() from public, anon, authenticated;
revoke all on function private.validate_report_addendum() from public, anon, authenticated;

notify pgrst, 'reload schema';
