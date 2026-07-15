# Portal de Paciente — Fundaciones (Fase 3A / 3A.1)

Fundaciones de identidad, liberación de informes, PHR y RLS del portal externo en `/portal`.

## Estrategia de identidad (sin rol `patient`)

- La identidad de paciente es el vínculo `patients.user_id → auth.users(id)` (nullable),
  único por tenant desde la fase PHR MVP: una cuenta puede enlazar una ficha por institución.
- Un usuario paciente **no tiene fila en `profiles`**: `private.current_role()` y
  `private.current_tenant()` devuelven null, así que todas las políticas de staff lo niegan
  por defecto. Solo obtiene las políticas `patients read …` de la migración 0001.
- Solo admin vincula/desvincula (`private.protect_patient_link`); el paciente no tiene UPDATE
  sobre `patients`, por lo que no puede tocar su propio `user_id`.
- Helpers: `private.current_patient_owns(uuid)` y `private.appointment_released_to_current_patient(uuid)`
  (security definer, `search_path=''`, EXECUTE solo para `authenticated`).

## Exclusión mutua staff/paciente (0002)

- Vincular como paciente una cuenta con fila en `profiles` → rechazado (`protect_patient_link`).
- Crear perfil de staff para una cuenta vinculada como paciente → rechazado (`protect_staff_identity`).
- Las filas existentes no se revalidan (compatibilidad); solo escrituras nuevas.
- `linkPatientAccount` (app) detecta el caso antes con mensaje claro; la BD es la autoridad final.

## Reglas de liberación de informes

- Columnas: `radiology_reports.released_to_patient_at / released_to_patient_by`.
- Solo un informe `final` puede liberarse (RPC + check `release ⇒ final`).
- Sobre un informe final solo se permiten dos updates: cambiar únicamente las columnas de
  liberación (admin, vía RPC) o reabrirlo con motivo registrado (admin), lo que **revoca la
  liberación automáticamente**. Cualquier paso a no-final limpia la liberación.
- RPCs (admin, tenant propio): `public.release_report_to_patient(appointment_id)` y
  `public.revoke_report_release(appointment_id)`.
- App: `src/features/patients/portal-admin.ts` (`link/unlinkPatientAccount`,
  `releaseReportToPatient`, `revokeReportRelease`), con verificación admin en cliente además de la BD.

## Visibilidad del paciente vinculado (solo SELECT; cero políticas de escritura)

| Visible | Condición |
|---|---|
| `patients` | sus fichas vinculadas, una por institución |
| `appointments` | solo las suyas |
| `imaging_studies` | solo de sus citas (metadata: ids/uids) |
| `radiology_reports` | solo `final` **y** liberado, de una cita propia |
| `report_addenda`, `report_key_images` | solo si el informe de esa cita está liberado |

**No visible**: borradores, finales sin liberar, informes de otros pacientes, `report_communications`,
`report_follow_ups`, `extracted_findings` y feedback IA, `audit_log`, `profiles` ajenos, `tenants`,
storage (capturas/branding/firmas), catálogos internos (`ai_model_pricing` y `terminology_codes`
ahora exigen tenant).

## Grants

El patrón del repo es GRANT explícito por tabla (`202607020002`). Las tablas de informes nunca
tuvieron GRANT en migraciones (en producción existían fuera de banda); la 0002 los captura para
que un entorno limpio sea reproducible. RLS sigue decidiendo las filas.

## Despliegue a producción

```bash
# 1. Diagnóstico previo (solo lectura; fallará por lo aún no migrado — revisar que no haya sorpresas)
psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/portal_grants_check.sql

# 2. Aplicar migraciones 202607100001 y 202607100002
npx supabase db push

# 3. Post-migración: debe imprimir OK
psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/portal_grants_check.sql

# 4. Pruebas RLS (transaccionales, terminan en ROLLBACK, no dejan datos)
psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/patient_portal_rls_test.sql
```

