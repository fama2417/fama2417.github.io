"use client";

import { useEffect, useState } from "react";
import { appointmentStatusLabels, type AppointmentStatus } from "@/features/appointments/status";
import { supabase } from "@/lib/supabase-client";
import { identifierTypeLabels, type Patient } from "./mock-data";
import { fetchPatient, fetchPatientExams, type PatientExam } from "./repository";

export function PatientHistory({ patientId }: { patientId: string }) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [exams, setExams] = useState<PatientExam[]>([]);
  const [role, setRole] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([fetchPatient(patientId), fetchPatientExams(patientId), supabase.auth.getUser()])
      .then(async ([nextPatient, nextExams, auth]) => {
        setPatient(nextPatient); setExams(nextExams);
        const profile = await supabase.from("profiles").select("role").eq("id", auth.data.user?.id ?? "").single();
        setRole(profile.data?.role ?? "");
      })
      .catch(() => setError("No fue posible cargar la ficha del paciente."));
  }, [patientId]);

  if (error) return <p className="notice" role="alert">{error}</p>;
  if (!patient) return <p className="empty-state">Cargando ficha…</p>;
  const canEditReports = role === "admin" || role === "radiologist";

  return <>
    <div className="page-header"><div><p className="eyebrow">Historial del paciente</p><h2>{patient.name}</h2><p>{identifierTypeLabels[patient.identifierType]} · {patient.identifier}</p></div></div>
    <section className="card patient-summary">
      <dl>
        <div><dt>Fecha de nacimiento</dt><dd>{patient.birthDate}</dd></div>
        <div><dt>Previsión</dt><dd>{patient.prevision || "—"}</dd></div>
        <div><dt>Teléfono</dt><dd>{patient.phone || "—"}</dd></div>
        <div><dt>Correo</dt><dd>{patient.email || "—"}</dd></div>
        <div><dt>Alergias</dt><dd>{patient.allergies || "Sin alergias registradas"}</dd></div>
        <div><dt>Antecedentes mórbidos</dt><dd>{patient.morbidHistory || "Sin antecedentes registrados"}</dd></div>
      </dl>
    </section>
    <section className="card audit-list" aria-label="Exámenes del paciente">
      <h3>Exámenes ({exams.length})</h3>
      {exams.map((exam) => {
        const available = exam.reportStatus === "final" || (canEditReports && exam.reportStatus === "draft");
        const content = <><strong>{exam.date} · {exam.modality} · {exam.reason}</strong><span>{appointmentStatusLabels[exam.status as AppointmentStatus] ?? exam.status}{exam.hasImages && " · con imágenes"}{exam.reportStatus ? ` · informe ${exam.reportStatus === "final" ? "definitivo" : "borrador"}` : " · sin informe"}</span></>;
        return available ? <a className="workflow-entry exam-entry" key={exam.id} href={`/informe/${exam.id}`}>{content}</a> : <div className="workflow-entry" key={exam.id}>{content}</div>;
      })}
      {!exams.length && <p className="empty-inline">Sin exámenes registrados.</p>}
    </section>
  </>;
}
