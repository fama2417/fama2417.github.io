-- Pruebas RLS Fase 3A (portal de paciente). Reproducible y sin efectos: todo dentro de
-- una transacción que termina en ROLLBACK. Ejecutar como superusuario del proyecto:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/patient_portal_rls_test.sql
-- Si todas las pruebas pasan, la última línea impresa es: OK: pruebas RLS del portal de paciente.

begin;

-- Semillas -------------------------------------------------------------------
insert into public.tenants (id, name) values ('f0000000-0000-0000-0000-000000000001', 'Tenant RLS Test');

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'rls-admin@test.local'),
  ('a0000000-0000-0000-0000-00000000000b', 'rls-radiologo@test.local'),
  ('a0000000-0000-0000-0000-0000000000aa', 'rls-paciente-a@test.local'),
  ('a0000000-0000-0000-0000-0000000000bb', 'rls-paciente-b@test.local');

insert into public.profiles (id, full_name, role, tenant_id, professional_registration) values
  ('a0000000-0000-0000-0000-00000000000a', 'Admin RLS', 'admin', 'f0000000-0000-0000-0000-000000000001', 'ADM-1'),
  ('a0000000-0000-0000-0000-00000000000b', 'Radiólogo RLS', 'radiologist', 'f0000000-0000-0000-0000-000000000001', 'RM-123');

-- Los pacientes A y B, vinculados a sus cuentas (como postgres el trigger admite: current_role() null solo bloquea user_id en INSERT no-admin; validamos aparte).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
insert into public.patients (id, identifier, full_name, birth_date, sex, tenant_id, created_by, user_id) values
  ('b0000000-0000-0000-0000-00000000000a', '11.111.111-1', 'Paciente A', '1990-01-01', 'male', 'f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000aa'),
  ('b0000000-0000-0000-0000-00000000000b', '22.222.222-2', 'Paciente B', '1991-02-02', 'female', 'f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000bb');

-- Citas: A1 (informe final liberado), A2 (borrador), A3 (final sin liberar), B1 (final liberado de B).
insert into public.appointments (id, patient_id, appointment_date, start_time, end_time, practitioner_name, location_name, modality, reason, status, service_category, tenant_id, created_by) values
  ('c0000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-00000000000a', '2026-07-01', '08:00', '08:30', 'Dr. X', 'Sala 1', 'CT', 'Examen A1', 'completed', 'imaging', 'f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a'),
  ('c0000000-0000-0000-0000-0000000000a2', 'b0000000-0000-0000-0000-00000000000a', '2026-07-02', '08:00', '08:30', 'Dr. X', 'Sala 2', 'US', 'Examen A2', 'completed', 'imaging', 'f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a'),
  ('c0000000-0000-0000-0000-0000000000a3', 'b0000000-0000-0000-0000-00000000000a', '2026-07-03', '08:00', '08:30', 'Dr. X', 'Sala 3', 'MR', 'Examen A3', 'completed', 'imaging', 'f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a'),
  ('c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b', '2026-07-04', '08:00', '08:30', 'Dr. X', 'Sala 4', 'CT', 'Examen B1', 'completed', 'imaging', 'f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a');

insert into public.imaging_studies (id, appointment_id, tenant_id, orthanc_study_id, study_instance_uid) values
  ('d0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-000000000001', 'orthanc-a1', '1.2.3.a1'),
  ('d0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-000000000001', 'orthanc-b1', '1.2.3.b1');

-- Informes: se firman con claims de radiólogo (los triggers exigen rol y registro profesional).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
insert into public.radiology_reports (id, appointment_id, tenant_id, created_by, findings, impression, identity_confirmed, clinical_question_answered, report_code, report_code_display, status) values
  ('e0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000b', 'Hallazgos A1', 'Impresión A1', true, true, 'RLS-1', 'Examen RLS', 'final'),
  ('e0000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-0000000000a2', 'f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000b', 'Borrador A2', '', false, false, '', '', 'draft'),
  ('e0000000-0000-0000-0000-0000000000a3', 'c0000000-0000-0000-0000-0000000000a3', 'f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000b', 'Hallazgos A3', 'Impresión A3', true, true, 'RLS-1', 'Examen RLS', 'final'),
  ('e0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000b', 'Hallazgos B1', 'Impresión B1', true, true, 'RLS-1', 'Examen RLS', 'final');

-- Adenda sobre A1 (final) y sobre A3 (final sin liberar).
insert into public.report_addenda (appointment_id, tenant_id, text) values
  ('c0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-000000000001', 'Adenda A1'),
  ('c0000000-0000-0000-0000-0000000000a3', 'f0000000-0000-0000-0000-000000000001', 'Adenda A3');

