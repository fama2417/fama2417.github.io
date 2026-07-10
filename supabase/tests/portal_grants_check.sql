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
                      'audit_log', 'profiles', 'extracted_findings'] loop
    if not has_table_privilege('authenticated', 'public.' || t, 'select') then
      problems := problems || format('- authenticated sin SELECT en public.%s%s', t, chr(10));
    end if;
  end loop;
  -- DML que el staff usa a diario (si falta, la app falla aunque RLS esté bien).
  foreach t in array array['patients', 'appointments', 'radiology_reports', 'report_addenda',
                      'report_key_images', 'report_communications'] loop
    if not has_table_privilege('authenticated', 'public.' || t, 'insert')
       or not has_table_privilege('authenticated', 'public.' || t, 'update') then
      problems := problems || format('- authenticated sin INSERT/UPDATE en public.%s%s', t, chr(10));
    end if;
  end loop;

  -- 2. RLS habilitado en todas las tablas relevantes.
  foreach t in array array['patients', 'appointments', 'imaging_studies', 'radiology_reports',
                      'report_addenda', 'report_key_images', 'report_communications',
                      'audit_log', 'profiles', 'extracted_findings', 'tenants'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || t)::regclass) then
      problems := problems || format('- RLS deshabilitado en public.%s%s', t, chr(10));
    end if;
  end loop;

  -- 3. Execute sobre helpers/RPCs nuevos: authenticated sí, anon no.
  foreach t in array array['public.release_report_to_patient(uuid)', 'public.revoke_report_release(uuid)',
                      'private.current_patient_id()', 'private.appointment_released_to_current_patient(uuid)'] loop
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
      ('radiology_reports', 'radiology staff manage reports'),
      ('report_addenda', 'patients read released addenda'),
      ('report_key_images', 'patients read released key images'),
      ('audit_log', 'admins read tenant audit')
    ) as expected(tablename, policyname)
  loop
    if not exists (select 1 from pg_policies p
                   where p.schemaname = 'public' and p.tablename = pol.tablename and p.policyname = pol.policyname) then
      problems := problems || format('- Falta la política "%s" en public.%s%s', pol.policyname, pol.tablename, chr(10));
    end if;
  end loop;

  -- 5. Los pacientes no deben tener políticas de escritura propias.
  for pol in
    select p.tablename, p.policyname from pg_policies p
    where p.schemaname = 'public' and p.policyname like 'patients %' and p.cmd <> 'SELECT'
  loop
    problems := problems || format('- Política de escritura inesperada "%s" en public.%s%s', pol.policyname, pol.tablename, chr(10));
  end loop;

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