### Checklist post-migración
- [ ] `portal_grants_check.sql` → OK.
- [ ] `patient_portal_rls_test.sql` → `OK … ROLLBACK`.
- [ ] Smoke staff: `/pacientes`, `/pacientes/[id]`, `/agenda`, `/worklist`, `/informe/[id]`.
- [ ] Firmar un informe de prueba y reabrirlo (el trigger `protect_final_report` fue reemplazado).
- [ ] Verificar en Auditoría que el update de liberación y de `user_id` quedan registrados (diff).

### Rollback

Las migraciones son aditivas (columnas nullable, políticas nuevas, triggers). Para revertir el
comportamiento sin tocar datos:

```sql
drop trigger if exists protect_staff_identity on public.profiles;
drop policy if exists "patients read own record" on public.patients;
drop policy if exists "patients read own appointments" on public.appointments;
drop policy if exists "patients read own study metadata" on public.imaging_studies;
drop policy if exists "patients read released final reports" on public.radiology_reports;
drop policy if exists "patients read released addenda" on public.report_addenda;
drop policy if exists "patients read released key images" on public.report_key_images;
revoke execute on function public.release_report_to_patient(uuid) from authenticated;
revoke execute on function public.revoke_report_release(uuid) from authenticated;
```

Las columnas `user_id` y `released_to_patient_*` pueden quedarse (inertes sin políticas).
`protect_final_report` puede restaurarse a la versión de `202607060005` si fuese necesario.

## Fase 3B — Portal MVP (implementada)

- **Vincular cuenta**: `/pacientes/[id]` → sección "Cuenta de paciente" (solo admin). La cuenta
  se resuelve por email vía `GET /api/admin/users?email=` (admin + service role, solo lectura);
  el update de `patients.user_id` lo hace el cliente admin (trigger + RLS como autoridad final).
- **Liberar/revocar**: `/informe/[id]` → panel junto a las acciones de admin (solo informes final).
- **Portal**: `/portal`, layout propio sin AppShell; sesión sin profile + vinculada → redirige al
  portal; staff en `/portal` → vuelve a `/`; sin vínculo → "Cuenta no habilitada" con logout.

### Prueba manual del flujo real

1. **Crear cuenta paciente temporal**: Supabase Dashboard → Authentication → Users → *Add user*
   (email + contraseña, marcar *Auto Confirm*). No crear perfil en `profiles`.
   Si se crea por SQL: los campos `confirmation_token`, `recovery_token`, `email_change*`,
   `phone_change*` y `reauthentication_token` deben ir con `''`, nunca NULL (GoTrue devuelve
   500 en el login si hay NULL).
2. **Vincular**: como admin, abrir la ficha del paciente de prueba → "Cuenta de paciente" →
   ingresar el email → Vincular. Verificar el rechazo si se intenta con un email de staff.
3. **Liberar**: abrir `/informe/[id]` de un examen con informe **definitivo** → "Liberar al
   paciente" → confirmar. El panel muestra fecha de liberación y "Revocar acceso".
4. **Verificar portal**: en una ventana privada, iniciar sesión con la cuenta paciente → debe
   caer en `/portal`; revisar Inicio, Mis citas, Mis exámenes (con "Ver informe" solo en el
   examen liberado), Mis informes (secciones + addenda) y Mi información; probar que
   `/worklist` o `/pacientes` redirigen a `/portal`; cerrar sesión.
5. **Limpiar**: revocar la liberación desde `/informe/[id]`; desvincular desde la ficha;
   eliminar la cuenta temporal en Authentication → Users. Todo queda auditado
   (updates de `released_to_patient_*` y `user_id` en `audit_log`).

## Fase 3C — Invitaciones, institución, imágenes y E2E (implementada)

- **Invitación desde la UI**: si el correo no tiene cuenta, la sección "Cuenta de paciente"
  ofrece "Invitar y vincular" (`PUT /api/admin/users`, admin): GoTrue envía el correo de
  invitación; al aceptarla, la app pide definir contraseña (hash `type=invite`) y el paciente
  entra directo al portal. Requiere SMTP habilitado (el default del free tier limita ~3/hora).
