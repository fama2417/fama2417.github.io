-- Fase 3C: el paciente vinculado puede leer el nombre de su institución y las capturas
-- (imágenes clave subidas al bucket 'capturas') de sus informes liberados. Solo SELECT.

-- Nombre de la institución del propio paciente (subconsulta bajo la RLS de patients: solo su fila).
drop policy if exists "patients read own tenant" on public.tenants;
create policy "patients read own tenant" on public.tenants for select to authenticated
using (id in (select p.tenant_id from public.patients p where p.user_id = (select auth.uid())));

-- Patrón del repo: GRANT explícito por tabla (tenants nunca lo tuvo en migraciones; RLS decide filas).
grant select on public.tenants to authenticated;

-- service_role es la clave confiable del servidor (API admin, seeds, E2E): en producción tiene
-- estos grants por defecto de Supabase, pero nunca quedaron en migraciones y un entorno limpio
-- no puede operar. RLS no aplica a service_role por diseño.
grant all on all tables in schema public to service_role;

-- Capturas de informes liberados: la ruta del objeto es <appointmentId>/captura-*.jpg|png.
-- Reutiliza el helper security definer de 3A; el guard de formato evita casts inválidos.
drop policy if exists "patients read released captures" on storage.objects;
create policy "patients read released captures" on storage.objects for select to authenticated
using (
  bucket_id = 'capturas'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and private.appointment_released_to_current_patient(((storage.foldername(name))[1])::uuid)
);

-- Restaura la rama de liberación al paciente perdida cuando 202607120003 redefinió
-- protect_final_report (regresión): sobre un informe final solo se permite (a) cambiar
-- únicamente las columnas released_to_patient_* (admin, vía RPC) o (b) reabrirlo con motivo,
-- lo que además revoca la liberación. Cualquier estado no final limpia la liberación.
create or replace function private.protect_final_report() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_category text;
  v_role public.clinical_role;
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
  else
    -- Un informe que no es final jamás puede quedar liberado.
    new.released_to_patient_at := null; new.released_to_patient_by := null;
  end if;
  return new;
end;
$$;
revoke all on function private.protect_final_report() from public, anon, authenticated;
