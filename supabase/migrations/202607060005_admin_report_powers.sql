-- Poderes de administración sobre el informe (las migraciones 050005/050006 nunca se aplicaron):
-- admin puede firmar, adendar, comunicar, crear seguimientos; reabrir/eliminar con registro de motivo;
-- adjuntar imágenes clave a una adenda tras la firma; y asignar informes (solo admin).

-- 1. Permisos admin en las acciones del informe
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

drop policy if exists "radiology staff manage reports" on public.radiology_reports;
create policy "radiology staff manage reports" on public.radiology_reports for all to authenticated
using (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'radiologist'))
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'radiologist'));

-- 2. Registro auditado de reapertura/eliminación (motivo obligatorio)
create table if not exists public.report_reopenings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  appointment_id uuid not null references public.appointments(id),
  action text not null check (action in ('reopen', 'delete')),
  reason text not null check (length(trim(reason)) > 0),
  actor_id uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.report_reopenings enable row level security;
drop policy if exists "admins read reopenings" on public.report_reopenings;
drop policy if exists "admins log reopenings" on public.report_reopenings;
create policy "admins read reopenings" on public.report_reopenings for select to authenticated
using (tenant_id = (select private.current_tenant()) and (select private.current_role()) = 'admin');
create policy "admins log reopenings" on public.report_reopenings for insert to authenticated
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) = 'admin');
drop trigger if exists audit_report_reopenings on public.report_reopenings;
create trigger audit_report_reopenings after insert on public.report_reopenings for each row execute function private.audit_change();

-- 3. Firmar admin+radiólogo; admin reabre (final->draft) si registró el motivo hace <1 min
create or replace function private.protect_final_report() returns trigger
language plpgsql security definer set search_path = ''
as $$
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

  if new.status = 'final' then
    if not coalesce((select private.current_role()) in ('admin', 'radiologist'), false) then
      raise exception 'Solo administración o radiología pueden firmar el informe';
    end if;
    select p.full_name, p.professional_registration into new.signer_name, new.signer_registration
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
    if new.critical_finding and (length(trim(new.critical_finding_type)) = 0 or not exists (
        select 1 from public.report_communications c
        where c.appointment_id = new.appointment_id and c.tenant_id = new.tenant_id
          and c.urgency = 'critical' and c.acknowledged)) then
      raise exception 'El hallazgo crítico requiere comunicación confirmada';
    end if;
    new.signed_by := (select auth.uid()); new.signed_at := now();
  end if;
  return new;
end;
$$;

-- 4. Adenda: admin+radiólogo
create or replace function private.validate_report_addendum() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not coalesce((select private.current_role()) in ('admin', 'radiologist'), false)
     or not exists (select 1 from public.radiology_reports r
                    where r.appointment_id = new.appointment_id and r.tenant_id = new.tenant_id and r.status = 'final') then
    raise exception 'La adenda requiere un informe definitivo y firma de administración o radiología';
  end if;
  new.signed_by := (select auth.uid()); new.signed_at := now();
  select p.full_name, p.professional_registration into new.signer_name, new.signer_registration
    from public.profiles p where p.id = (select auth.uid());
  if length(trim(new.signer_registration)) = 0 then
    raise exception 'Configure el registro profesional antes de firmar';
  end if;
  return new;
end;
$$;

-- 5. Asignación de informes: solo admin, a un radiólogo del mismo tenant
create or replace function private.protect_report_assignment() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.assigned_to is distinct from old.assigned_to then
    if (select private.current_role()) is distinct from 'admin' then
      raise exception 'Solo un administrador puede asignar informes';
    end if;
    if new.assigned_to is not null and not exists (
      select 1 from public.profiles p where p.id = new.assigned_to
        and p.tenant_id = new.tenant_id and p.role = 'radiologist') then
      raise exception 'El usuario asignado debe ser un radiólogo de la institución';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists protect_report_assignment on public.appointments;
create trigger protect_report_assignment before update on public.appointments
for each row execute function private.protect_report_assignment();

-- 6. Imágenes clave adjuntas a una adenda (permitidas tras la firma)
alter table public.report_key_images add column if not exists addendum_id uuid references public.report_addenda(id);

create or replace function private.protect_key_images() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- Las imágenes del informe base quedan congeladas al firmar; las de una adenda sí se insertan después.
  if coalesce(new.addendum_id, old.addendum_id) is null
     and exists (select 1 from public.radiology_reports r
                 where r.appointment_id = coalesce(new.appointment_id, old.appointment_id)
                   and r.tenant_id = coalesce(new.tenant_id, old.tenant_id) and r.status = 'final') then
    raise exception 'El informe definitivo es inmutable; adjunte las imágenes a una adenda';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function private.protect_final_report() from public, anon, authenticated;
revoke all on function private.validate_report_addendum() from public, anon, authenticated;
revoke all on function private.protect_report_assignment() from public, anon, authenticated;
revoke all on function private.protect_key_images() from public, anon, authenticated;