- **Institución en el portal**: migración `202607130001` — política `patients read own tenant`
  (solo el tenant de su propia ficha) + GRANT select explícito en `tenants`.
- **Imágenes clave**: el portal muestra las capturas (bucket `capturas`) de informes liberados;
  política de storage `patients read released captures` reutilizando el helper de 3A.
  Las instancias PACS directas siguen fuera (requieren el proxy staff — deuda).
- **Imprimir/guardar PDF**: botón en el informe abierto del portal (impresión del navegador,
  solo el informe visible, en claro).
- **E2E automatizado**: `npm run test:e2e:portal` contra Supabase local (`supabase start` +
  migraciones): crea staff/paciente reales por GoTrue, vincula, firma, libera, verifica el
  alcance RLS del paciente (borradores/no liberados invisibles, escritura negada, institución
  visible), revoca y desvincula; limpia todo al final.

### Deuda pendiente

- Previews de instancias PACS en el portal (proxy con auth de paciente).
- PDF servidor (hoy es impresión del navegador).
- Paginación en la resolución por email (hoy hasta 1000 cuentas).

## PHR autónomo — Fase 1

La experiencia activa de `/portal` es ahora un registro personal de salud independiente de los
tenants. La integración con fichas institucionales queda en espera: sus tablas y flujos se
conservan, pero no aparecen en la navegación del usuario.

- `phr_profiles` representa al propietario del PHR y se vincula directamente con `auth.users`.
  No requiere una fila en `patients` ni en `profiles`.
- El alta usa un enlace seguro enviado por Supabase Auth. Al primer ingreso solicita nombre,
  fecha de nacimiento, identificador opcional y aceptación de privacidad; exige mayoría de edad.
- La navegación se limita a Inicio, Documentos, Laboratorios, Línea de tiempo y Perfil y
  seguridad. Agenda, informes institucionales, solicitudes y compartir con clínicas están ocultos.
- `patient_documents` y el bucket privado `patient-documents` guardan los originales sin
  `tenant_id`. La institución de origen es metadata declarada por el usuario, no un vínculo.
- `POST /api/portal/documents` valida sesión PHR, tamaño, tipo y firma binaria de PDF/JPEG/PNG o
  DICOM antes de almacenar. Los originales no se modifican.
- `/api/portal/fhir` exporta un Bundle FHIR R4 personal con `Patient` y `DocumentReference`.
  No mezcla fichas clínicas ni organizaciones mientras la integración esté en espera.
- Perfil, exportación, cierre global de sesiones y eliminación de cuenta quedan disponibles en
  autoservicio. Al eliminar la cuenta se borran perfil y archivos personales; una eventual copia
  clínica incorporada legalmente por una institución se conserva de forma independiente.
- `/portal/privacidad` es público y explica alcance, controles y uso futuro de automatización.
- `/manifest.webmanifest` permite instalar el portal como PWA. No se cachean datos de salud
  offline.

### Configuración de autenticación

En Supabase alojado se debe habilitar el registro por correo, agregar la URL de producción de
`/portal` a las redirect URLs y configurar SMTP propio antes de abrir el producto a usuarios.
El proveedor de correo local sirve solo para desarrollo. La service role continúa exclusivamente
en rutas de servidor.

### Verificación

- `npm test` incluye validación de perfil, mayoría de edad, documentos y resolución de sesión.
- `supabase/tests/portal_grants_check.sql` comprueba grants mínimos y RLS de `phr_profiles`.
- `supabase/tests/phr_rls_test.sql` verifica aislamiento entre propietarios y conserva las
  pruebas del flujo institucional dormido.
- Smoke real validado: registro por correo, onboarding, cinco secciones y edición de perfil.

## PHR autónomo — Fases 2 y 3

