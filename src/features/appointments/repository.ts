import { supabase } from "@/lib/supabase-client";
import type { Appointment } from "./mock-data";

type AppointmentRow = {
  id: string; patient_id: string; practitioner_name: string; location_name: string; appointment_date: string;
  start_time: string; end_time: string; status: Appointment["status"]; reason: string; modality: Appointment["modality"];
  patient: { full_name: string } | null;
  study: { study_instance_uid: string | null } | null;
};

const columns = "id, patient_id, practitioner_name, location_name, appointment_date, start_time, end_time, status, reason, modality, patient:patients(full_name), study:imaging_studies(study_instance_uid)";

const mapAppointment = (row: AppointmentRow): Appointment => ({
  id: row.id,
  patientId: row.patient_id,
  patientName: row.patient?.full_name ?? "Paciente sin nombre",
  practitionerName: row.practitioner_name,
  locationName: row.location_name,
  date: row.appointment_date,
  startTime: row.start_time.slice(0, 5),
  endTime: row.end_time.slice(0, 5),
  status: row.status,
  reason: row.reason,
  modality: row.modality,
  studyInstanceUid: row.study?.study_instance_uid ?? undefined,
});

const toRow = (appointment: Appointment) => ({
  id: appointment.id,
  patient_id: appointment.patientId,
  practitioner_name: appointment.practitionerName,
  location_name: appointment.locationName,
  appointment_date: appointment.date,
  start_time: appointment.startTime,
  end_time: appointment.endTime,
  status: appointment.status,
  reason: appointment.reason,
  modality: appointment.modality,
});

export async function fetchAppointments() {
  const { data, error } = await supabase.from("appointments").select(columns).order("appointment_date").order("start_time");
  if (error) throw error;
  return (data as unknown as AppointmentRow[]).map(mapAppointment);
}

export async function saveAppointment(appointment: Appointment, exists: boolean) {
  const query = exists ? supabase.from("appointments").update(toRow(appointment)).eq("id", appointment.id) : supabase.from("appointments").insert(toRow(appointment));
  const { error } = await query;
  if (error) throw error;
}

export async function setAppointmentStatus(id: string, status: Appointment["status"]) {
  const { error } = await supabase.from("appointments").update({ status }).eq("id", id);
  if (error) throw error;
}
