import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";

const ids = {
  tenant: "10000000-0000-4000-8000-000000000001",
  patient: "10000000-0000-4000-8000-000000000002",
  currentAppointment: "10000000-0000-4000-8000-000000000003",
  priorAppointment: "10000000-0000-4000-8000-000000000004",
  legacyAppointment: "10000000-0000-4000-8000-000000000005",
  currentStudy: "10000000-0000-4000-8000-000000000006",
  currentReport: "10000000-0000-4000-8000-000000000007",
  priorReport: "10000000-0000-4000-8000-000000000008",
  legacyReport: "10000000-0000-4000-8000-000000000009",
  legacyCommunication: "10000000-0000-4000-8000-000000000010",
};

const users = {
  admin: { email: "admin@local.test", password: "LocalAdmin#2026!", name: "Administradora Local" },
  radiologist: { email: "radiologist@local.test", password: "LocalRadiologist#2026!", name: "Radiólogo Local" },
};

const studyUid = "1.2.826.0.1.3680043.10.543.20260712001";

export function assertLocalUrl(label, value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error(`${label} debe apuntar a localhost por HTTP.`);
  }
  return url;
}

function dicomElement(group, tag, vr, value) {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "ascii");
  const pad = body.length % 2 ? Buffer.from(vr === "UI" ? [0] : [32]) : Buffer.alloc(0);
  const data = Buffer.concat([body, pad]);
  const long = ["OB", "OW", "SQ", "UN", "UT"].includes(vr);
  const header = Buffer.alloc(long ? 12 : 8);
  header.writeUInt16LE(group, 0); header.writeUInt16LE(tag, 2); header.write(vr, 4, 2, "ascii");
  if (long) header.writeUInt32LE(data.length, 8); else header.writeUInt16LE(data.length, 6);
  return Buffer.concat([header, data]);
}

const ui = (group, tag, value) => dicomElement(group, tag, "UI", value);
const text = (group, tag, vr, value) => dicomElement(group, tag, vr, value);
const us = (group, tag, value) => { const data = Buffer.alloc(2); data.writeUInt16LE(value); return dicomElement(group, tag, "US", data); };

export function syntheticDicom(instanceNumber) {
  const sopClass = "1.2.840.10008.5.1.4.1.1.7";
  const sopUid = `${studyUid}.1.${instanceNumber}`;
  const metaBody = Buffer.concat([
    dicomElement(0x0002, 0x0001, "OB", Buffer.from([0, 1])), ui(0x0002, 0x0002, sopClass),
    ui(0x0002, 0x0003, sopUid), ui(0x0002, 0x0010, "1.2.840.10008.1.2.1"),
    ui(0x0002, 0x0012, "1.2.826.0.1.3680043.10.543.1"),
  ]);
  const length = Buffer.alloc(4); length.writeUInt32LE(metaBody.length);
  const pixels = Buffer.alloc(64 * 64, instanceNumber === 1 ? 64 : 192);
  return Buffer.concat([
    Buffer.alloc(128), Buffer.from("DICM"), dicomElement(0x0002, 0x0000, "UL", length), metaBody,
    ui(0x0008, 0x0016, sopClass), ui(0x0008, 0x0018, sopUid), text(0x0008, 0x0020, "DA", "20260712"),
    text(0x0008, 0x0030, "TM", "120000"), text(0x0008, 0x0060, "CS", "CT"),
    text(0x0008, 0x0080, "LO", "Institucion Radiologica Local"), text(0x0008, 0x1030, "LO", "Validacion local"),
    text(0x0008, 0x103e, "LO", "Serie sintetica"), text(0x0010, 0x0010, "PN", "PACIENTE^FICTICIO"),
    text(0x0010, 0x0020, "LO", "VAL-0001"), text(0x0010, 0x0030, "DA", "19800101"),
    text(0x0010, 0x0040, "CS", "O"), ui(0x0020, 0x000d, studyUid), ui(0x0020, 0x000e, `${studyUid}.1`),
    text(0x0020, 0x0010, "SH", "LOCAL-1"), text(0x0020, 0x0011, "IS", "1"), text(0x0020, 0x0013, "IS", String(instanceNumber)),
    us(0x0028, 0x0002, 1), text(0x0028, 0x0004, "CS", "MONOCHROME2"), us(0x0028, 0x0010, 64), us(0x0028, 0x0011, 64),
    us(0x0028, 0x0100, 8), us(0x0028, 0x0101, 8), us(0x0028, 0x0102, 7), us(0x0028, 0x0103, 0),
    dicomElement(0x7fe0, 0x0010, "OB", pixels),
  ]);
}

async function seedOrthanc(url, credentials) {
  const headers = { Authorization: `Basic ${Buffer.from(credentials).toString("base64")}`, "Content-Type": "application/dicom" };
  let studyId = "";
  for (const instance of [1, 2]) {
    const response = await fetch(new URL("/instances", url), { method: "POST", headers, body: syntheticDicom(instance) });
    if (!response.ok) throw new Error(`Orthanc rechazó la instancia ${instance}: ${response.status}`);
    studyId = (await response.json()).ParentStudy;
  }
  return studyId;
}

