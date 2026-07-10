"use client";

import { identifierTypeLabels, sexLabels, type Patient } from "./types";

export function patientAge(birthDate: string) {
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

export function PatientClinicalHeader({ patient, onEdit }: { patient: Patient; onEdit?: () => void }) {
  const age = patientAge(patient.birthDate);
  const initials = patient.name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  return (
    <section className="card clinical-header-panel" aria-label="Ficha clínica del paciente">
      <div className="clinical-identity">
        <span className="patient-avatar" aria-hidden="true">{initials}</span>
        <div>
          <p className="eyebrow">Ficha clínica del paciente</p>
          <h2>{patient.name}</h2>
          <p className="patient-idline">{identifierTypeLabels[patient.identifierType]} {patient.identifier} · {sexLabels[patient.sex]}{age !== null && ` · ${age} años`}{patient.prevision && ` · ${patient.prevision}`}</p>
        </div>
        {onEdit && <button className="button secondary" type="button" onClick={onEdit}>Editar paciente</button>}
      </div>
      <div className="clinical-alerts" aria-label="Antecedentes clínicos relevantes">
        <div className={patient.allergies ? "clinical-alert warning" : "clinical-alert"}>
          <span className="clinical-alert-label">Alergias</span>
          <strong>{patient.allergies || "Sin alergias registradas"}</strong>
        </div>
        <div className={patient.morbidHistory ? "clinical-alert warning" : "clinical-alert"}>
          <span className="clinical-alert-label">Antecedentes mórbidos</span>
          <strong>{patient.morbidHistory || "Sin antecedentes registrados"}</strong>
        </div>
      </div>
      <div className="patient-summary" aria-label="Datos administrativos">
        <dl>
          <div><dt>Fecha de nacimiento</dt><dd>{patient.birthDate}{age !== null && ` (${age} años)`}</dd></div>
          {!patient.prevision && <div><dt>Previsión</dt><dd>—</dd></div>}
          <div><dt>Teléfono</dt><dd>{patient.phone || "—"}</dd></div>
          <div><dt>Correo</dt><dd>{patient.email || "—"}</dd></div>
          <div><dt>Dirección</dt><dd>{[patient.address, patient.comuna].filter(Boolean).join(", ") || "—"}</dd></div>
          <div><dt>Consentimiento</dt><dd>{patient.consentAt ? new Date(patient.consentAt).toLocaleString("es-CL") : "Pendiente"}</dd></div>
        </dl>
      </div>
    </section>
  );
}
