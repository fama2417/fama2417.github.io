import { authenticatedFetch, supabase } from "@/lib/supabase-client";
import type { Patient } from "./types";
import type { PatientEditPatch } from "./patient-edit";
import { patientSearchFilter } from "./search";
import type { LabObservation } from "../reports/lab-observations";

const columns = "id, identifier, identifier_type, full_name, birth_date, sex, phone, privacy_consent_at, address, comuna, email, allergies, morbid_history, prevision, user_id";

type PatientRow = {
  id: string; identifier: string; identifier_type: Patient["identifierType"]; full_name: string; birth_date: string; sex: Patient["sex"]; phone: string;
  privacy_consent_at: string | null; address: string; comuna: string; email: string; allergies: string; morbid_history: string; prevision: string;
  user_id: string | null;
};

function mapPatient(row: PatientRow): Patient {
  return {
    id: row.id, identifier: row.identifier, identifierType: row.identifier_type ?? "run", name: row.full_name, birthDate: row.birth_date, sex: row.sex, phone: row.phone,
    consentAt: row.privacy_consent_at ?? undefined,
    address: row.address ?? "", comuna: row.comuna ?? "", email: row.email ?? "", allergies: row.allergies ?? "", morbidHistory: row.morbid_history ?? "",
    prevision: row.prevision ?? "", userId: row.user_id ?? null,
  };
}

export type PatientExam = {
  id: string; date: string; time: string; modality: string; reason: string; status: string;
  reportStatus?: "draft" | "final"; hasImages: boolean;
  anamnesis: string; diagnosticHypothesis: string; practitioner: string;
};

export type PatientSharedDocument = {
  id: string; filename: string; mimeType: string; sizeBytes: number; documentDate: string | null;
  documentType: "imaging" | "laboratory" | "prescription" | "other"; sourceInstitution: string;
  sharedAt: string; url: string; reviewStatus: "accepted" | "rejected" | null; reviewNote: string;
};

/** Documentos personales que el paciente autorizó expresamente para esta ficha institucional. */
export async function fetchPatientSharedDocuments(patientId: string): Promise<PatientSharedDocument[]> {
  const [shares, reviews] = await Promise.all([supabase.from("patient_document_shares")
    .select("id, granted_at, document:patient_documents!inner(id, original_filename, storage_path, mime_type, size_bytes, document_date, document_type, source_institution)")
    .eq("patient_id", patientId).is("revoked_at", null).order("granted_at", { ascending: false }),
    supabase.from("patient_document_reviews").select("document_id, status, note, created_at").eq("patient_id", patientId).order("created_at", { ascending: false }),
  ]);
  if (shares.error || reviews.error) throw shares.error ?? reviews.error;
  type SharedRow = {
    id: string; granted_at: string; document: {
      id: string; original_filename: string; storage_path: string; mime_type: string; size_bytes: number;
      document_date: string | null; document_type: PatientSharedDocument["documentType"]; source_institution: string;
    };
  };
  const latest = new Map<string, { status: "accepted" | "rejected"; note: string }>();
  for (const review of reviews.data ?? []) if (review.document_id && !latest.has(review.document_id)) latest.set(review.document_id, { status: review.status as "accepted" | "rejected", note: review.note ?? "" });
  return Promise.all(((shares.data ?? []) as unknown as SharedRow[]).map(async (row) => {
    const signed = await supabase.storage.from("patient-documents").createSignedUrl(row.document.storage_path, 3600);
    if (signed.error) throw signed.error;
    return {
      id: row.document.id, filename: row.document.original_filename, mimeType: row.document.mime_type, sizeBytes: row.document.size_bytes,
      documentDate: row.document.document_date, documentType: row.document.document_type, sourceInstitution: row.document.source_institution,
      sharedAt: row.granted_at, url: signed.data.signedUrl, reviewStatus: latest.get(row.document.id)?.status ?? null, reviewNote: latest.get(row.document.id)?.note ?? "",
    };
  }));
}

export type PatientDocumentRequest = { id: string; message: string; status: "pending" | "approved" | "rejected"; createdAt: string; respondedAt: string | null };

export async function fetchPatientDocumentRequests(patientId: string): Promise<PatientDocumentRequest[]> {
  const { data, error } = await supabase.from("patient_document_requests").select("id, message, status, created_at, responded_at").eq("patient_id", patientId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id, message: row.message, status: row.status as PatientDocumentRequest["status"], createdAt: row.created_at, respondedAt: row.responded_at }));
}

