import { supabase } from "@/lib/supabase-client";
import type { Appointment } from "./mock-data";

type AppointmentRow = {
  id: string; patient_id: string; practitioner_name: string; location_name: string; appointment_date: string;
  start_time: string; end_time: string; status: Appointment["status"]; reason: string; modality: Appointment["modality"];
  branch?: string; service?: string; specialty?: string; procedure_code?: string; treating_physician?: string; order_date?: string | null;
  anesthesia?: boolean; contrast?: boolean; priority?: Appointment["priority"]; payment_order?: string; tags?: string;
  anamnesis?: string; diagnostic_hypothesis?: string; comment?: string;
  requester_type?: Appointment["requesterType"]; requester_name?: string; requester_run?: string; requester_email?: string;
  pickup_name?: string; pickup_run?: string; pickup_phone?: string;
  origin_type?: Appointment["originType"]; origin_desc?: string; status_reason?: string; order_file?: string;
  patient: { full_name: string; identifier?: string; prevision?: string } | null;
  study: { study_instance_uid: string | null } | null;
  report?: { status: "draft" | "final"; critical_finding: boolean } | null;
  followups?: { status: "pending" | "acknowledged" | "completed" }[] | null;
  assigned_to?: string | null;
  assignee?: { full_name: string } | null;
};

const baseColumns = "id, patient_id, practitioner_name, location_name, appointment_date, start_time, end_time, status, reason, modality, patient:patients(full_name, identifier, prevision), study:imaging_studies(study_instance_uid)";
const columns = "id, patient_id, practitioner_name, location_name, appointment_date, start_time, end_time, status, reason, modality, branch, service, specialty, procedure_code, treating_physician, order_date, anesthesia, contrast, priority, payment_order, tags, anamnesis, diagnostic_hypothesis, comment, requester_type, requester_name, requester_run, requester_email, pickup_name, pickup_run, pickup_phone, origin_type, origin_desc, status_reason, order_file, assigned_to, patient:patients(full_name, identifier, prevision), study:imaging_studies(study_instance_uid), report:radiology_reports(status, critical_finding), followups:report_follow_ups(status), assignee:profiles(full_name)";

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
  anamnesis: row.anamnesis ?? "",
  diagnosticHypothesis: row.diagnostic_hypothesis ?? "",
  comment: row.comment ?? "",
  requesterType: row.requester_type ?? "interno",
  requesterName: row.requester_name ?? "",
  requesterRun: row.requester_run ?? "",
  requesterEmail: row.requester_email ?? "",
  pickupName: row.pickup_name ?? "",
  pickupRun: row.pickup_run ?? "",
  pickupPhone: row.pickup_phone ?? "",
  originType: row.origin_type ?? "interna",
  originDesc: row.origin_desc ?? "",
  statusReason: row.status_reason ?? "",
  orderFile: row.order_file ?? "",
  reportStatus: row.report?.status,
  criticalFinding: row.report?.critical_finding ?? false,
  actionablePending: row.followups?.some((item) => item.status !== "completed") ?? false,
  assignedTo: row.assigned_to ?? undefined,
  assigneeName: row.assignee?.full_name,
  patientIdentifier: row.patient?.identifier ?? "",
  patientPrevision: row.patient?.prevision ?? "",
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
  anamnesis: appointment.anamnesis,
  diagnostic_hypothesis: appointment.diagnosticHypothesis,
  comment: appointment.comment,
  requester_type: appointment.requesterType,
  requester_name: appointment.requesterName,
  requester_run: appointment.requesterRun,
  requester_email: appointment.requesterEmail,
  pickup_name: appointment.pickupName,
  pickup_run: appointment.pickupRun,
  pickup_phone: appointment.pickupPhone,
  origin_type: appointment.originType,
  origin_desc: appointment.originDesc,
  status_reason: appointment.statusReason,
  order_file: appointment.orderFile,
  assigned_to: appointment.assignedTo ?? null,
});

export async function fetchAppointments() {
  const result = await supabase.from("appointments").select(columns).order("appointment_date").order("start_time");
  if (!result.error) return (result.data as unknown as AppointmentRow[]).map(mapAppointment);
  const fallback = await supabase.from("appointments").select(baseColumns).order("appointment_date").order("start_time");
  if (fallback.error) throw fallback.error;
  return (fallback.data as unknown as AppointmentRow[]).map(mapAppointment);
}

export async function assignAppointment(id: string, profileId: string | null) {
  const { error } = await supabase.from("appointments").update({ assigned_to: profileId }).eq("id", id);
  if (error) throw error;
}

/** Solo devuelve resultados para admins (RLS de profiles); para el resto queda vacío y la UI oculta la asignación. */
export async function fetchRadiologists() {
  const { data, error } = await supabase.from("profiles").select("id, full_name").eq("role", "radiologist").order("full_name");
  if (error) return [];
  return (data ?? []) as { id: string; full_name: string }[];
}

export async function saveAppointment(appointment: Appointment, exists: boolean) {
  const query = exists ? supabase.from("appointments").update(toRow(appointment)).eq("id", appointment.id) : supabase.from("appointments").insert(toRow(appointment));
  const { error } = await query;
  if (error) throw error;
}

export async function setAppointmentStatus(id: string, status: Appointment["status"], reason = "") {
  const { error } = await supabase.from("appointments").update({ status, status_reason: reason }).eq("id", id);
  if (error) throw error;
}

export async function uploadOrderFile(appointmentId: string, file: File) {
  const path = `${appointmentId}/${file.name}`;
  const { error } = await supabase.storage.from("ordenes").upload(path, file, { upsert: true });
  if (error) throw error;
  const { error: linkError } = await supabase.from("appointments").update({ order_file: path }).eq("id", appointmentId);
  if (linkError) throw linkError;
  return path;
}

export async function orderFileUrl(path: string) {
  const { data, error } = await supabase.storage.from("ordenes").createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}
