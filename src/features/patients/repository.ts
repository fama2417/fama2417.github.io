import { supabase } from "@/lib/supabase-client";
import type { Patient } from "./mock-data";

const columns = "id, identifier, full_name, birth_date, sex, phone, privacy_consent_at, address, comuna, email, allergies, morbid_history";

type PatientRow = {
  id: string; identifier: string; full_name: string; birth_date: string; sex: Patient["sex"]; phone: string;
  privacy_consent_at: string | null; address: string; comuna: string; email: string; allergies: string; morbid_history: string;
};

function mapPatient(row: PatientRow): Patient {
  return {
    id: row.id, identifier: row.identifier, name: row.full_name, birthDate: row.birth_date, sex: row.sex, phone: row.phone,
    consentAt: row.privacy_consent_at ?? undefined,
    address: row.address ?? "", comuna: row.comuna ?? "", email: row.email ?? "", allergies: row.allergies ?? "", morbidHistory: row.morbid_history ?? "",
  };
}

export async function fetchPatients() {
  const { data, error } = await supabase.from("patients").select(columns).order("full_name");
  if (error) throw error;
  return (data as PatientRow[]).map(mapPatient);
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
  }).select(columns).single();
  if (error) throw error;
  return mapPatient(data as PatientRow);
}
