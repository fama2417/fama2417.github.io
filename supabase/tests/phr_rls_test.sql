-- Prueba transaccional del PHR: una cuenta ve fichas de dos tenants y sus
-- documentos personales siguen siendo invisibles para otras cuentas.
begin;

insert into public.tenants (id, name) values
  ('f1000000-0000-0000-0000-000000000001', 'PHR Tenant A'),
  ('f1000000-0000-0000-0000-000000000002', 'PHR Tenant B');

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'phr-admin@test.local'),
  ('a1000000-0000-0000-0000-000000000002', 'phr-patient@test.local'),
  ('a1000000-0000-0000-0000-000000000003', 'phr-other@test.local'),
  ('a1000000-0000-0000-0000-000000000004', 'phr-staff-b@test.local');

insert into public.profiles (id, full_name, role, tenant_id) values
  ('a1000000-0000-0000-0000-000000000001', 'PHR Admin', 'admin', 'f1000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000004', 'PHR Staff B', 'clinician', 'f1000000-0000-0000-0000-000000000002');

insert into public.phr_profiles (user_id, full_name, birth_date, identifier, terms_accepted_at, privacy_accepted_at) values
  ('a1000000-0000-0000-0000-000000000002', 'Paciente PHR', '1990-01-01', 'PHR-PERSONAL', now(), now()),
  ('a1000000-0000-0000-0000-000000000003', 'Otra persona', '1991-01-01', '', now(), now());

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
insert into public.patients (id, identifier, full_name, birth_date, sex, tenant_id, created_by, user_id) values
  ('b1000000-0000-0000-0000-000000000001', 'PHR-A', 'Paciente PHR', '1990-01-01', 'other', 'f1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002'),
  ('b1000000-0000-0000-0000-000000000002', 'PHR-B', 'Paciente PHR', '1990-01-01', 'other', 'f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

do $$ declare n int; begin
  select count(*) into n from public.phr_profiles;
  if n <> 1 then raise exception 'FALLA: la cuenta PHR ve % perfiles personales, esperaba solo el propio', n; end if;
  select count(*) into n from public.patients;
  if n <> 2 then raise exception 'FALLA: la cuenta PHR ve % fichas, esperaba 2', n; end if;
end $$;

reset role;
insert into public.patient_documents
  (id, owner_user_id, original_filename, storage_path, mime_type, size_bytes, document_type, source_institution)
values
  ('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'laboratorio.pdf', 'a1000000-0000-0000-0000-000000000002/laboratorio.pdf', 'application/pdf', 100, 'laboratory', 'Institución externa');

insert into public.phr_lab_imports (id, owner_user_id, document_id, extraction_method)
values ('d1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'local');
insert into public.phr_lab_results
  (id, owner_user_id, document_id, import_id, analyte, value_num, unit, ref_low, ref_high, flag, observed_at, source)
values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'Glucosa', 95, 'mg/dL', 70, 99, 'normal', '2026-07-01', 'ocr');

insert into public.patient_document_shares (document_id, patient_id, granted_by) values
  ('c1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002');
insert into public.patient_document_requests (patient_id, requested_by, message) values
  ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Comparta antecedentes relevantes');
insert into public.patient_document_reviews
  (document_id, patient_id, reviewer_id, status, note, original_filename, mime_type, source_institution, clinical_storage_path)
values
  ('c1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'accepted', 'Revisado', 'informe.pdf', 'application/pdf', 'Institución externa', 'f1000000-0000-0000-0000-000000000001/b1000000-0000-0000-0000-000000000001/copia.pdf');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$ declare n int; begin
  select count(*) into n from public.phr_profiles;
  if n <> 1 then raise exception 'FALLA: otra cuenta no ve exclusivamente su perfil PHR'; end if;
  select count(*) into n from public.patient_documents;
  if n <> 1 then raise exception 'FALLA: el propietario no ve su documento'; end if;
  select count(*) into n from public.phr_lab_results;
  if n <> 1 then raise exception 'FALLA: el propietario no ve su resultado PHR'; end if;
  select count(*) into n from public.patient_document_shares;
  if n <> 1 then raise exception 'FALLA: el propietario no ve la autorización'; end if;
  select count(*) into n from public.patient_document_requests;
  if n <> 1 then raise exception 'FALLA: el paciente no ve la solicitud'; end if;
  select count(*) into n from public.patient_document_reviews;
  if n <> 1 then raise exception 'FALLA: el paciente no ve la revisión'; end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
do $$ declare n int; begin
  select count(*) into n from public.patient_documents;
  if n <> 0 then raise exception 'FALLA: otra cuenta ve documentos personales'; end if;
  select count(*) into n from public.phr_lab_results;
  if n <> 0 then raise exception 'FALLA: otra cuenta ve resultados PHR'; end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
do $$ declare n int; begin
  select count(*) into n from public.patient_documents;
  if n <> 1 then raise exception 'FALLA: staff del tenant autorizado no ve el documento'; end if;
  select count(*) into n from public.phr_lab_results;
  if n <> 0 then raise exception 'FALLA: staff ve resultados personales no compartidos'; end if;
  select count(*) into n from public.patient_document_shares;
  if n <> 1 then raise exception 'FALLA: staff del tenant autorizado no ve la autorización'; end if;
  select count(*) into n from public.patient_document_reviews;
  if n <> 1 then raise exception 'FALLA: staff del tenant autorizado no ve la copia clínica'; end if;
  if not private.current_tenant_can_read_patient_document('a1000000-0000-0000-0000-000000000002/laboratorio.pdf') then
    raise exception 'FALLA: storage no reconoce el acceso del tenant autorizado';
  end if;
  if not private.current_tenant_can_read_clinical_document('f1000000-0000-0000-0000-000000000001/b1000000-0000-0000-0000-000000000001/copia.pdf') then
    raise exception 'FALLA: storage no reconoce la copia clínica del tenant';
  end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
do $$ declare n int; begin
  select count(*) into n from public.patient_documents;
  if n <> 0 then raise exception 'FALLA: staff de otro tenant ve el documento'; end if;
  select count(*) into n from public.patient_document_shares;
  if n <> 0 then raise exception 'FALLA: staff de otro tenant ve la autorización'; end if;
  select count(*) into n from public.patient_document_reviews;
  if n <> 0 then raise exception 'FALLA: staff de otro tenant ve la revisión clínica'; end if;
end $$;

reset role;
update public.patient_document_shares set revoked_at = now() where document_id = 'c1000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
do $$ declare n int; begin
  select count(*) into n from public.patient_documents;
  if n <> 0 then raise exception 'FALLA: staff conserva acceso después de revocar'; end if;
  select count(*) into n from public.patient_document_reviews;
  if n <> 1 then raise exception 'FALLA: la copia clínica desapareció al revocar'; end if;
end $$;

reset role;
delete from public.patient_documents where id = 'c1000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
do $$ declare n int; begin
  select count(*) into n from public.patient_document_reviews where document_id is null;
  if n <> 1 then raise exception 'FALLA: la copia clínica no sobrevivió a eliminar el original'; end if;
  select count(*) into n from public.phr_lab_results;
  if n <> 0 then raise exception 'FALLA: resultados PHR no se eliminaron con el original'; end if;
end $$;

reset role;
select 'OK: pruebas RLS del PHR' as resultado;
rollback;
