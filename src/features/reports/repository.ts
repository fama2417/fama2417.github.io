import { compressImageFile } from "@/lib/compress-image";
import { supabase } from "@/lib/supabase-client";
import { effectiveTenantId } from "@/lib/tenant";

export type Signer = { name: string; registration: string };

export type RadiologyReport = {
  id?: string;
  appointmentId: string;
  reportCategory: "consultation" | "imaging" | "laboratory" | "pathology" | "procedure";
  reportCodeSystem: string;
  reportCode: string;
  reportCodeDisplay: string;
  findingCodeSystem: string;
  findingCode: string;
  findingCodeDisplay: string;
  diagnosisCodeSystem: string;
  diagnosisCode: string;
  diagnosisCodeDisplay: string;
  clinicalIndication: string;
  technique: string;
  comparison: string;
  findings: string;
  impression: string;
  status: "draft" | "final";
  criticalFinding: boolean;
  criticalFindingType: string;
  identityConfirmed: boolean;
  clinicalQuestionAnswered: boolean;
  signedAt?: string;
  signer?: Signer;
  signerId?: string;
  updatedAt?: string;
};

export type ReportCommunication = {
  id: string;
  reportId: string;
  urgency: "critical" | "urgent" | "unexpected";
  recipient: string;
  channel: "phone" | "in_person" | "secure_message" | "email" | "other";
  communicatedAt: string;
  acknowledged: boolean;
  notes: string;
};

export type ReportAddendum = { id: string; text: string; signedAt: string; signer: Signer };
export type FollowUpStatus = "pending" | "acknowledged" | "completed";
export type ReportFollowUp = {
  id: string;
  recommendation: string;
  dueDate: string;
  responsible: string;
  status: FollowUpStatus;
  acknowledgedAt?: string;
  completedAt?: string;
};

type ReportRow = {
  id: string;
  appointment_id: string; report_category: RadiologyReport["reportCategory"]; report_code_system: string; report_code: string; report_code_display: string;
  finding_code_system: string; finding_code: string; finding_code_display: string; diagnosis_code_system: string; diagnosis_code: string; diagnosis_code_display: string;
  clinical_indication: string; technique: string; comparison: string; findings: string; impression: string;
  status: RadiologyReport["status"]; critical_finding: boolean; critical_finding_type: string; identity_confirmed: boolean;
  clinical_question_answered: boolean; signed_at: string | null; signed_by: string | null; signer_name: string; signer_registration: string; updated_at: string;
};

const reportColumns = "id, appointment_id, report_category, report_code_system, report_code, report_code_display, finding_code_system, finding_code, finding_code_display, diagnosis_code_system, diagnosis_code, diagnosis_code_display, clinical_indication, technique, comparison, findings, impression, status, critical_finding, critical_finding_type, identity_confirmed, clinical_question_answered, signed_at, signed_by, signer_name, signer_registration, updated_at";
const legacyReportColumns = "id, appointment_id, clinical_indication, technique, comparison, findings, impression, status, critical_finding, critical_finding_type, identity_confirmed, clinical_question_answered, signed_at, signed_by, signer_name, signer_registration, updated_at";
const mapReport = (row: ReportRow): RadiologyReport => ({
  id: row.id,
  appointmentId: row.appointment_id,
  reportCategory: row.report_category ?? "imaging",
  reportCodeSystem: row.report_code_system ?? "",
  reportCode: row.report_code ?? "",
  reportCodeDisplay: row.report_code_display ?? "",
  findingCodeSystem: row.finding_code_system ?? "",
  findingCode: row.finding_code ?? "",
  findingCodeDisplay: row.finding_code_display ?? "",
  diagnosisCodeSystem: row.diagnosis_code_system ?? "",
  diagnosisCode: row.diagnosis_code ?? "",
  diagnosisCodeDisplay: row.diagnosis_code_display ?? "",
  clinicalIndication: row.clinical_indication,
  technique: row.technique,
  comparison: row.comparison,
  findings: row.findings,
  impression: row.impression,
  status: row.status,
  criticalFinding: row.critical_finding,
  criticalFindingType: row.critical_finding_type ?? "",
  identityConfirmed: row.identity_confirmed,
  clinicalQuestionAnswered: row.clinical_question_answered,
  signedAt: row.signed_at ?? undefined,
  signerId: row.signed_by ?? undefined,
  signer: row.signer_name ? { name: row.signer_name, registration: row.signer_registration } : undefined,
  updatedAt: row.updated_at,
});

export async function fetchReport(appointmentId: string) {
  const { data, error } = await supabase.from("radiology_reports").select(reportColumns).eq("appointment_id", appointmentId).maybeSingle();
  if (error && error.message.includes("report_category")) {
    const fallback = await supabase.from("radiology_reports").select(legacyReportColumns).eq("appointment_id", appointmentId).maybeSingle();
    if (fallback.error) throw fallback.error;
    return fallback.data ? mapReport(fallback.data as unknown as ReportRow) : null;
  }
  if (error) throw error;
  return data ? mapReport(data as unknown as ReportRow) : null;
}

