import { supabase } from "@/lib/supabase-client";

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

export async function fetchCurrentPatient(): Promise<PortalPatient | null> {
  const { data, error } = await supabase.from("patients")
    .select("id, identifier, identifier_type, full_name, birth_date, sex, phone, email, address, comuna, prevision, allergies, morbid_history, privacy_consent_at, tenant:tenants(name)")
    .limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id, identifier: data.identifier, identifierType: data.identifier_type ?? "run", name: data.full_name,
    birthDate: data.birth_date, sex: data.sex, phone: data.phone ?? "", email: data.email ?? "",
    address: data.address ?? "", comuna: data.comuna ?? "", prevision: data.prevision ?? "",
    allergies: data.allergies ?? "", morbidHistory: data.morbid_history ?? "", consentAt: data.privacy_consent_at,
    institution: (data.tenant as unknown as { name: string } | null)?.name ?? "",
  };
}

export type PortalAppointment = {
  id: string; date: string; time: string; modality: string; reason: string; status: string;
  location: string; reportAvailable: boolean;
};

/** Citas propias (RLS). El informe embebido solo aparece si está liberado, gracias a la política del paciente. */
export async function fetchPatientAppointments(): Promise<PortalAppointment[]> {
  const { data, error } = await supabase.from("appointments")
    .select("id, appointment_date, start_time, modality, reason, status, location_name, report:radiology_reports(id)")
    .order("appointment_date", { ascending: false }).order("start_time", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as { id: string; appointment_date: string; start_time: string; modality: string; reason: string; status: string; location_name: string; report: { id: string } | null }[])
    .map((row) => ({
      id: row.id, date: row.appointment_date, time: (row.start_time ?? "").slice(0, 5), modality: row.modality,
      reason: row.reason, status: row.status, location: row.location_name ?? "", reportAvailable: !!row.report,
    }));
}

export type PortalReport = {
  id: string; appointmentId: string; date: string; time: string; modality: string; reason: string;
  clinicalIndication: string; technique: string; comparison: string; findings: string; impression: string;
  signedAt: string | null; signerName: string; signerRegistration: string; releasedAt: string;
};

/** Informes liberados al paciente (RLS ya garantiza final + released + propios). */
export async function fetchReleasedReports(): Promise<PortalReport[]> {
  const { data, error } = await supabase.from("radiology_reports")
    .select("id, appointment_id, clinical_indication, technique, comparison, findings, impression, signed_at, signer_name, signer_registration, released_to_patient_at, appointment:appointments!inner(appointment_date, start_time, modality, reason)")
    .order("released_to_patient_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as { id: string; appointment_id: string; clinical_indication: string; technique: string; comparison: string; findings: string; impression: string; signed_at: string | null; signer_name: string; signer_registration: string; released_to_patient_at: string; appointment: { appointment_date: string; start_time: string; modality: string; reason: string } }[])
    .map((row) => ({
      id: row.id, appointmentId: row.appointment_id, date: row.appointment.appointment_date,
      time: (row.appointment.start_time ?? "").slice(0, 5), modality: row.appointment.modality, reason: row.appointment.reason,
      clinicalIndication: row.clinical_indication ?? "", technique: row.technique ?? "", comparison: row.comparison ?? "",
      findings: row.findings ?? "", impression: row.impression ?? "",
      signedAt: row.signed_at, signerName: row.signer_name ?? "", signerRegistration: row.signer_registration ?? "",
      releasedAt: row.released_to_patient_at,
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
