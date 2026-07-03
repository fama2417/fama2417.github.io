import { supabase } from "@/lib/supabase-client";
import type { Appointment } from "./mock-data";

type AppointmentRow = {
  id: string; patient_id: string; practitioner_name: string; location_name: string; appointment_date: string;
  start_time: string; end_time: string; status: Appointment["status"]; reason: string; modality: Appointment["modality"];
  branch?: string; service?: string; specialty?: string; procedure_code?: string; treating_physician?: string; order_date?: string | null;
  anesthesia?: boolean; contrast?: boolean; priority?: Appointment["priority"]; payment_order?: string; tags?: string;
  diagnostic_hypothesis?: string; comment?: string;
  patient: { full_name: string } | null;
  study: { study_instance_uid: string | null } | null;
};

const baseColumns = "id, patient_id, practitioner_name, location_name, appointment_date, start_time, end_time, status, reason, modality, patient:patients(full_name), study:imaging_studies(study_instance_uid)";
const columns = "id, patient_id, practitioner_name, location_name, appointment_date, start_time, end_time, status, reason, modality, branch, service, specialty, procedure_code, treating_physician, order_date, anesthesia, contrast, priority, payment_order, tags, diagnostic_hypothesis, comment, patient:patients(full_name), study:imaging_studies(study_instance_uid)";

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
  branch: row.branch ?? "",
  service: row.service ?? "",
  specialty: row.specialty ?? "",
  procedureCode: row.procedure_code ?? "",
  treatingPhysician: row.treating_physician ?? "",
  orderDate: row.order_date ?? "",
  anesthesia: row.anesthesia ?? false,
  contrast: row.contrast ?? false,
  priority: row.priority ?? "normal",
  paymentOrder: row.payment_order ?? "",
  tags: row.tags ?? "",
  diagnosticHypothesis: row.diagnostic_hypothesis ?? "",
  comment: row.comment ?? "",
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
  branch: appointment.branch,
  service: appointment.service,
  specialty: appointment.specialty,
  procedure_code: appointment.procedureCode,
  treating_physician: appointment.treatingPhysician,
  order_date: appointment.orderDate || null,
  anesthesia: appointment.anesthesia,
  contrast: appointment.contrast,
  priority: appointment.priority,
  payment_order: appointment.paymentOrder,
  tags: appointment.tags,
  diagnostic_hypothesis: appointment.diagnosticHypothesis,
  comment: appointment.comment,
});

export async function fetchAppointments() {
  const result = await supabase.from("appointments").select(columns).order("appointment_date").order("start_time");
  if (!result.error) return (result.data as unknown as AppointmentRow[]).map(mapAppointment);
  const fallback = await supabase.from("appointments").select(baseColumns).order("appointment_date").order("start_time");
  if (fallback.error) throw fallback.error;
  return (fallback.data as unknown as AppointmentRow[]).map(mapAppointment);
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
