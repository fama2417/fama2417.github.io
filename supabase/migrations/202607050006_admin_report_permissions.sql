-- Administradores y radiólogos comparten las acciones de la ventana de informe.
drop policy if exists "radiologists record report communications" on public.report_communications;
drop policy if exists "report staff record report communications" on public.report_communications;
create policy "report staff record report communications" on public.report_communications for insert to authenticated
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'radiologist')
  and exists (select 1 from public.appointments a where a.id = appointment_id and a.tenant_id = (select private.current_tenant())));

drop policy if exists "radiologists sign report addenda" on public.report_addenda;
drop policy if exists "report staff sign report addenda" on public.report_addenda;
create policy "report staff sign report addenda" on public.report_addenda for insert to authenticated
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'radiologist')
  and exists (select 1 from public.appointments a where a.id = appointment_id and a.tenant_id = (select private.current_tenant())));

drop policy if exists "radiologists create report follow ups" on public.report_follow_ups;
drop policy if exists "report staff create report follow ups" on public.report_follow_ups;
create policy "report staff create report follow ups" on public.report_follow_ups for insert to authenticated
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'radiologist')
  and exists (select 1 from public.appointments a where a.id = appointment_id and a.tenant_id = (select private.current_tenant())));

create or replace function private.protect_final_report() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'final' then
    raise exception 'El informe definitivo es inmutable; agregue una adenda';
  end if;

  if new.status = 'final' then
    if not coalesce((select private.current_role()) in ('admin', 'radiologist'), false) then
      raise exception 'Solo administración o radiología pueden firmar el informe';
    end if;
    select p.full_name, p.professional_registration
      into new.signer_name, new.signer_registration
      from public.profiles p where p.id = (select auth.uid());
    if length(trim(new.signer_registration)) = 0 then
      raise exception 'Configure el registro profesional antes de firmar';
    end if;
    if length(trim(new.findings)) = 0 or length(trim(new.impression)) = 0 then
      raise exception 'Hallazgos e impresión son obligatorios';
    end if;
    if not new.identity_confirmed or not new.clinical_question_answered then
      raise exception 'Faltan las confirmaciones clínicas';
    end if;
    if new.critical_finding and (
      length(trim(new.critical_finding_type)) = 0 or not exists (
        select 1 from public.report_communications c
        where c.appointment_id = new.appointment_id
          and c.tenant_id = new.tenant_id
          and c.urgency = 'critical'
          and c.acknowledged
      )
    ) then
      raise exception 'El hallazgo crítico requiere comunicación confirmada';
    end if;
    new.signed_by := (select auth.uid());
    new.signed_at := now();
  end if;
  return new;
end;
$$;

create or replace function private.validate_report_addendum() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not coalesce((select private.current_role()) in ('admin', 'radiologist'), false)
     or not exists (
       select 1 from public.radiology_reports r
       where r.appointment_id = new.appointment_id
         and r.tenant_id = new.tenant_id
         and r.status = 'final'
     ) then
    raise exception 'La adenda requiere un informe definitivo y firma de administración o radiología';
  end if;
  new.signed_by := (select auth.uid());
  new.signed_at := now();
  select p.full_name, p.professional_registration
    into new.signer_name, new.signer_registration
    from public.profiles p where p.id = (select auth.uid());
  if length(trim(new.signer_registration)) = 0 then
    raise exception 'Configure el registro profesional antes de firmar';
  end if;
  return new;
end;
$$;
