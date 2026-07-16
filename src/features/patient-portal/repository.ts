import { authenticatedFetch, supabase } from "@/lib/supabase-client";
import { clinicalAreaForDocumentType, validatePatientDocument, type PhrClinicalArea } from "./documents";
import type { PhrHealthItem, PhrHealthItemDraft } from "./health-summary";
import { cleanPhrImagingSection, structurePhrImagingText, type PhrImagingText } from "./imaging";
import type { PhrLabDraft, PhrLabResult } from "./labs";

export type PhrProfile = {
  userId: string; fullName: string; birthDate: string; identifier: string; createdAt: string;
  bloodType: string; allergies: string; conditions: string; medications: string;
  emergencyContactName: string; emergencyContactPhone: string; emergencyNotes: string;
};

type PhrProfileRow = {
  user_id: string; full_name: string; birth_date: string; identifier: string; created_at: string;
  blood_type: string; allergies: string; conditions: string; medications: string;
  emergency_contact_name: string; emergency_contact_phone: string; emergency_notes: string;
};

const profileColumns = "user_id, full_name, birth_date, identifier, created_at, blood_type, allergies, conditions, medications, emergency_contact_name, emergency_contact_phone, emergency_notes";
const mapPhrProfile = (data: PhrProfileRow): PhrProfile => ({
  userId: data.user_id, fullName: data.full_name, birthDate: data.birth_date, identifier: data.identifier, createdAt: data.created_at,
  bloodType: data.blood_type, allergies: data.allergies, conditions: data.conditions, medications: data.medications,
  emergencyContactName: data.emergency_contact_name, emergencyContactPhone: data.emergency_contact_phone, emergencyNotes: data.emergency_notes,
});

export async function fetchPhrProfile(): Promise<PhrProfile | null> {
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return null;
  const { data, error } = await supabase.from("phr_profiles").select(profileColumns).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data ? mapPhrProfile(data as PhrProfileRow) : null;
}

export async function fetchAccessiblePhrProfiles(): Promise<PhrProfile[]> {
  const { data, error } = await supabase.from("phr_profiles").select(profileColumns).order("full_name");
  if (error) throw error;
  return ((data ?? []) as PhrProfileRow[]).map(mapPhrProfile);
}

export async function savePhrProfile(input: {
  fullName: string; birthDate: string; identifier: string; acceptedPrivacy?: boolean;
  bloodType?: string; allergies?: string; conditions?: string; medications?: string;
  emergencyContactName?: string; emergencyContactPhone?: string; emergencyNotes?: string;
}, exists = false) {
  await authenticatedFetch("/api/portal/account", {
    method: exists ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
}

export async function deletePhrAccount(confirmation: string) {
  await authenticatedFetch("/api/portal/account", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation }) });
}

/**
 * Data layer del Portal de Paciente. Reglas:
 * - Sin service role: siempre el cliente autenticado del navegador.
 * - Ninguna función recibe patientId: el alcance lo decide auth.uid() + RLS
 *   (políticas "patients read ..." de la migración 202607100001).
 * - Solo columnas que el paciente debe ver; nada de confidence, coding ni notas internas.
 */

export type PortalPatient = {
  id: string; identifier: string; identifierType: string; name: string; birthDate: string; sex: string;
  phone: string; email: string; address: string; comuna: string; prevision: string;
  allergies: string; morbidHistory: string; consentAt: string | null; institution: string;
};

export async function fetchCurrentPatients(): Promise<PortalPatient[]> {
  const { data, error } = await supabase.from("patients")
    .select("id, identifier, identifier_type, full_name, birth_date, sex, phone, email, address, comuna, prevision, allergies, morbid_history, privacy_consent_at, tenant:tenants(name)")
    .order("full_name");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id, identifier: row.identifier, identifierType: row.identifier_type ?? "run", name: row.full_name,
    birthDate: row.birth_date, sex: row.sex, phone: row.phone ?? "", email: row.email ?? "",
    address: row.address ?? "", comuna: row.comuna ?? "", prevision: row.prevision ?? "",
    allergies: row.allergies ?? "", morbidHistory: row.morbid_history ?? "", consentAt: row.privacy_consent_at,
    institution: (row.tenant as unknown as { name: string } | null)?.name ?? "",
  })).sort((a, b) => a.institution.localeCompare(b.institution, "es"));
}