-- Imagen clave adjunta a la adenda de A1 y de A3 (las del informe base están congeladas tras la firma).
insert into public.report_key_images (appointment_id, tenant_id, instance_id, addendum_id, created_by)
select a.appointment_id, a.tenant_id, 'instance-' || a.appointment_id, a.id, 'a0000000-0000-0000-0000-00000000000b'
from public.report_addenda a;

-- Comunicación crítica sobre el informe de A1 (el paciente no debe verla).
insert into public.report_communications (appointment_id, report_id, tenant_id, urgency, recipient, channel, communicated_at, created_by)
values ('c0000000-0000-0000-0000-0000000000a1', 'e0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-000000000001', 'critical', 'Dr. Tratante', 'phone', now(), 'a0000000-0000-0000-0000-00000000000b');

-- Liberaciones: A1 y B1 con claims de admin, vía RPC.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select public.release_report_to_patient('c0000000-0000-0000-0000-0000000000a1');
select public.release_report_to_patient('c0000000-0000-0000-0000-0000000000b1');

-- No se puede liberar un borrador.
do $$ begin
  begin
    perform public.release_report_to_patient('c0000000-0000-0000-0000-0000000000a2');
    raise exception 'FALLA: se liberó un borrador';
  exception when others then
    if sqlerrm like 'FALLA:%' then raise; end if;
  end;
end $$;

-- Pruebas como Paciente A ------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

do $$
declare n int;
begin
  select count(*) into n from public.patients;
  if n <> 1 then raise exception 'FALLA: paciente A ve % filas de patients (esperaba 1: la suya)', n; end if;
  select count(*) into n from public.patients where id = 'b0000000-0000-0000-0000-00000000000b';
  if n <> 0 then raise exception 'FALLA: paciente A ve la fila del paciente B'; end if;

  select count(*) into n from public.appointments;
  if n <> 3 then raise exception 'FALLA: paciente A ve % citas (esperaba sus 3)', n; end if;

  select count(*) into n from public.imaging_studies;
  if n <> 1 then raise exception 'FALLA: paciente A ve % estudios (esperaba 1, el suyo)', n; end if;

  select count(*) into n from public.radiology_reports;
  if n <> 1 then raise exception 'FALLA: paciente A ve % informes (esperaba solo A1 liberado)', n; end if;
  select count(*) into n from public.radiology_reports where status = 'draft';
  if n <> 0 then raise exception 'FALLA: paciente A ve borradores'; end if;
  select count(*) into n from public.radiology_reports where appointment_id = 'c0000000-0000-0000-0000-0000000000a3';
  if n <> 0 then raise exception 'FALLA: paciente A ve un final sin liberar'; end if;
  select count(*) into n from public.radiology_reports where appointment_id = 'c0000000-0000-0000-0000-0000000000b1';
  if n <> 0 then raise exception 'FALLA: paciente A ve el informe liberado del paciente B'; end if;

  select count(*) into n from public.report_addenda;
  if n <> 1 then raise exception 'FALLA: paciente A ve % addenda (esperaba solo la de A1 liberado)', n; end if;
  select count(*) into n from public.report_key_images;
  if n <> 1 then raise exception 'FALLA: paciente A ve % imágenes clave (esperaba solo la de A1)', n; end if;

  select count(*) into n from public.report_communications;
  if n <> 0 then raise exception 'FALLA: paciente A ve comunicaciones críticas'; end if;
  select count(*) into n from public.audit_log;
  if n <> 0 then raise exception 'FALLA: paciente A ve audit_log'; end if;
  select count(*) into n from public.profiles;
  if n <> 0 then raise exception 'FALLA: paciente A ve perfiles de otros usuarios'; end if;

  -- Escritura clínica negada (RLS: cero filas afectadas, sin políticas de escritura).
  update public.patients set phone = 'hack' where id = 'b0000000-0000-0000-0000-00000000000a';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLA: paciente A actualizó su ficha clínica'; end if;
  update public.radiology_reports set findings = 'hack';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLA: paciente A actualizó un informe'; end if;
  begin
    insert into public.appointments (patient_id, appointment_date, start_time, end_time, practitioner_name, location_name, modality, reason, tenant_id, created_by)
    values ('b0000000-0000-0000-0000-00000000000a', '2026-08-01', '08:00', '08:30', 'X', 'X', 'CT', 'hack', 'f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000aa');
    raise exception 'FALLA: paciente A insertó una cita';
  exception when others then
    if sqlerrm like 'FALLA:%' then raise; end if;
  end;