async function main() {
  if (process.env.LOCAL_VALIDATION_ALLOW !== "true") throw new Error("Define LOCAL_VALIDATION_ALLOW=true para ejecutar el seed.");
  const supabaseUrl = assertLocalUrl("Supabase", process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  const orthancUrl = assertLocalUrl("Orthanc", process.env.ORTHANC_URL ?? "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!serviceKey || !publishableKey || !process.env.ORTHANC_CREDS) throw new Error("Faltan claves locales de Supabase u Orthanc.");

  const service = createClient(supabaseUrl.href, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: listed, error: listError } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw listError;
  async function ensureUser(user) {
    const existing = listed.users.find((entry) => entry.email === user.email);
    const result = existing
      ? await service.auth.admin.updateUserById(existing.id, { password: user.password, email_confirm: true, user_metadata: { full_name: user.name } })
      : await service.auth.admin.createUser({ email: user.email, password: user.password, email_confirm: true, user_metadata: { full_name: user.name } });
    if (result.error || !result.data.user) throw result.error ?? new Error(`No se creó ${user.email}`);
    return result.data.user.id;
  }

  const adminId = await ensureUser(users.admin);
  const radiologistId = await ensureUser(users.radiologist);
  const studyId = await seedOrthanc(orthancUrl, process.env.ORTHANC_CREDS);
  const now = new Date().toISOString().slice(0, 10);
  const { data: legacy } = await service.from("report_communications").select("id").eq("id", ids.legacyCommunication).maybeSingle();

  const writes = [
    service.from("tenants").upsert({ id: ids.tenant, name: "Institución Radiológica Local", pacs_institution: "LOCAL_VALIDATION", report_header: "Validación clínica local" }),
    service.from("profiles").upsert([
      { id: adminId, tenant_id: ids.tenant, full_name: users.admin.name, role: "admin", professional_registration: "ADMIN-LOCAL" },
      { id: radiologistId, tenant_id: ids.tenant, full_name: users.radiologist.name, role: "radiologist", professional_registration: "RAD-LOCAL" },
    ]),
  ];
  for (const write of writes) { const { error } = await write; if (error) throw error; }

  const { error: patientError } = await service.from("patients").upsert({ id: ids.patient, tenant_id: ids.tenant, identifier: "VAL-0001", full_name: "Paciente Ficticio", birth_date: "1980-01-01", sex: "other", prevision: "Local", created_by: adminId });
  if (patientError) throw patientError;
  const appointments = [
    { id: ids.currentAppointment, appointment_date: now, start_time: "12:00", end_time: "12:30", status: "in_progress", reason: "TC de validación integral" },
    { id: ids.priorAppointment, appointment_date: "2026-06-01", start_time: "10:00", end_time: "10:30", status: "completed", reason: "TC previo ficticio" },
    { id: ids.legacyAppointment, appointment_date: "2026-05-01", start_time: "09:00", end_time: "09:30", status: "completed", reason: "Comunicación legacy ficticia" },
  ].map((row) => ({ ...row, tenant_id: ids.tenant, patient_id: ids.patient, practitioner_name: users.radiologist.name, location_name: "Sala CT Local", modality: "CT", branch: "Sucursal Local", service: "Imagenología", specialty: "Radiología", procedure_code: "CT-LOCAL", treating_physician: "Médico Ficticio", priority: "normal", requester_name: "Solicitante Ficticio", service_category: "imaging", created_by: adminId }));
  const { error: appointmentError } = await service.from("appointments").upsert(appointments);
  if (appointmentError) throw appointmentError;
  const { error: studyError } = await service.from("imaging_studies").upsert({ id: ids.currentStudy, tenant_id: ids.tenant, appointment_id: ids.currentAppointment, study_instance_uid: studyUid, orthanc_study_id: studyId });
  if (studyError) throw studyError;

  const reportBase = { tenant_id: ids.tenant, report_category: "imaging", report_code_system: "LOCAL", report_code: "CT-LOCAL", report_code_display: "TC local", finding_code_system: "SNOMEDCT", diagnosis_code_system: "ICD-10", status: "draft", critical_finding: false, critical_finding_type: "", identity_confirmed: false, clinical_question_answered: false, created_by: adminId };
  const reports = [
    { ...reportBase, id: ids.currentReport, appointment_id: ids.currentAppointment, clinical_indication: "Validación integral", technique: "TC sintética", comparison: "Sin comparación", findings: "Borrador local", impression: "Pendiente de validación" },
    { ...reportBase, id: ids.priorReport, appointment_id: ids.priorAppointment, clinical_indication: "Control previo", technique: "TC sintética", comparison: "Sin previos", findings: "Sin hallazgos agudos", impression: "Estudio previo ficticio" },
  ];
  if (!legacy) reports.push({ ...reportBase, id: ids.legacyReport, appointment_id: ids.legacyAppointment, clinical_indication: "Legacy", technique: "TC sintética", comparison: "Sin previos", findings: "Hallazgo crítico histórico", impression: "Fixture legacy" });
  const { error: reportError } = await service.from("radiology_reports").upsert(reports);
  if (reportError) throw reportError;

  if (!legacy) {
    const authenticated = createClient(supabaseUrl.href, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: loginError } = await authenticated.auth.signInWithPassword({ email: users.admin.email, password: users.admin.password });
    if (loginError) throw loginError;
    const { error: communicationError } = await authenticated.from("report_communications").insert({ id: ids.legacyCommunication, report_id: ids.legacyReport, appointment_id: ids.legacyAppointment, urgency: "critical", recipient: "Destinatario Legacy", channel: "phone", communicated_at: new Date().toISOString(), acknowledged: true, notes: "Fixture local" });
    if (communicationError) throw communicationError;
    const { error: deleteError } = await service.from("radiology_reports").delete().eq("id", ids.legacyReport);
    if (deleteError) throw deleteError;
  }

  console.log(`Workspace: http://127.0.0.1:3000/informe/${ids.currentAppointment}`);
  console.log(`Admin: ${users.admin.email} / ${users.admin.password}`);
  console.log(`Radiólogo: ${users.radiologist.email} / ${users.radiologist.password}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
