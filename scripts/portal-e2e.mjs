// E2E del Portal de Paciente contra Supabase LOCAL (supabase start + migraciones aplicadas).
// Ejecuta el flujo real por las APIs (GoTrue + PostgREST + RPCs): crea staff/paciente, vincula,
// firma y libera un informe, y verifica el alcance RLS del paciente. Limpia todo al final.
//   npm run test:e2e:portal
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const status = JSON.parse(execSync("npx supabase status --output json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
const url = status.API_URL ?? "http://127.0.0.1:54321";
const anonKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
const serviceKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
if (!anonKey || !serviceKey) { console.error("FALLA: supabase local no está corriendo (npx supabase start)."); process.exit(1); }

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const client = () => createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

const stamp = Date.now();
const emails = { admin: `e2e-admin-${stamp}@test.local`, radiologist: `e2e-radiologo-${stamp}@test.local`, patient: `e2e-paciente-${stamp}@test.local` };
const password = `E2e.Portal.${stamp}!`;
const created = { users: [], patientId: null, appointments: [] };
let failures = 0;

function check(name, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!condition) failures += 1;
}

async function expectError(name, promiseOrFn, fragment = "") {
  try {
    const { error } = await promiseOrFn;
    check(name, !!error && (!fragment || String(error.message).includes(fragment)), error?.message ?? "sin error");
  } catch (cause) {
    check(name, !fragment || String(cause?.message).includes(fragment), cause?.message);
  }
}

async function main() {
  const { data: tenant } = await service.from("tenants").select("id, name").limit(1).single();

  // --- Setup: usuarios, perfiles, paciente y citas -------------------------------
  for (const [role, email] of Object.entries(emails)) {
    const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(`No se pudo crear ${role}: ${error.message}`);
    created.users.push(data.user.id);
    if (role !== "patient") {
      const { error: profileError } = await service.from("profiles").insert({
        id: data.user.id, full_name: `E2E ${role}`, role: role === "admin" ? "admin" : "radiologist",
        tenant_id: tenant.id, professional_registration: role === "admin" ? "ADM-E2E" : "RM-E2E",
      });
      if (profileError) throw new Error(`Perfil ${role}: ${profileError.message}`);
    }
  }
  const [adminId, radiologistId, patientUserId] = created.users;

  const { data: patientRow, error: patientError } = await service.from("patients").insert({
    identifier: `E2E-${stamp}`, full_name: "Paciente E2E Portal", birth_date: "1990-01-01", sex: "other",
    tenant_id: tenant.id, created_by: adminId,
  }).select("id").single();
  if (patientError) throw new Error(`Paciente: ${patientError.message}`);
  created.patientId = patientRow.id;

  for (const [index, reason] of [["1", "Examen liberado"], ["2", "Examen en borrador"]]) {
    const { data: appointment, error: appointmentError } = await service.from("appointments").insert({
      patient_id: patientRow.id, appointment_date: "2026-07-01", start_time: `0${index}:00`, end_time: `0${index}:30`,
      practitioner_name: "Dr. E2E", location_name: `Sala E2E ${index}`, modality: "CT", reason, status: "completed",
      service_category: "imaging", tenant_id: tenant.id, created_by: adminId,
    }).select("id").single();
    if (appointmentError) throw new Error(`Cita ${index}: ${appointmentError.message}`);
    created.appointments.push(appointment.id);
  }
  const [releasedAppointment, draftAppointment] = created.appointments;

  // --- Sesiones reales por GoTrue -------------------------------------------------
  const adminClient = client(); const radiologistClient = client(); const patientClient = client();
  for (const [supabaseClient, email] of [[adminClient, emails.admin], [radiologistClient, emails.radiologist], [patientClient, emails.patient]]) {
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`Login ${email}: ${error.message}`);
  }

  // --- Vinculación ----------------------------------------------------------------
  await expectError("no se puede vincular una cuenta staff como paciente",
    adminClient.from("patients").update({ user_id: radiologistId }).eq("id", patientRow.id), "staff");
  const { error: linkError } = await adminClient.from("patients").update({ user_id: patientUserId }).eq("id", patientRow.id);
  check("admin vincula la cuenta del paciente", !linkError, linkError?.message);
  await expectError("un no-admin no puede desvincular",
    radiologistClient.from("patients").update({ user_id: null }).eq("id", patientRow.id), "administrador");

  // --- Informes: final (radiólogo) + borrador -------------------------------------
  const baseReport = {
    clinical_indication: "Indicación E2E", technique: "Técnica E2E", findings: "Hallazgos E2E", impression: "Impresión E2E",
    identity_confirmed: true, clinical_question_answered: true, report_code: "E2E-1", report_code_display: "Examen E2E",
    tenant_id: tenant.id, created_by: radiologistId,
  };
  const { error: finalError } = await radiologistClient.from("radiology_reports").insert({ ...baseReport, appointment_id: releasedAppointment, status: "final" });
  check("radiólogo firma informe definitivo", !finalError, finalError?.message);
  const { error: draftError } = await radiologistClient.from("radiology_reports").insert({ ...baseReport, appointment_id: draftAppointment, status: "draft", identity_confirmed: false, clinical_question_answered: false });
  check("borrador creado", !draftError, draftError?.message);

  // --- Antes de liberar: el paciente no ve informes -------------------------------
  const preReports = await patientClient.from("radiology_reports").select("id");
  check("paciente no ve informes antes de liberar", (preReports.data ?? []).length === 0, `${preReports.data?.length ?? 0} filas`);

  await expectError("radiólogo no puede liberar", radiologistClient.rpc("release_report_to_patient", { p_appointment_id: releasedAppointment }), "administradores");
  await expectError("no se puede liberar un borrador", adminClient.rpc("release_report_to_patient", { p_appointment_id: draftAppointment }), "definitivo");
  const { error: releaseError } = await adminClient.rpc("release_report_to_patient", { p_appointment_id: releasedAppointment });
  check("admin libera el informe final", !releaseError, releaseError?.message);

  // --- Alcance del paciente --------------------------------------------------------
  const [ownPatients, ownAppointments, ownReports, ownTenant] = await Promise.all([
    patientClient.from("patients").select("id"),
    patientClient.from("appointments").select("id"),
    patientClient.from("radiology_reports").select("appointment_id, status"),
    patientClient.from("tenants").select("name"),
  ]);
  check("paciente ve solo su ficha", (ownPatients.data ?? []).length === 1);
  check("paciente ve sus 2 citas", (ownAppointments.data ?? []).length === 2);
  check("paciente ve solo el informe liberado", (ownReports.data ?? []).length === 1 && ownReports.data[0].appointment_id === releasedAppointment);
  check("paciente no ve borradores", !(ownReports.data ?? []).some((row) => row.status === "draft"));
  check("paciente ve el nombre de su institución", (ownTenant.data ?? []).some((row) => row.name === tenant.name), JSON.stringify(ownTenant.data));

  const hack = await patientClient.from("patients").update({ phone: "hack" }).eq("id", patientRow.id).select("id");
  check("paciente no puede escribir datos clínicos", (hack.data ?? []).length === 0 && !hack.error, hack.error?.message ?? "0 filas");
  await expectError("paciente no puede liberar informes", patientClient.rpc("release_report_to_patient", { p_appointment_id: releasedAppointment }));

  // --- Revocación y desvinculación --------------------------------------------------
  const { error: revokeError } = await adminClient.rpc("revoke_report_release", { p_appointment_id: releasedAppointment });
  check("admin revoca la liberación", !revokeError, revokeError?.message);
  const postRevoke = await patientClient.from("radiology_reports").select("id");
  check("tras revocar, el paciente no ve el informe", (postRevoke.data ?? []).length === 0);

  const { error: unlinkError } = await adminClient.from("patients").update({ user_id: null }).eq("id", patientRow.id);
  check("admin desvincula la cuenta", !unlinkError, unlinkError?.message);
  const postUnlink = await patientClient.from("patients").select("id");
  check("tras desvincular, el paciente pierde el acceso", (postUnlink.data ?? []).length === 0);
}

async function cleanup() {
  try {
    if (created.appointments.length) {
      await service.from("radiology_reports").delete().in("appointment_id", created.appointments);
      await service.from("appointments").delete().in("id", created.appointments);
    }
    if (created.patientId) await service.from("patients").delete().eq("id", created.patientId);
    await service.from("profiles").delete().in("id", created.users);
    for (const id of created.users) await service.auth.admin.deleteUser(id).catch(() => undefined);
  } catch (cause) {
    console.error("Aviso: limpieza incompleta:", cause?.message ?? cause);
  }
}

try {
  await main();
} catch (cause) {
  failures += 1;
  console.error("FALLA (setup):", cause?.message ?? cause);
} finally {
  await cleanup();
}
console.log(failures ? `E2E portal: ${failures} falla(s)` : "E2E portal: OK");
process.exit(failures ? 1 : 0);