end $$;

-- El paciente no puede liberar ni revocar informes.
do $$ begin
  begin
    perform public.revoke_report_release('c0000000-0000-0000-0000-0000000000a1');
    raise exception 'FALLA: paciente A revocó una liberación';
  exception when others then
    if sqlerrm like 'FALLA:%' then raise; end if;
  end;
end $$;

-- Pruebas como staff (admin) ----------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

do $$
declare n int;
begin
  select count(*) into n from public.patients;
  if n < 2 then raise exception 'FALLA: admin dejó de ver pacientes (%)', n; end if;
  select count(*) into n from public.appointments;
  if n < 4 then raise exception 'FALLA: admin dejó de ver citas (%)', n; end if;
  select count(*) into n from public.radiology_reports;
  if n < 4 then raise exception 'FALLA: admin dejó de ver informes, incluidos borradores (%)', n; end if;
  select count(*) into n from public.report_communications;
  if n < 1 then raise exception 'FALLA: admin dejó de ver comunicaciones'; end if;
end $$;

reset role;

-- Revocación automática al reabrir: A1 vuelve a borrador y pierde la liberación.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
insert into public.report_reopenings (appointment_id, tenant_id, action, reason, actor_id)
values ('c0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-000000000001', 'reopen', 'test', 'a0000000-0000-0000-0000-00000000000a');
update public.radiology_reports set status = 'draft' where appointment_id = 'c0000000-0000-0000-0000-0000000000a1';
do $$
declare n int;
begin
  select count(*) into n from public.radiology_reports
  where appointment_id = 'c0000000-0000-0000-0000-0000000000a1' and released_to_patient_at is not null;
  if n <> 0 then raise exception 'FALLA: la reapertura no revocó la liberación'; end if;
end $$;

-- Solo admin vincula/desvincula cuentas.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
do $$ begin
  begin
    update public.patients set user_id = null where id = 'b0000000-0000-0000-0000-00000000000a';
    raise exception 'FALLA: un no-admin desvinculó una cuenta de paciente';
  exception when others then
    if sqlerrm like 'FALLA:%' then raise; end if;
  end;
end $$;

-- Exclusión mutua staff/paciente (Fase 3A.1) -----------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

-- Una cuenta staff no puede vincularse como paciente (ni siquiera por un admin).
do $$ begin
  begin
    update public.patients set user_id = 'a0000000-0000-0000-0000-00000000000b'
    where id = 'b0000000-0000-0000-0000-00000000000a';
    raise exception 'FALLA: se vinculó una cuenta staff como paciente';
  exception when others then
    if sqlerrm like 'FALLA:%' then raise; end if;
  end;
end $$;

-- Una cuenta vinculada como paciente no puede recibir perfil de staff.
do $$ begin
  begin
    insert into public.profiles (id, full_name, role, tenant_id)
    values ('a0000000-0000-0000-0000-0000000000aa', 'Intruso', 'operator', 'f0000000-0000-0000-0000-000000000001');
    raise exception 'FALLA: se creó perfil staff para una cuenta paciente';
  exception when others then
    if sqlerrm like 'FALLA:%' then raise; end if;
  end;
end $$;

-- Tras desvincular, la misma cuenta sí puede pasar a staff.
update public.patients set user_id = null where id = 'b0000000-0000-0000-0000-00000000000b';
insert into public.profiles (id, full_name, role, tenant_id)
values ('a0000000-0000-0000-0000-0000000000bb', 'Ex-paciente ahora staff', 'operator', 'f0000000-0000-0000-0000-000000000001');
do $$
declare n int;
begin
  select count(*) into n from public.profiles where id = 'a0000000-0000-0000-0000-0000000000bb';
  if n <> 1 then raise exception 'FALLA: la desvinculación no permitió crear el perfil staff'; end if;
end $$;

-- La cuenta paciente pura (A) conserva solo acceso de paciente; el staff puro conserva el suyo.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.patients;
  if n <> 1 then raise exception 'FALLA: la cuenta paciente pura cambió su alcance (% filas)', n; end if;
  select count(*) into n from public.profiles where id <> 'a0000000-0000-0000-0000-0000000000aa';
  if n <> 0 then raise exception 'FALLA: la cuenta paciente ve perfiles de staff'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.patients;
  if n < 2 then raise exception 'FALLA: el radiólogo perdió acceso a pacientes (%)', n; end if;
end $$;
reset role;

select 'OK: pruebas RLS del portal de paciente' as resultado;

rollback;
