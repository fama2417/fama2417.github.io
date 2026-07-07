import { compressImageFile } from "@/lib/compress-image";
import { supabase } from "@/lib/supabase-client";
import { effectiveTenantId } from "@/lib/tenant";

export type Signer = { name: string; registration: string };

export type RadiologyReport = {
  appointmentId: string;
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
  appointment_id: string; clinical_indication: string; technique: string; comparison: string; findings: string; impression: string;
  status: RadiologyReport["status"]; critical_finding: boolean; critical_finding_type: string; identity_confirmed: boolean;
  clinical_question_answered: boolean; signed_at: string | null; signed_by: string | null; signer_name: string; signer_registration: string; updated_at: string;
};

const reportColumns = "appointment_id, clinical_indication, technique, comparison, findings, impression, status, critical_finding, critical_finding_type, identity_confirmed, clinical_question_answered, signed_at, signed_by, signer_name, signer_registration, updated_at";
const mapReport = (row: ReportRow): RadiologyReport => ({
  appointmentId: row.appointment_id,
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
  if (error) throw error;
  return data ? mapReport(data as unknown as ReportRow) : null;
}

export async function saveReport(report: RadiologyReport) {
  const { data, error } = await supabase.from("radiology_reports").upsert({
    appointment_id: report.appointmentId,
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
  }, { onConflict: "appointment_id" }).select(reportColumns).single();
  if (error) throw error;
  return mapReport(data as unknown as ReportRow);
}

type CommunicationRow = { id: string; urgency: ReportCommunication["urgency"]; recipient: string; channel: ReportCommunication["channel"]; communicated_at: string; acknowledged: boolean; notes: string };
const mapCommunication = (row: CommunicationRow): ReportCommunication => ({ id: row.id, urgency: row.urgency, recipient: row.recipient, channel: row.channel, communicatedAt: row.communicated_at, acknowledged: row.acknowledged, notes: row.notes });

export async function fetchCommunications(appointmentId: string) {
  const { data, error } = await supabase.from("report_communications").select("id, urgency, recipient, channel, communicated_at, acknowledged, notes").eq("appointment_id", appointmentId).order("communicated_at");
  if (error) throw error;
  return (data as CommunicationRow[]).map(mapCommunication);
}

export async function addCommunication(appointmentId: string, input: Omit<ReportCommunication, "id" | "urgency">) {
  const { data, error } = await supabase.from("report_communications").insert({ appointment_id: appointmentId, urgency: "critical", recipient: input.recipient, channel: input.channel, communicated_at: input.communicatedAt, acknowledged: input.acknowledged, notes: input.notes }).select("id, urgency, recipient, channel, communicated_at, acknowledged, notes").single();
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

export async function updateFollowUpStatus(id: string, status: FollowUpStatus) {
  const { data, error } = await supabase.from("report_follow_ups").update({ status }).eq("id", id).select("id, recommendation, due_date, responsible, status, acknowledged_at, completed_at").single();
  if (error) throw error;
  return mapFollowUp(data as FollowUpRow);
}
