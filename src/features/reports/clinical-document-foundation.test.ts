import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const roleMigration = new URL("../../../supabase/migrations/202607120002_add_clinician_role.sql", import.meta.url);
const foundationMigration = new URL("../../../supabase/migrations/202607120003_clinical_document_foundation.sql", import.meta.url);
const clinicalAiMigration = new URL("../../../supabase/migrations/202607130001_clinical_ai_profiles.sql", import.meta.url);
const triggerPermissionMigration = new URL("../../../supabase/migrations/202607130002_fix_report_content_trigger_permissions.sql", import.meta.url);
const schedulingMigration = new URL("../../../supabase/migrations/202607070005_fhir_scheduling.sql", import.meta.url);

test("reutiliza Practitioner y PractitionerRole sin crear otra tabla de permisos", async () => {
  const [roleSql, sql, schedulingSql] = await Promise.all([
    readFile(roleMigration, "utf8"), readFile(foundationMigration, "utf8"), readFile(schedulingMigration, "utf8"),
  ]);
  assert.match(roleSql, /add value if not exists 'clinician'/);
  assert.match(schedulingSql, /profile_id uuid references public\.profiles\(id\)/);
  assert.doesNotMatch(sql, /create table/i);
  assert.match(sql, /unique index[\s\S]*?practitioners \(profile_id\)/i);
  assert.match(sql, /join public\.service_types st[\s\S]*?join public\.healthcare_services hs[\s\S]*?join public\.practitioner_roles pr[\s\S]*?join public\.practitioners p/);
  assert.match(sql, /p\.profile_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /st\.category = a\.service_category/);
});

test("la firma diferencia categoría y conserva la gestión administrativa", async () => {
  const sql = await readFile(foundationMigration, "utf8");
  assert.match(sql, /private\.current_role\(\) = 'radiologist'[\s\S]*?a\.service_category = 'imaging'/);
  assert.match(sql, /private\.current_role\(\) in \('admin', 'clinician'\)[\s\S]*?current_practitioner_can_report/);
  assert.match(sql, /current_role\(\)\) = 'admin' or public\.can_sign_report\(appointment_id\)/);
  assert.match(sql, /new\.report_category is distinct from v_category/);
  assert.match(sql, /new\.report_category = 'laboratory'[\s\S]*?new\.findings/);
  assert.match(sql, /new\.report_category = 'pathology'[\s\S]*?new\.impression/);
  assert.match(sql, /new\.report_category = 'procedure'[\s\S]*?new\.technique[\s\S]*?new\.impression/);
  assert.match(sql, /new\.critical_finding[\s\S]*?new\.critical_finding_type/);
});

test("el contenido versionado se deriva de las columnas legacy sin duplicar estado de formulario", async () => {
  const sql = await readFile(foundationMigration, "utf8");
  assert.match(sql, /add column content jsonb not null/);
  assert.match(sql, /content_schema_version smallint not null default 1/);
  for (const key of ["reason", "results", "diagnosis", "incidents", "clinicalIndication"]) assert.match(sql, new RegExp(`'${key}'`));
  assert.match(sql, /before insert or update of report_category, clinical_indication, technique, comparison, findings, impression/);
  const reportWindow = await readFile(new URL("./ReportWindow.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(reportWindow, /useState[^\n]*content/);
});

test("la configuración enlaza usuarios con profesionales y sus ámbitos existentes", async () => {
  const [route, settings, parametry] = await Promise.all([
    readFile(new URL("../../app/api/admin/users/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/configuracion/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../scheduling/ParametryManager.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /from\("practitioners"\)[\s\S]*?profile_id/);
  assert.match(route, /from\("practitioner_roles"\)/);
  assert.match(settings, /ParametryManager tabs=\{\["practitioners", "roles"\]\}/);
  assert.match(parametry, /Sin servicio \(no autoriza firma\)/);
});

test("la IA clínica reutiliza documentos, permisos de firma y métricas agregadas", async () => {
  const sql = await readFile(clinicalAiMigration, "utf8");
  assert.doesNotMatch(sql, /create table/i);
  assert.match(sql, /function public\.ai_usage_totals\(\)/);
  assert.match(sql, /private\.current_role\(\) in \('admin', 'radiologist', 'clinician'\)/);
  assert.match(sql, /report_ai_summaries[\s\S]*?public\.can_sign_report\(rr\.appointment_id\)/);
  assert.match(sql, /ai_usage_log[\s\S]*?public\.can_sign_report\(rr\.appointment_id\)/);
  assert.match(sql, /revoke all on function public\.ai_usage_totals\(\) from public, anon/);
});

test("el trigger deriva content sin conceder acceso a sus funciones internas", async () => {
  const sql = await readFile(triggerPermissionMigration, "utf8");
  assert.match(sql, /alter function private\.sync_report_content\(\) security definer/);
  assert.doesNotMatch(sql, /grant|policy|radiology_reports/i);
});