export type PortalAppointment = {
  id: string; date: string; time: string; modality: string; reason: string; status: string;
  location: string; institution: string; reportAvailable: boolean;
};

/** Citas propias (RLS). El informe embebido solo aparece si está liberado, gracias a la política del paciente. */
export async function fetchPatientAppointments(): Promise<PortalAppointment[]> {
  const { data, error } = await supabase.from("appointments")
    .select("id, appointment_date, start_time, modality, reason, status, location_name, report:radiology_reports(id), patient:patients!inner(tenant:tenants(name))")
    .order("appointment_date", { ascending: false }).order("start_time", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as { id: string; appointment_date: string; start_time: string; modality: string; reason: string; status: string; location_name: string; report: { id: string } | null; patient: { tenant: { name: string } | null } }[])
    .map((row) => ({
      id: row.id, date: row.appointment_date, time: (row.start_time ?? "").slice(0, 5), modality: row.modality,
      reason: row.reason, status: row.status, location: row.location_name ?? "", institution: row.patient.tenant?.name ?? "", reportAvailable: !!row.report,
    }));
}

export type PortalReport = {
  id: string; appointmentId: string; date: string; time: string; modality: string; reason: string;
  clinicalIndication: string; technique: string; comparison: string; findings: string; impression: string;
  signedAt: string | null; signerName: string; signerRegistration: string; releasedAt: string; institution: string;
};

