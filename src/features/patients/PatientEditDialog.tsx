"use client";

import { useState, type FormEvent } from "react";
import type { Patient } from "./types";
import { buildPatientPatch } from "./patient-edit";
import { updatePatient } from "./repository";

export function PatientEditDialog({ patient, onClose, onSaved }: { patient: Patient; onClose: () => void; onSaved: (updated: Patient) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const result = buildPatientPatch(Object.fromEntries(new FormData(event.currentTarget)));
    if ("error" in result) { setError(result.error); return; }
    setSaving(true);
    try {
      onSaved(await updatePatient(patient.id, result.patch));
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "No fue posible guardar los cambios.");
      setSaving(false);
    }
  }

  return (
    <div className="appointment-info-backdrop" role="dialog" aria-modal="true" aria-label="Editar paciente" onClick={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <form className="appointment-info clinical-form patient-edit-dialog" onSubmit={submit}>
        <div className="card-heading"><div><p className="eyebrow">Edición administrativa</p><h3>{patient.name}</h3></div><button className="text-button" type="button" onClick={onClose} disabled={saving}>Cerrar ✕</button></div>
        <label>Teléfono<input name="phone" type="tel" defaultValue={patient.phone} /></label>
        <label>Correo electrónico<input name="email" type="email" defaultValue={patient.email} /></label>
        <label>Dirección<input name="address" defaultValue={patient.address} /></label>
        <label>Comuna<input name="comuna" defaultValue={patient.comuna} /></label>
        <label>Previsión<input name="prevision" defaultValue={patient.prevision} placeholder="FONASA / Isapre / Particular" /></label>
        <label className="span-2">Alergias<input name="allergies" defaultValue={patient.allergies} placeholder="Sin alergias conocidas" /></label>
        <label className="span-2">Antecedentes mórbidos<input name="morbidHistory" defaultValue={patient.morbidHistory} placeholder="Sin antecedentes relevantes" /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button className="button primary" type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
          <button className="button secondary" type="button" onClick={onClose} disabled={saving}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}
