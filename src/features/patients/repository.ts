import { supabase } from "@/lib/supabase-client";
import type { Patient } from "./mock-data";

const columns = "id, identifier, full_name, birth_date, sex, phone";

function mapPatient(row: { id: string; identifier: string; full_name: string; birth_date: string; sex: Patient["sex"]; phone: string }): Patient {
  return { id: row.id, identifier: row.identifier, name: row.full_name, birthDate: row.birth_date, sex: row.sex, phone: row.phone };
}

export async function fetchPatients() {
  const { data, error } = await supabase.from("patients").select(columns).order("full_name");
  if (error) throw error;
  return data.map(mapPatient);
}

export async function createPatient(patient: Omit<Patient, "id">) {
  const { data, error } = await supabase.from("patients").insert({
    identifier: patient.identifier,
    full_name: patient.name,
    birth_date: patient.birthDate,
    sex: patient.sex,
    phone: patient.phone,
  }).select(columns).single();
  if (error) throw error;
  return mapPatient(data);
}
