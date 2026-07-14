# Portal de Paciente — Fundaciones (Fase 3A / 3A.1)

Fundaciones de identidad, liberación de informes y RLS para el futuro portal externo.
**No existe `/portal` ni UI todavía**; solo BD y helpers administrativos.

## Estrategia de identidad (sin rol `patient`)

- La identidad de paciente es el vínculo `patients.user_id uuid unique → auth.users(id)` (nullable).
- Un usuario paciente **no tiene fila en `profiles`**: `private.current_role()` y
  `private.current_tenant()` devuelven null, así que todas las políticas de staff lo niegan
  por defecto. Solo obtiene las políticas `patients read …` de la migración 0001.
- Solo admin vincula/desvincula (`private.protect_patient_link`); el paciente no tiene UPDATE
  sobre `patients`, por lo que no puede tocar su propio `user_id`.
- Helpers: `private.current_patient_id()` y `private.appointment_released_to_current_patient(uuid)`
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
| `patients` | solo su propia fila |
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