/** Informes liberados al paciente (RLS ya garantiza final + released + propios). */
export async function fetchReleasedReports(): Promise<PortalReport[]> {
  const { data, error } = await supabase.from("radiology_reports")
    .select("id, appointment_id, clinical_indication, technique, comparison, findings, impression, signed_at, signer_name, signer_registration, released_to_patient_at, appointment:appointments!inner(appointment_date, start_time, modality, reason, patient:patients!inner(tenant:tenants(name)))")
    .order("released_to_patient_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as { id: string; appointment_id: string; clinical_indication: string; technique: string; comparison: string; findings: string; impression: string; signed_at: string | null; signer_name: string; signer_registration: string; released_to_patient_at: string; appointment: { appointment_date: string; start_time: string; modality: string; reason: string; patient: { tenant: { name: string } | null } } }[])
    .map((row) => ({
      id: row.id, appointmentId: row.appointment_id, date: row.appointment.appointment_date,
      time: (row.appointment.start_time ?? "").slice(0, 5), modality: row.appointment.modality, reason: row.appointment.reason,
      clinicalIndication: row.clinical_indication ?? "", technique: row.technique ?? "", comparison: row.comparison ?? "",
      findings: row.findings ?? "", impression: row.impression ?? "",
      signedAt: row.signed_at, signerName: row.signer_name ?? "", signerRegistration: row.signer_registration ?? "",
      releasedAt: row.released_to_patient_at, institution: row.appointment.patient.tenant?.name ?? "",
    }));
}

export type PortalKeyImage = { id: string; appointmentId: string; caption: string; url: string };

/** Imágenes clave tipo captura de informes liberados (RLS en filas y en storage).
 * Las instancias PACS directas quedan fuera (requieren el proxy staff). */
export async function fetchReleasedKeyImages(): Promise<PortalKeyImage[]> {
  const { data, error } = await supabase.from("report_key_images")
    .select("id, appointment_id, instance_id, caption").order("created_at");
  if (error) throw error;
  const captures = ((data ?? []) as { id: string; appointment_id: string; instance_id: string; caption: string }[])
    .filter((row) => row.instance_id.includes("/"));
  const signed = await Promise.all(captures.map(async (row) => {
    const { data: url } = await supabase.storage.from("capturas").createSignedUrl(row.instance_id, 3600);
    return url?.signedUrl ? { id: row.id, appointmentId: row.appointment_id, caption: row.caption ?? "", url: url.signedUrl } : null;
  }));
  return signed.filter((item): item is PortalKeyImage => !!item);
}

export type PortalAddendum = { id: string; appointmentId: string; text: string; signedAt: string; signerName: string };

/** Addenda visibles (RLS: solo de informes propios liberados). */
export async function fetchReleasedAddenda(): Promise<PortalAddendum[]> {
  const { data, error } = await supabase.from("report_addenda")
    .select("id, appointment_id, text, signed_at, signer_name").order("signed_at");
  if (error) throw error;
  return ((data ?? []) as { id: string; appointment_id: string; text: string; signed_at: string; signer_name: string }[])
    .map((row) => ({ id: row.id, appointmentId: row.appointment_id, text: row.text, signedAt: row.signed_at, signerName: row.signer_name ?? "" }));
}

export type PortalDocument = {
  id: string; filename: string; mimeType: string; sizeBytes: number; documentDate: string | null;
  documentType: "imaging" | "laboratory" | "prescription" | "other"; clinicalArea: PhrClinicalArea; sourceInstitution: string; createdAt: string; url: string;
  extractedText?: PhrImagingText | null;
  sharedPatientIds: string[]; reviewByPatientId: Record<string, "accepted" | "rejected">;
};

export async function fetchPatientDocuments(ownerUserId?: string): Promise<PortalDocument[]> {
  let documentQuery = supabase.from("patient_documents")
    .select("id, original_filename, storage_path, mime_type, size_bytes, document_date, document_type, clinical_area, source_institution, created_at, extracted_text")
    .order("document_date", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
  if (ownerUserId) documentQuery = documentQuery.eq("owner_user_id", ownerUserId);
  const [documents, shares, reviews] = await Promise.all([
    documentQuery,
    supabase.from("patient_document_shares").select("document_id, patient_id").is("revoked_at", null),
    supabase.from("patient_document_reviews").select("document_id, patient_id, status, created_at").order("created_at", { ascending: false }),
  ]);
  if (documents.error || shares.error || reviews.error) throw documents.error ?? shares.error ?? reviews.error;
  const rows = (documents.data ?? []) as { id: string; original_filename: string; storage_path: string; mime_type: string; size_bytes: number; document_date: string | null; document_type: PortalDocument["documentType"]; clinical_area: PhrClinicalArea; source_institution: string; created_at: string; extracted_text: PhrImagingText }[];
  const sharedByDocument = new Map<string, string[]>();
  for (const share of shares.data ?? []) sharedByDocument.set(share.document_id, [...(sharedByDocument.get(share.document_id) ?? []), share.patient_id]);
  const reviewedByDocument = new Map<string, Record<string, "accepted" | "rejected">>();
  for (const review of reviews.data ?? []) {
    if (!review.document_id) continue;
    const current = reviewedByDocument.get(review.document_id) ?? {};
    if (!current[review.patient_id]) current[review.patient_id] = review.status as "accepted" | "rejected";
    reviewedByDocument.set(review.document_id, current);
  }
  return Promise.all(rows.map(async (row) => {
    const signed = await supabase.storage.from("patient-documents").createSignedUrl(row.storage_path, 3600);
    if (signed.error) throw signed.error;
    const savedText = row.extracted_text?.fullText ? row.extracted_text : null;
    const baseText = savedText && !savedText.findings && !savedText.impression ? structurePhrImagingText(savedText.fullText) : savedText;
    const extractedText = baseText ? {
      ...baseText, clinicalIndication: cleanPhrImagingSection(baseText.clinicalIndication), technique: cleanPhrImagingSection(baseText.technique), findings: cleanPhrImagingSection(baseText.findings), impression: cleanPhrImagingSection(baseText.impression), plainLanguage: baseText.plainLanguage ?? "",
    } : null;
    return {
      id: row.id, filename: row.original_filename, mimeType: row.mime_type, sizeBytes: row.size_bytes,
      documentDate: row.document_date, documentType: row.document_type, clinicalArea: row.clinical_area ?? clinicalAreaForDocumentType(row.document_type), sourceInstitution: row.source_institution,
      createdAt: row.created_at, url: signed.data.signedUrl, extractedText,
      sharedPatientIds: sharedByDocument.get(row.id) ?? [], reviewByPatientId: reviewedByDocument.get(row.id) ?? {},
    };
  }));
}

export async function fetchPhrHealthItems(ownerUserId: string): Promise<PhrHealthItem[]> {
  const { data, error } = await supabase.from("phr_health_items")
    .select("id, owner_user_id, kind, label, status, event_date, source, source_document_id, notes, created_at, updated_at")
    .eq("owner_user_id", ownerUserId).order("kind").order("status").order("event_date", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id, ownerUserId: row.owner_user_id, kind: row.kind, label: row.label, status: row.status,
    eventDate: row.event_date ?? "", source: row.source, sourceDocumentId: row.source_document_id ?? "",
    notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at,
  })) as PhrHealthItem[];
}