- Un laboratorio PDF se guarda primero como documento privado. El usuario decide cuándo analizarlo;
  el original no se transforma ni se reemplaza.
- El backend reutiliza el parser local existente. Solo cuando el PDF no trae texto suficiente usa
  la extracción de OpenAI configurada en servidor, con un máximo personal diario.
- `phr_lab_imports` registra una sola extracción por documento y `phr_lab_results` conserva las
  filas sugeridas. Ambas tablas están fuera de tenants, aisladas por `owner_user_id` y son de solo
  lectura directa; las escrituras pasan por `/api/portal/labs`.
- Todo resultado comienza en `suggested`: el propietario puede corregirlo, confirmarlo o descartarlo.
  Solo los confirmados aparecen en historial, tendencias y exportación FHIR como `Observation`.
- Las tendencias agrupan el mismo analito o LOINC y convierten únicamente unidades dimensionalmente
  compatibles. El gráfico requiere al menos dos fechas y usa SVG nativo.
- La eliminación del PDF elimina en cascada su extracción personal; una copia clínica institucional
  previamente incorporada continúa siendo independiente.

### Producción en Supabase y Render

1. Aplicar las migraciones hasta `202607150008_phr_laboratory_results.sql` en Supabase.
2. En Render configurar `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY` y `OPENAI_API_KEY` como secretos.
3. Mantener `AI_EXTRACTION_ENABLED=true` y ajustar `PHR_AI_MAX_PER_DAY` según presupuesto.
4. En Supabase Auth habilitar registro, SMTP y la URL pública de `/portal` como redirect URL.
5. Ejecutar `portal_grants_check.sql` y `phr_rls_test.sql` después del push de esquema.

## PHR autónomo — Fase 4: experiencia longitudinal

- Inicio resume último laboratorio, resultados fuera del rango informado, favoritos y documentos recientes.
- La comparación usa el último valor numérico de cada período y convierte solo unidades dimensionalmente compatibles.
- Laboratorios filtra por hematología, lípidos, metabolismo, renal, hepático y hormonas; cada grupo explica qué tipo de medición contiene sin interpretar clínicamente a la persona.
- La línea de tiempo mezcla documentos y fechas de muestra confirmadas.
- `/api/portal/trends` descarga CSV o PDF y `/api/portal/summary` genera un resumen descriptivo para consulta.
- El exportador FHIR R4 incluye `Patient`, `DocumentReference`, `Observation` y un `DiagnosticReport` por documento de laboratorio con resultados confirmados.
- La interfaz usa siempre “fuera del rango informado por el laboratorio”; no deriva enfermedades ni diagnósticos.

## PHR autónomo — Fase 5: compartir y cuidadores

- Los enlaces temporales son de solo lectura, expiran entre 1 y 30 días y guardan solo SHA-256 del token.
- El propietario selecciona documentos, biomarcadores completos y opcionalmente su perfil de emergencia.
- Cada apertura registra fecha, agente e IP pseudonimizada; el propietario ve el conteo y puede revocar inmediatamente.
- `phr_caregiver_grants` permite acceso familiar/cuidador de solo lectura, revocable y fuera de tenants. RLS sigue siendo la autoridad.
- El perfil de emergencia contiene datos declarados: grupo sanguíneo, alergias, condiciones, medicamentos, contacto y notas.
- Apple Health y Health Connect requieren aplicaciones nativas y credenciales propias; la PWA no simula conexiones. FHIR es la frontera interoperable actual.
- Las conexiones automáticas con instituciones permanecen fuera hasta demostrar uso repetido y contar con APIs, contratos y consentimiento verificable.

### Migración y verificación

- Aplicar `202607150009_phr_longitudinal_sharing.sql`.
- Ejecutar `portal_grants_check.sql` y `phr_rls_test.sql`.
- Validar creación, apertura, auditoría, expiración y revocación de un enlace con datos sintéticos.
- Validar que un cuidador ve el PHR pero recibe `403` al intentar escribir o compartir.