export type PatientAcceptedDocument = { id: string; filename: string; sourceInstitution: string; mimeType: string; documentDate: string | null; note: string; acceptedAt: string; reviewerName: string; url: string };

export async function fetchPatientAcceptedDocuments(patientId: string): Promise<PatientAcceptedDocument[]> {
  const { data, error } = await supabase.from("patient_document_reviews")
    .select("id, original_filename, source_institution, mime_type, document_date, note, created_at, clinical_storage_path, reviewer_id")
    .eq("patient_id", patientId).eq("status", "accepted").order("created_at", { ascending: false });
  if (error) throw error;
  type Row = { id: string; original_filename: string; source_institution: string; mime_type: string; document_date: string | null; note: string; created_at: string; clinical_storage_path: string; reviewer_id: string };
  const rows = (data ?? []) as unknown as Row[];
  const profiles = rows.length ? await supabase.from("profiles").select("id, full_name").in("id", [...new Set(rows.map((row) => row.reviewer_id))]) : { data: [], error: null };
  if (profiles.error) throw profiles.error;
  const names = new Map((profiles.data ?? []).map((profile) => [profile.id, profile.full_name]));
  return Promise.all(rows.map(async (row) => {
    const signed = await supabase.storage.from("clinical-documents").createSignedUrl(row.clinical_storage_path, 3600);
    if (signed.error) throw signed.error;
    return { id: row.id, filename: row.original_filename, sourceInstitution: row.source_institution, mimeType: row.mime_type, documentDate: row.document_date, note: row.note, acceptedAt: row.created_at, reviewerName: names.get(row.reviewer_id) ?? "Equipo clínico", url: signed.data.signedUrl };
  }));
}

