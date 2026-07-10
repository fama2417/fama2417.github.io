-- Fase 3A.1: exclusión mutua entre identidad de staff (profiles) y de paciente (patients.user_id).
-- Defensa en BD en ambos sentidos; las filas existentes no se tocan (solo se validan escrituras nuevas).

-- Al vincular un paciente: la cuenta objetivo no puede ser staff.
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
  if new.user_id is not null
     and (tg_op = 'INSERT' or new.user_id is distinct from old.user_id)
     and exists (select 1 from public.profiles p where p.id = new.user_id) then
    raise exception 'La cuenta ya pertenece al staff (profiles) y no puede vincularse como paciente';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_patient_link() from public, anon, authenticated;

-- Al crear (o re-apuntar) un perfil de staff: la cuenta no puede estar vinculada como paciente.
create or replace function private.protect_staff_identity() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.patients where user_id = new.id) then
    raise exception 'La cuenta ya está vinculada como paciente y no puede tener perfil de staff';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_staff_identity on public.profiles;
create trigger protect_staff_identity before insert or update of id on public.profiles
for each row execute function private.protect_staff_identity();
revoke all on function private.protect_staff_identity() from public, anon, authenticated;

-- Los helpers de identidad de 3A quedaron con el EXECUTE por defecto para public/anon: mínimo privilegio.
revoke all on function private.current_patient_id() from public, anon;
revoke all on function private.appointment_released_to_current_patient(uuid) from public, anon;
grant execute on function private.current_patient_id() to authenticated;
grant execute on function private.appointment_released_to_current_patient(uuid) to authenticated;

-- Grants explícitos que faltaban en migraciones para las tablas de informes (el patrón del repo
-- es GRANT por tabla, ver 202607020002; estas tablas solo tenían grants fuera de banda en
-- producción y sin ellos un entorno limpio no puede operar informes ni el portal). GRANT es
-- idempotente y no debilita nada: RLS sigue decidiendo las filas.
grant select on public.radiology_reports, public.report_addenda, public.report_key_images,
  public.report_communications, public.extracted_findings to authenticated;
grant insert, update, delete on public.radiology_reports, public.report_addenda,
  public.report_key_images, public.report_communications to authenticated;