export async function saveReport(report: RadiologyReport) {
  const row = {
    appointment_id: report.appointmentId,
    report_category: report.reportCategory,
    report_code_system: report.reportCodeSystem,
    report_code: report.reportCode,
    report_code_display: report.reportCodeDisplay,
    finding_code_system: report.findingCodeSystem,
    finding_code: report.findingCode,
    finding_code_display: report.findingCodeDisplay,
    diagnosis_code_system: report.diagnosisCodeSystem,
    diagnosis_code: report.diagnosisCode,
    diagnosis_code_display: report.diagnosisCodeDisplay,
    clinical_indication: report.clinicalIndication,
    technique: report.technique,
    comparison: report.comparison,
    findings: report.findings,
    impression: report.impression,
    status: report.status,
    critical_finding: report.criticalFinding,
    critical_finding_type: report.criticalFinding ? report.criticalFindingType : "",
    identity_confirmed: report.identityConfirmed,
    clinical_question_answered: report.clinicalQuestionAnswered,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("radiology_reports").upsert(row, { onConflict: "appointment_id" }).select(reportColumns).single();
  if (error && error.message.includes("report_category")) {
    const { report_category, report_code_system, report_code, report_code_display, finding_code_system, finding_code, finding_code_display, diagnosis_code_system, diagnosis_code, diagnosis_code_display, ...legacyRow } = row;
    void report_category; void report_code_system; void report_code; void report_code_display; void finding_code_system; void finding_code; void finding_code_display; void diagnosis_code_system; void diagnosis_code; void diagnosis_code_display;
    const fallback = await supabase.from("radiology_reports").upsert(legacyRow, { onConflict: "appointment_id" }).select(legacyReportColumns).single();
    if (fallback.error) throw fallback.error;
    return mapReport(fallback.data as unknown as ReportRow);
  }
  if (error) throw error;
  return mapReport(data as unknown as ReportRow);
}

type CommunicationRow = { id: string; report_id: string; urgency: ReportCommunication["urgency"]; recipient: string; channel: ReportCommunication["channel"]; communicated_at: string; acknowledged: boolean; notes: string };
const communicationColumns = "id, report_id, urgency, recipient, channel, communicated_at, acknowledged, notes";
const mapCommunication = (row: CommunicationRow): ReportCommunication => ({ id: row.id, reportId: row.report_id, urgency: row.urgency, recipient: row.recipient, channel: row.channel, communicatedAt: row.communicated_at, acknowledged: row.acknowledged, notes: row.notes });

export async function fetchCommunications(reportId: string) {
  const { data, error } = await supabase.from("report_communications").select(communicationColumns).eq("report_id", reportId).order("communicated_at");
  if (error) throw error;
  return (data as CommunicationRow[]).map(mapCommunication);
}

export async function addCommunication(reportId: string, appointmentId: string, input: Omit<ReportCommunication, "id" | "reportId" | "urgency">) {
  const { data, error } = await supabase.from("report_communications").insert({ report_id: reportId, appointment_id: appointmentId, urgency: "critical", recipient: input.recipient, channel: input.channel, communicated_at: input.communicatedAt, acknowledged: input.acknowledged, notes: input.notes }).select(communicationColumns).single();
  if (error) throw error;
  return mapCommunication(data as CommunicationRow);
}

type AddendumRow = { id: string; text: string; signed_at: string; signer_name: string; signer_registration: string };
const addendumColumns = "id, text, signed_at, signer_name, signer_registration";
const mapAddendum = (row: AddendumRow): ReportAddendum => ({ id: row.id, text: row.text, signedAt: row.signed_at, signer: { name: row.signer_name, registration: row.signer_registration } });

export async function fetchAddenda(appointmentId: string) {
  const { data, error } = await supabase.from("report_addenda").select(addendumColumns).eq("appointment_id", appointmentId).order("signed_at");
  if (error) throw error;
  return (data as unknown as AddendumRow[]).map(mapAddendum);
}

export async function addAddendum(appointmentId: string, text: string) {
  const { data, error } = await supabase.from("report_addenda").insert({ appointment_id: appointmentId, text }).select(addendumColumns).single();
  if (error) throw error;
  return mapAddendum(data as unknown as AddendumRow);
}

type FollowUpRow = { id: string; recommendation: string; due_date: string; responsible: string; status: FollowUpStatus; acknowledged_at: string | null; completed_at: string | null };
const mapFollowUp = (row: FollowUpRow): ReportFollowUp => ({ id: row.id, recommendation: row.recommendation, dueDate: row.due_date, responsible: row.responsible, status: row.status, acknowledgedAt: row.acknowledged_at ?? undefined, completedAt: row.completed_at ?? undefined });

export async function fetchFollowUps(appointmentId: string) {
  const { data, error } = await supabase.from("report_follow_ups").select("id, recommendation, due_date, responsible, status, acknowledged_at, completed_at").eq("appointment_id", appointmentId).order("due_date");
  if (error) throw error;
  return (data as FollowUpRow[]).map(mapFollowUp);
}

export async function addFollowUp(appointmentId: string, input: Pick<ReportFollowUp, "recommendation" | "dueDate" | "responsible">) {
  const { data, error } = await supabase.from("report_follow_ups").insert({ appointment_id: appointmentId, recommendation: input.recommendation, due_date: input.dueDate, responsible: input.responsible }).select("id, recommendation, due_date, responsible, status, acknowledged_at, completed_at").single();
  if (error) throw error;
  return mapFollowUp(data as FollowUpRow);
}

export type ReportKeyImage = { id: string; instanceId: string; caption: string; addendumId?: string };

type KeyImageRow = { id: string; instance_id: string; caption: string; addendum_id: string | null };
const keyImageColumns = "id, instance_id, caption, addendum_id";
const mapKeyImage = (row: KeyImageRow): ReportKeyImage => ({ id: row.id, instanceId: row.instance_id, caption: row.caption, addendumId: row.addendum_id ?? undefined });

export async function fetchKeyImages(appointmentId: string) {
  const { data, error } = await supabase.from("report_key_images").select(keyImageColumns).eq("appointment_id", appointmentId).order("created_at");
  if (error) throw error;
  return (data as KeyImageRow[]).map(mapKeyImage);
}

export async function addKeyImage(appointmentId: string, instanceId: string, addendumId?: string) {
  const { data, error } = await supabase.from("report_key_images").insert({ appointment_id: appointmentId, instance_id: instanceId, addendum_id: addendumId ?? null }).select(keyImageColumns).single();
  if (error) throw error;
  return mapKeyImage(data as KeyImageRow);
}

/** Una imagen clave es captura (ruta en storage, contiene "/") o instancia Orthanc (ID sin "/"). */
export const isCaptureKeyImage = (instanceId: string) => instanceId.includes("/");

/** Sube una captura del visor (JPG/PNG, se comprime bajo 1 MB) y la registra como imagen clave. */
export async function uploadKeyImageCapture(appointmentId: string, file: File, addendumId?: string) {
  const compressed = await compressImageFile(file);
  const path = `${appointmentId}/captura-${Date.now()}.${compressed.name.split(".").pop() || "jpg"}`;
  const { error } = await supabase.storage.from("capturas").upload(path, compressed, { upsert: true });
  if (error) throw error;
  return addKeyImage(appointmentId, path, addendumId);
}

export async function captureUrl(path: string) {
  const { data, error } = await supabase.storage.from("capturas").createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

export async function updateKeyImageCaption(id: string, caption: string) {
  const { error } = await supabase.from("report_key_images").update({ caption }).eq("id", id);
  if (error) throw error;
}

export async function removeKeyImage(id: string, instanceId?: string) {
  const { error } = await supabase.from("report_key_images").delete().eq("id", id);
  if (error) throw error;
  if (instanceId && isCaptureKeyImage(instanceId)) await supabase.storage.from("capturas").remove([instanceId]);
}

/** URL temporal de la imagen de firma del firmante (bucket privado; visible según RLS de profiles). */
export async function fetchSignatureUrl(profileId: string) {
  const { data } = await supabase.from("profiles").select("signature_url").eq("id", profileId).maybeSingle();
  const path = (data as { signature_url?: string } | null)?.signature_url;
  if (!path) return null;
  const { data: signed } = await supabase.storage.from("firmas").createSignedUrl(path, 3600);
  return signed?.signedUrl ?? null;
}

/** Admin reabre un informe definitivo a borrador dejando registro del motivo (queda auditado). */
export async function reopenReport(appointmentId: string, reason: string) {
  const { error } = await supabase.rpc("reopen_report", { p_appointment_id: appointmentId, p_reason: reason });
  if (error) throw error;
  const report = await fetchReport(appointmentId);
  if (!report) throw new Error("Informe inexistente.");
  return report;
}

/** Admin elimina el informe (sin dejar adenda) con motivo registrado; borra sus adendas e imágenes. */
export async function deleteReport(appointmentId: string, reason: string) {
  const { data, error } = await supabase.rpc("delete_report", { p_appointment_id: appointmentId, p_reason: reason });
  if (error) throw error;
  const paths = (data ?? []) as string[];
  if (paths.length) await supabase.storage.from("capturas").remove(paths);
}

/** Tenant y rol del usuario actual (filtra por su id: un admin ve varias filas de profiles). */
export async function fetchMyProfile() {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { tenantId: "", role: "" };
  const { data } = await supabase.from("profiles").select("tenant_id, active_tenant_id, platform, role").eq("id", auth.user.id).maybeSingle();
  const row = data as { tenant_id?: string; active_tenant_id?: string; platform?: boolean; role?: string } | null;
  return { tenantId: effectiveTenantId(row ?? {}), role: row?.role ?? "" };
}

export async function canSignReport(appointmentId: string) {
  const { data, error } = await supabase.rpc("can_sign_report", { p_appointment_id: appointmentId });
  if (error) throw error;
  return data === true;
}

export async function updateFollowUpStatus(id: string, status: FollowUpStatus) {
  const { data, error } = await supabase.from("report_follow_ups").update({ status }).eq("id", id).select("id, recommendation, due_date, responsible, status, acknowledged_at, completed_at").single();
  if (error) throw error;
  return mapFollowUp(data as FollowUpRow);
}
