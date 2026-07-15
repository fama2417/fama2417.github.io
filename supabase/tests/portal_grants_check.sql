-- Diagnóstico de grants/RLS/políticas previo al db push del portal de paciente (Fase 3A/3A.1).
-- Solo lectura: NO modifica grants. Falla con la lista exacta de diferencias si algo no calza.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/portal_grants_check.sql

do $$
declare
  problems text := '';
  t text;
  pol record;
begin
  -- 1. Grants mínimos de authenticated (la app opera con este rol; RLS restringe filas).
  foreach t in array array['patients', 'appointments', 'imaging_studies', 'radiology_reports',
                      'report_addenda', 'report_key_images', 'report_communications',
                      'audit_log', 'profiles', 'extracted_findings', 'finding_dictionary', 'report_follow_ups',
                      'phr_profiles', 'patient_documents', 'patient_document_shares', 'patient_document_requests', 'patient_document_reviews',
                      'phr_lab_imports', 'phr_lab_results'] loop
    if not has_table_privilege('authenticated', 'public.' || t, 'select') then
      problems := problems || format('- authenticated sin SELECT en public.%s%s', t, chr(10));
    end if;
  end loop;
  -- DML que el staff usa a diario (si falta, la app falla aunque RLS esté bien).
  foreach t in array array['patients', 'appointments', 'radiology_reports', 'report_addenda',
                      'report_key_images', 'report_communications', 'report_follow_ups'] loop
    if not has_table_privilege('authenticated', 'public.' || t, 'insert')
       or not has_table_privilege('authenticated', 'public.' || t, 'update') then
      problems := problems || format('- authenticated sin INSERT/UPDATE en public.%s%s', t, chr(10));
    end if;
  end loop;

  -- 2. RLS habilitado en todas las tablas relevantes.
  foreach t in array array['patients', 'appointments', 'imaging_studies', 'radiology_reports',
                      'report_addenda', 'report_key_images', 'report_communications',
                      'audit_log', 'profiles', 'extracted_findings', 'tenants', 'patient_documents', 'patient_document_shares',
                      'phr_profiles', 'patient_document_requests', 'patient_document_reviews', 'phr_lab_imports', 'phr_lab_results'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || t)::regclass) then
      problems := problems || format('- RLS deshabilitado en public.%s%s', t, chr(10));
    end if;
  end loop;

  -- 3. Execute sobre helpers/RPCs nuevos: authenticated sí, anon no.
  foreach t in array array['public.release_report_to_patient(uuid)', 'public.revoke_report_release(uuid)',
                      'private.current_patient_owns(uuid)', 'private.appointment_released_to_current_patient(uuid)',
                      'private.current_tenant_can_read_patient_document(text)', 'private.current_tenant_can_read_clinical_document(text)'] loop
    if not has_function_privilege('authenticated', t, 'execute') then
      problems := problems || format('- authenticated sin EXECUTE en %s%s', t, chr(10));
    end if;
    if has_function_privilege('anon', t, 'execute') then
      problems := problems || format('- anon con EXECUTE en %s (debe revocarse)%s', t, chr(10));
    end if;
  end loop;

  -- 4. Políticas esperadas activas.
  for pol in
    select * from (values
      ('patients', 'patients read own record'),
      ('patients', 'clinical users read patients'),
      ('appointments', 'patients read own appointments'),
      ('imaging_studies', 'patients read own study metadata'),
      ('radiology_reports', 'patients read released final reports'),
      ('radiology_reports', 'report authors manage reports'),
      ('report_addenda', 'patients read released addenda'),
      ('report_key_images', 'patients read released key images'),
      ('tenants', 'patients read own tenant'),
      ('phr_profiles', 'owners read own PHR profile'),
      ('phr_lab_imports', 'owners read own PHR lab imports'),
      ('phr_lab_results', 'owners read own PHR lab results'),
      ('patient_documents', 'owners read personal documents'),
      ('patient_documents', 'staff read shared patient documents'),
      ('patient_document_shares', 'owners read document shares'),
      ('patient_document_shares', 'staff read active shared documents'),
      ('patient_document_requests', 'patients read own document requests'),
      ('patient_document_requests', 'staff read tenant document requests'),
      ('patient_document_reviews', 'patients read own document reviews'),
      ('patient_document_reviews', 'staff read tenant document reviews'),
      ('audit_log', 'admins read tenant audit')
    ) as expected(tablename, policyname)
  loop
    if not exists (select 1 from pg_policies p
                   where p.schemaname = 'public' and p.tablename = pol.tablename and p.policyname = pol.policyname) then
      problems := problems || format('- Falta la política "%s" en public.%s%s', pol.policyname, pol.tablename, chr(10));
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.phr_profiles', 'insert')
     or has_table_privilege('authenticated', 'public.phr_profiles', 'update')
     or has_table_privilege('authenticated', 'public.phr_profiles', 'delete') then
    problems := problems || '- authenticated puede escribir phr_profiles sin pasar por la API validada' || chr(10);
  end if;
  foreach t in array array['phr_lab_imports', 'phr_lab_results'] loop
    if has_table_privilege('authenticated', 'public.' || t, 'insert')
       or has_table_privilege('authenticated', 'public.' || t, 'update')
       or has_table_privilege('authenticated', 'public.' || t, 'delete') then
      problems := problems || format('- authenticated puede escribir public.%s sin pasar por la API validada%s', t, chr(10));
    end if;
  end loop;

  -- 5. Los pacientes no deben tener políticas de escritura propias.
  for pol in
    select p.tablename, p.policyname from pg_policies p
    where p.schemaname = 'public' and p.policyname like 'patients %' and p.cmd <> 'SELECT'
  loop
    problems := problems || format('- Política de escritura inesperada "%s" en public.%s%s', pol.policyname, pol.tablename, chr(10));
  end loop;

  -- 5b. Política de storage para capturas liberadas al paciente (Fase 3C).
  if not exists (select 1 from pg_policies p
                 where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname = 'patients read released captures') then
    problems := problems || '- Falta la política "patients read released captures" en storage.objects' || chr(10);
  end if;
  if not exists (select 1 from pg_policies p
                 where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname = 'staff read accepted clinical document files') then
    problems := problems || '- Falta la política de copias clínicas en storage.objects' || chr(10);
  end if;
  if not exists (select 1 from pg_policies p
                 where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname = 'owners read personal document files') then
    problems := problems || '- Falta la política de lectura del PHR en storage.objects' || chr(10);
  end if;
  if not exists (select 1 from pg_policies p
                 where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname = 'staff read shared patient document files') then
    problems := problems || '- Falta la política de documentos PHR compartidos en storage.objects' || chr(10);
  end if;

  -- 6. Triggers de identidad presentes.
  if not exists (select 1 from pg_trigger where tgname = 'protect_patient_link' and tgrelid = 'public.patients'::regclass) then
    problems := problems || '- Falta el trigger protect_patient_link en public.patients' || chr(10);
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'protect_staff_identity' and tgrelid = 'public.profiles'::regclass) then
    problems := problems || '- Falta el trigger protect_staff_identity en public.profiles' || chr(10);
  end if;

  if problems <> '' then
    raise exception E'Diferencias entre lo esperado y lo encontrado:\n%', problems;
  end if;
  raise notice 'OK: grants, RLS, políticas y triggers del portal según lo esperado';
end $$;
