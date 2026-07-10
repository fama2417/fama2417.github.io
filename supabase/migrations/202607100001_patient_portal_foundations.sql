-- Fase 3A: fundaciones seguras del portal de paciente.
-- Identidad por vínculo (patients.user_id -> auth.users), liberación explícita de informes
-- y RLS de solo lectura para el paciente. Sin rol nuevo: un usuario paciente NO tiene fila
-- en profiles, por lo que private.current_role()/current_tenant() son null y todas las
-- políticas de staff lo niegan por defecto; solo obtiene las políticas nuevas de este archivo.

-- 1. Identidad ---------------------------------------------------------------
alter table public.patients add column if not exists user_id uuid unique references auth.users(id);

-- Solo admin vincula/desvincula la cuenta; el propio paciente no tiene UPDATE sobre patients.
create or replace function private.protect_patient_link() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.user_id is not null and (select private.current_role()) is distinct from 'admin' then
      raise exception 'Solo un administrador puede vincular una cuenta de paciente';
    end if;
  elsif new.user_id is distinct from old.user_id then
    if (select private.current_role()) is distinct from 'admin' then
      raise exception 'Solo un administrador puede vincular o desvincular una cuenta de paciente';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists protect_patient_link on public.patients;
create trigger protect_patient_link before insert or update on public.patients
for each row execute function private.protect_patient_link();
revoke all on function private.protect_patient_link() from public, anon, authenticated;

-- 2. Liberación de informes ---------------------------------------------------
alter table public.radiology_reports add column if not exists released_to_patient_at timestamptz;
alter table public.radiology_reports add column if not exists released_to_patient_by uuid references public.profiles(id);

-- Un borrador jamás puede estar liberado (cinturón; los triggers lo garantizan además).
alter table public.radiology_reports drop constraint if exists radiology_reports_release_only_final;
alter table public.radiology_reports add constraint radiology_reports_release_only_final
check (released_to_patient_at is null or status = 'final');

-- protect_final_report v3: sobre un informe final solo se permite
--  (a) reabrir como admin con motivo registrado (revoca la liberación automáticamente), o
--  (b) cambiar únicamente las columnas de liberación (admin, vía RPC).
create or replace function private.protect_final_report() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'final' then
    if new.status = 'final' and (select private.current_role()) = 'admin'
       and (to_jsonb(new) - 'released_to_patient_at' - 'released_to_patient_by')
         = (to_jsonb(old) - 'released_to_patient_at' - 'released_to_patient_by') then
      return new;
    end if;
    if new.status = 'draft' and (select private.current_role()) = 'admin'
       and exists (select 1 from public.report_reopenings r
                   where r.appointment_id = new.appointment_id and r.action = 'reopen'
                     and r.created_at > now() - interval '1 minute') then
      new.signed_by := null; new.signed_at := null; new.signer_name := ''; new.signer_registration := '';
      new.released_to_patient_at := null; new.released_to_patient_by := null;
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
  else
    -- Nunca puede quedar liberado un informe que no es final (p. ej. firmas nuevas desde borrador).
    new.released_to_patient_at := null; new.released_to_patient_by := null;
  end if;
  return new;
end;
$$;
revoke all on function private.protect_final_report() from public, anon, authenticated;

-- RPCs de liberación (mismo patrón que reopen_report/delete_report: una sola transacción, admin, tenant propio).
create or replace function public.release_report_to_patient(p_appointment_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if (select private.current_role()) is distinct from 'admin' then
    raise exception 'Solo administradores pueden liberar informes al paciente';
  end if;
  update public.radiology_reports
  set released_to_patient_at = now(), released_to_patient_by = (select auth.uid())
  where appointment_id = p_appointment_id
    and tenant_id = (select private.current_tenant())
    and status = 'final'
    and released_to_patient_at is null;
  if not found then
    raise exception 'Solo un informe definitivo no liberado puede liberarse al paciente';
  end if;
end;
$$;

create or replace function public.revoke_report_release(p_appointment_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if (select private.current_role()) is distinct from 'admin' then
    raise exception 'Solo administradores pueden revocar la liberación de un informe';
  end if;
  update public.radiology_reports
  set released_to_patient_at = null, released_to_patient_by = null
  where appointment_id = p_appointment_id
    and tenant_id = (select private.current_tenant())
    and released_to_patient_at is not null;
  if not found then
    raise exception 'No existe una liberación vigente para revocar';
  end if;
end;
$$;

revoke all on function public.release_report_to_patient(uuid) from public, anon;
revoke all on function public.revoke_report_release(uuid) from public, anon;
grant execute on function public.release_report_to_patient(uuid) to authenticated;
grant execute on function public.revoke_report_release(uuid) to authenticated;

-- 3. Helpers de identidad del paciente ---------------------------------------
create or replace function private.current_patient_id() returns uuid
language sql stable security definer set search_path = ''
as $$ select id from public.patients where user_id = (select auth.uid()) $$;
grant execute on function private.current_patient_id() to authenticated;

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
      and a.patient_id = private.current_patient_id()
  )
$$;
grant execute on function private.appointment_released_to_current_patient(uuid) to authenticated;

-- 4. RLS del paciente (solo SELECT; sin políticas de escritura => escritura negada) -----
drop policy if exists "patients read own record" on public.patients;
create policy "patients read own record" on public.patients for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "patients read own appointments" on public.appointments;
create policy "patients read own appointments" on public.appointments for select to authenticated
using (patient_id = (select private.current_patient_id()));

drop policy if exists "patients read own study metadata" on public.imaging_studies;
create policy "patients read own study metadata" on public.imaging_studies for select to authenticated
using (exists (select 1 from public.appointments a
               where a.id = appointment_id and a.patient_id = (select private.current_patient_id())));

drop policy if exists "patients read released final reports" on public.radiology_reports;
create policy "patients read released final reports" on public.radiology_reports for select to authenticated
using (status = 'final' and released_to_patient_at is not null
  and exists (select 1 from public.appointments a
              where a.id = appointment_id and a.patient_id = (select private.current_patient_id())));

drop policy if exists "patients read released addenda" on public.report_addenda;
create policy "patients read released addenda" on public.report_addenda for select to authenticated
using ((select private.appointment_released_to_current_patient(appointment_id)));

drop policy if exists "patients read released key images" on public.report_key_images;
create policy "patients read released key images" on public.report_key_images for select to authenticated
using ((select private.appointment_released_to_current_patient(appointment_id)));

-- 5. Catálogos que eran legibles por cualquier autenticado: solo staff con tenant. ------
drop policy if exists "authenticated read ai model pricing" on public.ai_model_pricing;
create policy "staff read ai model pricing" on public.ai_model_pricing for select to authenticated
using ((select private.current_tenant()) is not null);

drop policy if exists "authenticated read terminology" on public.terminology_codes;
create policy "staff read terminology" on public.terminology_codes for select to authenticated
using ((select private.current_tenant()) is not null);