export async function requestPatientDocuments(patientId: string, message: string) {
  await authenticatedFetch("/api/portal/document-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId, message }) });
}

export async function reviewPatientDocument(patientId: string, documentId: string, status: "accepted" | "rejected", note: string) {
  await authenticatedFetch("/api/patient-documents/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId, documentId, status, note }) });
}

/** Exámenes (citas) del paciente para la ficha, del más reciente al más antiguo. */
export async function fetchPatientExams(patientId: string): Promise<PatientExam[]> {
  const { data, error } = await supabase.from("appointments")
    .select("id, appointment_date, start_time, modality, reason, status, anamnesis, diagnostic_hypothesis, practitioner_name, study:imaging_studies(id), report:radiology_reports(status)")
    .eq("patient_id", patientId).order("appointment_date", { ascending: false }).order("start_time", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as { id: string; appointment_date: string; start_time: string; modality: string; reason: string; status: string; anamnesis: string; diagnostic_hypothesis: string; practitioner_name: string; study: { id: string } | null; report: { status: "draft" | "final" } | null }[])
    .map((row) => ({
      id: row.id, date: row.appointment_date, time: (row.start_time ?? "").slice(0, 5), modality: row.modality, reason: row.reason, status: row.status,
      reportStatus: row.report?.status, hasImages: !!row.study,
      anamnesis: row.anamnesis ?? "", diagnosticHypothesis: row.diagnostic_hypothesis ?? "", practitioner: row.practitioner_name ?? "",
    }));
}

/** Sin argumentos conserva el comportamiento histórico (todos los pacientes, para pickers de agenda/worklist). */
/** Datos mínimos del examen asociado a un seguimiento o comunicación. */
export type PatientExamRef = { id: string; date: string; time: string; modality: string; reason: string; status: string; reportStatus?: "draft" | "final"; hasImages: boolean };

type ExamRefRow = { id: string; appointment_date: string; start_time: string; modality: string; reason: string; status: string; study: { id: string } | null; report: { status: "draft" | "final" } | null };
const examRefColumns = "id, appointment_date, start_time, modality, reason, status, study:imaging_studies(id), report:radiology_reports(status)";

function mapExamRef(row: ExamRefRow): PatientExamRef {
  return { id: row.id, date: row.appointment_date, time: (row.start_time ?? "").slice(0, 5), modality: row.modality, reason: row.reason, status: row.status, reportStatus: row.report?.status, hasImages: !!row.study };
}

export type PatientFollowUp = {
  id: string; recommendation: string; dueDate: string; responsible: string;
  status: "pending" | "acknowledged" | "completed"; createdAt: string; exam: PatientExamRef;
};

/** Seguimientos recomendados en informes del paciente (RLS: lectura para todo el staff del tenant). */
export async function fetchPatientFollowUps(patientId: string): Promise<PatientFollowUp[]> {
  const { data, error } = await supabase.from("report_follow_ups")
    .select(`id, recommendation, due_date, responsible, status, created_at, appointment:appointments!inner(patient_id, ${examRefColumns})`)
    .eq("appointment.patient_id", patientId).order("due_date");
  if (error) throw error;
  return ((data ?? []) as unknown as { id: string; recommendation: string; due_date: string; responsible: string; status: PatientFollowUp["status"]; created_at: string; appointment: ExamRefRow }[])
    .map((row) => ({ id: row.id, recommendation: row.recommendation, dueDate: row.due_date, responsible: row.responsible, status: row.status, createdAt: row.created_at, exam: mapExamRef(row.appointment) }));
}

export type PatientCriticalCommunication = {
  id: string; urgency: "critical" | "urgent" | "unexpected"; recipient: string; channel: string;
  communicatedAt: string; acknowledged: boolean; notes: string; exam: PatientExamRef;
};

/** Comunicaciones de hallazgos críticos de informes del paciente, de la más reciente a la más antigua. */
export async function fetchPatientCriticalCommunications(patientId: string): Promise<PatientCriticalCommunication[]> {
  const { data, error } = await supabase.from("report_communications")
    .select(`id, urgency, recipient, channel, communicated_at, acknowledged, notes, appointment:appointments!inner(patient_id, ${examRefColumns})`)
    .eq("appointment.patient_id", patientId).order("communicated_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as { id: string; urgency: PatientCriticalCommunication["urgency"]; recipient: string; channel: string; communicated_at: string; acknowledged: boolean; notes: string; appointment: ExamRefRow }[])
    .map((row) => ({ id: row.id, urgency: row.urgency, recipient: row.recipient, channel: row.channel, communicatedAt: row.communicated_at, acknowledged: row.acknowledged, notes: row.notes ?? "", exam: mapExamRef(row.appointment) }));
}

export type PatientKeyImage = { id: string; instanceId: string; caption: string; createdAt: string; createdBy: string; exam: PatientExamRef };

/** Imágenes clave (KIN) de los informes del paciente, de la más reciente a la más antigua. */
export async function fetchPatientKeyImages(patientId: string): Promise<PatientKeyImage[]> {
  const { data, error } = await supabase.from("report_key_images")
    .select(`id, instance_id, caption, created_at, creator:profiles(full_name), appointment:appointments!inner(patient_id, ${examRefColumns})`)
    .eq("appointment.patient_id", patientId).order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as { id: string; instance_id: string; caption: string; created_at: string; creator: { full_name: string } | null; appointment: ExamRefRow }[])
    .map((row) => ({ id: row.id, instanceId: row.instance_id, caption: row.caption ?? "", createdAt: row.created_at, createdBy: row.creator?.full_name ?? "", exam: mapExamRef(row.appointment) }));
}

export type PatientReportAddendum = { id: string; text: string; signedAt: string; signerName: string; signerRegistration: string; exam: PatientExamRef };

/** Addenda firmadas sobre informes del paciente, de la más reciente a la más antigua. */
export async function fetchPatientReportAddenda(patientId: string): Promise<PatientReportAddendum[]> {
  const { data, error } = await supabase.from("report_addenda")
    .select(`id, text, signed_at, signer_name, signer_registration, appointment:appointments!inner(patient_id, ${examRefColumns})`)
    .eq("appointment.patient_id", patientId).order("signed_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as { id: string; text: string; signed_at: string; signer_name: string; signer_registration: string; appointment: ExamRefRow }[])
    .map((row) => ({ id: row.id, text: row.text, signedAt: row.signed_at, signerName: row.signer_name ?? "", signerRegistration: row.signer_registration ?? "", exam: mapExamRef(row.appointment) }));
}

export type PatientStructuredFindingCode = { localCode: string; canonicalName: string; snomedCode?: string; snomedDisplay?: string; icd10Code?: string; icd11Code?: string; radlexCode?: string };

export type PatientStructuredFinding = {
  id: string; reportId: string; findingText: string; normalizedText: string;
  status: string; importance: string; sourceSection: string; sourceSentence: string;
  bodySite: string; laterality: string; severity: string;
  confidence: number; extractionMethod: string; codingStatus: string;
  createdAt: string; updatedAt: string;
  code?: PatientStructuredFindingCode; exam: PatientExamRef;
};

/** Hallazgos estructurados extraídos de informes del paciente. Excluye rechazados; el filtro por rol vive en finding-display.ts. */
export async function fetchPatientStructuredFindings(patientId: string): Promise<PatientStructuredFinding[]> {
  const { data, error } = await supabase.from("extracted_findings")
    .select(`id, report_id, finding_text, normalized_text, status, importance, source_section, source_sentence, body_site, laterality, severity, confidence, extraction_method, coding_status, created_at, updated_at,
      finding:finding_dictionary(local_code, canonical_name, snomed_code, snomed_display, icd10_code, icd11_code, radlex_code),
      report:radiology_reports!inner(appointment:appointments!inner(patient_id, ${examRefColumns}))`)
    .eq("report.appointment.patient_id", patientId).neq("coding_status", "rejected").order("created_at", { ascending: false });
  if (error) throw error;
  type FindingRow = {
    id: string; report_id: string; finding_text: string; normalized_text: string; status: string; importance: string;
    source_section: string; source_sentence: string; body_site: string | null; laterality: string | null; severity: string | null;
    confidence: number; extraction_method: string; coding_status: string; created_at: string; updated_at: string;
    finding: { local_code: string; canonical_name: string; snomed_code: string | null; snomed_display: string | null; icd10_code: string | null; icd11_code: string | null; radlex_code: string | null } | null;
    report: { appointment: ExamRefRow };
  };
  return ((data ?? []) as unknown as FindingRow[]).map((row) => ({
    id: row.id, reportId: row.report_id, findingText: row.finding_text, normalizedText: row.normalized_text,
    status: row.status, importance: row.importance, sourceSection: row.source_section, sourceSentence: row.source_sentence ?? "",
    bodySite: row.body_site ?? "", laterality: row.laterality ?? "", severity: row.severity ?? "",
    confidence: row.confidence ?? 0, extractionMethod: row.extraction_method, codingStatus: row.coding_status,
    createdAt: row.created_at, updatedAt: row.updated_at,
    code: row.finding ? {
      localCode: row.finding.local_code, canonicalName: row.finding.canonical_name,
      snomedCode: row.finding.snomed_code ?? undefined, snomedDisplay: row.finding.snomed_display ?? undefined,
      icd10Code: row.finding.icd10_code ?? undefined, icd11Code: row.finding.icd11_code ?? undefined, radlexCode: row.finding.radlex_code ?? undefined,
    } : undefined,
    exam: mapExamRef(row.report.appointment),
  }));
}

export type PatientLabObservation = LabObservation & { exam: PatientExamRef };

/** Resultados confirmados del paciente. Se unen directamente a la atención; no requieren informe. */
export async function fetchPatientLabObservations(patientId: string): Promise<PatientLabObservation[]> {
  const { data, error } = await supabase.from("lab_observations")
    .select(`id, report_id, import_id, appointment_id, patient_id, loinc_code, analyte, value_num, value_text, unit, ref_low, ref_high, ref_text, flag, observed_at, source, source_sentence, review_status,
      appointment:appointments!inner(patient_id, ${examRefColumns})`)
    .eq("patient_id", patientId).eq("review_status", "confirmed").order("observed_at", { ascending: false });
  if (error) throw error;
  type LabRow = {
    id: string; report_id: string | null; import_id: string | null; appointment_id: string; patient_id: string; loinc_code: string; analyte: string; value_num: number | null;
    value_text: string; unit: string; ref_low: number | null; ref_high: number | null; ref_text: string;
    flag: LabObservation["flag"]; observed_at: string; source: LabObservation["source"]; source_sentence: string;
    review_status: LabObservation["reviewStatus"]; appointment: ExamRefRow;
  };
  const rows = (data ?? []) as unknown as LabRow[];
  const codes = [...new Set(rows.map((row) => row.loinc_code).filter(Boolean))];
  const metadata = codes.length ? await supabase.from("loinc_metadata")
    .select("code, component, property, time_aspect, specimen, scale_type, method_type, class_name, status, example_ucum_units").in("code", codes) : { data: [], error: null };
  if (metadata.error) throw metadata.error;
  const metadataByCode = new Map((metadata.data ?? []).map((item) => [item.code as string, {
    component: item.component as string, property: item.property as string, timeAspect: item.time_aspect as string,
    specimen: item.specimen as string, scaleType: item.scale_type as string, methodType: item.method_type as string,
    className: item.class_name as string, status: item.status as string, exampleUcumUnits: item.example_ucum_units as string,
  }]));
  return rows.map((row) => ({
    id: row.id, reportId: row.report_id, importId: row.import_id, appointmentId: row.appointment_id, patientId: row.patient_id, loincCode: row.loinc_code, analyte: row.analyte,
    valueNum: row.value_num, valueText: row.value_text, unit: row.unit, refLow: row.ref_low, refHigh: row.ref_high,
    refText: row.ref_text, flag: row.flag, observedAt: row.observed_at, source: row.source, sourceSentence: row.source_sentence,
    reviewStatus: row.review_status, loincMetadata: metadataByCode.get(row.loinc_code), exam: mapExamRef(row.appointment),
  }));
}

export async function fetchPatients(options?: { search?: string; limit?: number }) {
  let query = supabase.from("patients").select(columns).order("full_name");
  const filter = patientSearchFilter(options?.search);
  if (filter) query = query.or(filter);
  if (options?.limit) query = query.limit(options.limit);
  const { data, error } = await query;
  if (error) throw error;
  return (data as PatientRow[]).map(mapPatient);
}

export async function fetchPatient(id: string) {
  const { data, error } = await supabase.from("patients").select(columns).eq("id", id).single();
  if (error) throw error;
  return mapPatient(data as PatientRow);
}

export type PatientAuditEntry = { id: number; action: string; changedAt: string; actorName: string; details: Record<string, unknown> | null };

/** Trazabilidad del paciente (Ley 19.628/21.719): quién, cuándo y qué cambió. Solo admins (RLS de audit_log). */
export async function fetchPatientAudit(patientId: string): Promise<PatientAuditEntry[]> {
  const [audit, profiles] = await Promise.all([
    supabase.from("audit_log").select("id, action, changed_at, actor_id, details").eq("table_name", "patients").eq("row_id", patientId).order("changed_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name"),
  ]);
  if (audit.error) throw audit.error;
  const names = new Map((profiles.data ?? []).map((profile) => [profile.id as string, profile.full_name as string]));
  return (audit.data ?? []).map((row) => ({
    id: row.id as number,
    action: row.action as string,
    changedAt: row.changed_at as string,
    actorName: names.get(row.actor_id as string) ?? "Sistema",
    details: (row.details as Record<string, unknown> | null) ?? null,
  }));
}

/** Edición administrativa (Fase 2D): solo columnas de la allowlist, solo admin (defensa doble junto al gating de UI; RLS filtra tenant). */
export async function updatePatient(patientId: string, patch: PatientEditPatch): Promise<Patient> {
  const auth = await supabase.auth.getUser();
  const profile = await supabase.from("profiles").select("role").eq("id", auth.data.user?.id ?? "").single();
  if (profile.data?.role !== "admin") throw new Error("Solo un administrador puede editar los datos del paciente.");
  const { data, error } = await supabase.from("patients").update({
    phone: patch.phone,
    email: patch.email,
    address: patch.address,
    comuna: patch.comuna,
    prevision: patch.prevision,
    allergies: patch.allergies,
    morbid_history: patch.morbidHistory,
  }).eq("id", patientId).select(columns).single();
  if (error) throw error;
  return mapPatient(data as PatientRow);
}

export async function createPatient(patient: Omit<Patient, "id">) {
  const { data, error } = await supabase.from("patients").insert({
    identifier: patient.identifier,
    identifier_type: patient.identifierType,
    full_name: patient.name,
    birth_date: patient.birthDate,
    sex: patient.sex,
    phone: patient.phone,
    privacy_consent_at: patient.consentAt ?? null,
    address: patient.address,
    comuna: patient.comuna,
    email: patient.email,
    allergies: patient.allergies,
    morbid_history: patient.morbidHistory,
    prevision: patient.prevision,
  }).select(columns).single();
  if (error) throw error;
  return mapPatient(data as PatientRow);
}
