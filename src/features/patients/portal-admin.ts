import { supabase } from "@/lib/supabase-client";

/**
 * Fase 3A: helpers administrativos del portal de paciente (sin UI todavía).
 * Defensa doble: además de este chequeo, la BD exige admin (trigger protect_patient_link
 * y RPCs release_report_to_patient/revoke_report_release).
 */
async function requireAdmin() {
  const auth = await supabase.auth.getUser();
  const profile = await supabase.from("profiles").select("role").eq("id", auth.data.user?.id ?? "").single();
  if (profile.data?.role !== "admin") throw new Error("Solo un administrador puede realizar esta acción.");
}

/** Vincula la cuenta auth de un paciente a su ficha. Auditado por el trigger de patients. */
export async function linkPatientAccount(patientId: string, userId: string) {
  await requireAdmin();
  // Detección temprana de exclusión staff/paciente; la autoridad final es el trigger protect_patient_link.
  const staff = await supabase.from("profiles").select("id").eq("id", userId).maybeSingle();
  if (staff.data) throw new Error("Esa cuenta pertenece al staff y no puede vincularse como paciente.");
  const { error } = await supabase.from("patients").update({ user_id: userId }).eq("id", patientId);
  if (error) throw error;
}

/** Desvincula la cuenta auth de un paciente. Auditado por el trigger de patients. */
export async function unlinkPatientAccount(patientId: string) {
  await requireAdmin();
  const { error } = await supabase.from("patients").update({ user_id: null }).eq("id", patientId);
  if (error) throw error;
}

/** Libera al paciente el informe definitivo de la cita. Solo informes final; auditado. */
export async function releaseReportToPatient(appointmentId: string) {
  await requireAdmin();
  const { error } = await supabase.rpc("release_report_to_patient", { p_appointment_id: appointmentId });
  if (error) throw error;
}

/** Revoca la liberación vigente del informe de la cita. Auditado. */
export async function revokeReportRelease(appointmentId: string) {
  await requireAdmin();
  const { error } = await supabase.rpc("revoke_report_release", { p_appointment_id: appointmentId });
  if (error) throw error;
}
