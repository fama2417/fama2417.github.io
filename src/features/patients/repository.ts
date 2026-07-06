import { supabase } from "@/lib/supabase-client";
import type { Patient } from "./mock-data";

const columns = "id, identifier, full_name, birth_date, sex, phone, privacy_consent_at, address, comuna, email, allergies, morbid_history, prevision";

type PatientRow = {
  id: string; identifier: string; full_name: string; birth_date: string; sex: Patient["sex"]; phone: string;
  privacy_consent_at: string | null; address: string; comuna: string; email: string; allergies: string; morbid_history: string; prevision: string;
};

function mapPatient(row: PatientRow): Patient {
  return {
    id: row.id, identifier: row.identifier, name: row.full_name, birthDate: row.birth_date, sex: row.sex, phone: row.phone,
    consentAt: row.privacy_consent_at ?? undefined,
    address: row.address ?? "", comuna: row.comuna ?? "", email: row.email ?? "", allergies: row.allergies ?? "", morbidHistory: row.morbid_history ?? "",
    prevision: row.prevision ?? "",
  };
}

export async function fetchPatients() {
  const { data, error } = await supabase.from("patients").select(columns).order("full_name");
  if (error) throw error;
  return (data as PatientRow[]).map(mapPatient);
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

export async function createPatient(patient: Omit<Patient, "id">) {
  const { data, error } = await supabase.from("patients").insert({
    identifier: patient.identifier,
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