export async function savePhrHealthItem(value: PhrHealthItemDraft, id?: string) {
  await authenticatedFetch("/api/portal/health-items", { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...value }) });
}

export async function deletePhrHealthItem(id: string) {
  await authenticatedFetch(`/api/portal/health-items?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function uploadPatientDocument(input: { file: File; documentDate: string; documentType: PortalDocument["documentType"]; clinicalArea?: PhrClinicalArea; sourceInstitution: string }) {
  const validation = validatePatientDocument(input.file);
  if (validation) throw new Error(validation);
  const form = new FormData();
  form.set("file", input.file); form.set("documentDate", input.documentDate); form.set("documentType", input.documentType); form.set("clinicalArea", input.clinicalArea ?? clinicalAreaForDocumentType(input.documentType)); form.set("sourceInstitution", input.sourceInstitution);
  await authenticatedFetch("/api/portal/documents", { method: "POST", body: form });
}

export async function setPatientDocumentShare(documentId: string, patientId: string, shared: boolean) {
  await authenticatedFetch("/api/portal/documents", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId, patientId, shared }),
  });
}

export async function deletePatientDocument(documentId: string) {
  await authenticatedFetch(`/api/portal/documents?documentId=${encodeURIComponent(documentId)}`, { method: "DELETE" });
}

type PhrLabRow = {
  id: string; document_id: string; loinc_code: string; analyte: string; value_num: number | null; value_text: string;
  unit: string; ref_low: number | null; ref_high: number | null; ref_text: string; flag: PhrLabResult["flag"];
  observed_at: string; source: PhrLabResult["source"]; source_sentence: string; review_status: PhrLabResult["reviewStatus"];
};

export async function fetchPhrLabResults(ownerUserId?: string): Promise<PhrLabResult[]> {
  let query = supabase.from("phr_lab_results")
    .select("id, document_id, loinc_code, analyte, value_num, value_text, unit, ref_low, ref_high, ref_text, flag, observed_at, source, source_sentence, review_status")
    .order("observed_at", { ascending: false }).order("analyte");
  if (ownerUserId) query = query.eq("owner_user_id", ownerUserId);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as PhrLabRow[];
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
    id: row.id, documentId: row.document_id, loincCode: row.loinc_code, analyte: row.analyte,
    valueNum: row.value_num, valueText: row.value_text, unit: row.unit, refLow: row.ref_low,
    refHigh: row.ref_high, refText: row.ref_text, flag: row.flag, observedAt: row.observed_at,
    source: row.source, sourceSentence: row.source_sentence, reviewStatus: row.review_status, loincMetadata: metadataByCode.get(row.loinc_code),
  }));
}

export async function extractPhrImagingText(documentId: string) {
  const response = await authenticatedFetch("/api/portal/imaging", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId }) });
  return (await response.json() as { text: PhrImagingText }).text;
}

export async function savePhrImagingText(documentId: string, text: PhrImagingText) {
  await authenticatedFetch("/api/portal/imaging", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId, text }) });
}

export async function analyzePhrLabDocument(documentId: string, rematch = false, rescan = false) {
  const response = await authenticatedFetch("/api/portal/labs", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId, rematch, rescan }),
  });
  return await response.json() as { created: number; loincMapped: number; duplicate: boolean; warnings: string[] };
}

export type PhrLoincSuggestion = { resultId: string; analyte: string; currentCode: string; recommendedCode: string; options: { code: string; display: string }[] };

export async function fetchPhrLoincSuggestions(documentId: string) {
  const response = await authenticatedFetch("/api/portal/labs", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId, suggestLoinc: true }),
  });
  return await response.json() as { suggestions: PhrLoincSuggestion[]; warnings: string[] };
}

export async function savePhrLoincSelections(selections: { resultId: string; loincCode: string }[]) {
  const response = await authenticatedFetch("/api/portal/labs", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ loincSelections: selections }),
  });
  return await response.json() as { updated: number };
}

export async function savePhrLabResult(resultId: string, draft: PhrLabDraft, confirm = false) {
  await authenticatedFetch("/api/portal/labs", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resultId, confirm, ...draft }),
  });
}

export async function discardPhrLabResult(resultId: string) {
  await authenticatedFetch(`/api/portal/labs?resultId=${encodeURIComponent(resultId)}`, { method: "DELETE" });
}

export type PortalDocumentRequest = { id: string; patientId: string; institution: string; message: string; createdAt: string };

export async function fetchPatientDocumentRequests(): Promise<PortalDocumentRequest[]> {
  const { data, error } = await supabase.from("patient_document_requests")
    .select("id, patient_id, message, created_at, patient:patients!inner(tenant:tenants(name))").eq("status", "pending").order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as { id: string; patient_id: string; message: string; created_at: string; patient: { tenant: { name: string } | null } }[]).map((row) => ({
    id: row.id, patientId: row.patient_id, institution: row.patient.tenant?.name ?? "Institución", message: row.message, createdAt: row.created_at,
  }));
}

export async function respondToDocumentRequest(requestId: string, status: "approved" | "rejected", documentIds: string[] = []) {
  await authenticatedFetch("/api/portal/document-requests", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, status, documentIds }) });
}

export async function downloadFhirBundle() {
  const response = await authenticatedFetch("/api/portal/fhir");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a"); link.href = url; link.download = "mi-registro-fhir.json"; link.click(); URL.revokeObjectURL(url);
}

export async function confirmPhrLabResults(resultIds: string[]) {
  const response = await authenticatedFetch("/api/portal/labs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resultIds, confirm: true }) });
  return await response.json() as { confirmed: number };
}

export async function fetchPhrLabSource(resultId: string) {
  const response = await authenticatedFetch(`/api/portal/labs?resultId=${encodeURIComponent(resultId)}`);
  return { url: URL.createObjectURL(await response.blob()), contentType: response.headers.get("Content-Type") ?? "application/pdf", highlighted: response.headers.get("X-PHR-Highlight") === "true", page: Math.max(1, Number(response.headers.get("X-PHR-Page")) || 1) };
}

export type PhrFavorite = { trendKey: string; label: string };

export async function fetchPhrFavorites(ownerUserId: string): Promise<PhrFavorite[]> {
  const { data, error } = await supabase.from("phr_biomarker_favorites").select("trend_key, label").eq("owner_user_id", ownerUserId).order("label");
  if (error) throw error;
  return (data ?? []).map((row) => ({ trendKey: row.trend_key, label: row.label }));
}

export async function setPhrFavorite(trendKey: string, label: string, favorite: boolean) {
  await authenticatedFetch("/api/portal/favorites", { method: favorite ? "POST" : "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trendKey, label }) });
}

export async function downloadPhrFile(path: "/api/portal/trends" | "/api/portal/summary", filename: string, format?: "csv" | "pdf") {
  const response = await authenticatedFetch(`${path}${format ? `?format=${format}` : ""}`);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

export type PhrShare = { id: string; title: string; expiresAt: string; revokedAt: string | null; createdAt: string; accessCount: number; lastAccessedAt: string | null };

export async function fetchPhrShares(): Promise<PhrShare[]> {
  const response = await authenticatedFetch("/api/portal/shares");
  return (await response.json() as { shares: PhrShare[] }).shares;
}

export async function createPhrShare(input: { title: string; expiresInDays: number; documentIds: string[]; trendKeys: string[]; includeEmergency: boolean }) {
  const response = await authenticatedFetch("/api/portal/shares", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return await response.json() as { url: string };
}

export async function revokePhrShare(shareId: string) {
  await authenticatedFetch(`/api/portal/shares?shareId=${encodeURIComponent(shareId)}`, { method: "DELETE" });
}

export type PhrCaregiver = { id: string; email: string; relationship: "family" | "caregiver"; createdAt: string; revokedAt: string | null };

export async function fetchPhrCaregivers(): Promise<PhrCaregiver[]> {
  const response = await authenticatedFetch("/api/portal/caregivers");
  return (await response.json() as { caregivers: PhrCaregiver[] }).caregivers;
}

export async function addPhrCaregiver(email: string, relationship: PhrCaregiver["relationship"]) {
  const response = await authenticatedFetch("/api/portal/caregivers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, relationship }) });
  return await response.json() as { invited: boolean };
}

export async function revokePhrCaregiver(grantId: string) {
  await authenticatedFetch(`/api/portal/caregivers?grantId=${encodeURIComponent(grantId)}`, { method: "DELETE" });
}
