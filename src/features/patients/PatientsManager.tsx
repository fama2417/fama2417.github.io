"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase-client";
import type { Patient } from "./mock-data";
import { createPatient, fetchPatients, fetchPatientAudit, type PatientAuditEntry } from "./repository";

const sexLabels = { female: "Femenino", male: "Masculino", other: "Otro", unknown: "No informado" };
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9áéíóúñ]/g, "");

const actionLabels: Record<string, string> = { INSERT: "Creación", UPDATE: "Modificación", DELETE: "Eliminación" };
const fieldLabels: Record<string, string> = {
  identifier: "Identificador", full_name: "Nombre", birth_date: "Fecha de nacimiento", sex: "Sexo", phone: "Teléfono",
  email: "Correo", address: "Dirección", comuna: "Comuna", prevision: "Previsión", allergies: "Alergias",
  morbid_history: "Antecedentes mórbidos", privacy_consent_at: "Consentimiento",
};

function describeChange(entry: PatientAuditEntry) {
  if (entry.action === "INSERT") return "Creación del registro del paciente.";
  if (entry.action === "DELETE") return "Eliminación del registro.";
  const changes = Object.entries(entry.details ?? {}).filter(([key]) => fieldLabels[key]);
  if (!changes.length) return "Actualización sin cambios en datos personales.";
  return changes.map(([key, value]) => `${fieldLabels[key]}: ${value === null || value === "" ? "—" : String(value)}`).join(" · ");
}

export function PatientsManager() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [audit, setAudit] = useState<PatientAuditEntry[]>([]);
  const [auditError, setAuditError] = useState("");
  const [auditLoading, setAuditLoading] = useState(false);
  const visiblePatients = useMemo(() => {
    const needle = normalize(query);
    return patients.filter((patient) => normalize(`${patient.identifier} ${patient.name}`).includes(needle));
  }, [patients, query]);

  useEffect(() => {
    supabase.auth.getUser()
      .then(({ data }) => supabase.from("profiles").select("role").eq("id", data.user?.id ?? "").single())
      .then(({ data }) => {
        const nextRole = data?.role ?? "";
        setRole(nextRole);
        if (nextRole !== "admin") return [];
        return fetchPatients();
      })
      .then(setPatients)
      .catch(() => setError("No fue posible cargar los pacientes."))
      .finally(() => setLoading(false));
  }, []);

  function openPatient(patient: Patient) {
    setSelected(patient);
    setAudit([]);
    setAuditError("");
    setAuditLoading(true);
    fetchPatientAudit(patient.id)
      .then(setAudit)
      .catch(() => setAuditError("No fue posible cargar la trazabilidad."))
      .finally(() => setAuditLoading(false));
  }

  async function addPatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const identifier = String(form.get("identifier")).trim();
    if (patients.some((patient) => normalize(patient.identifier) === normalize(identifier))) return setError("Ya existe un paciente con ese identificador.");

    try {
      const patient = await createPatient({
        identifier,
        name: String(form.get("name")).trim(),
        birthDate: String(form.get("birthDate")),
        sex: String(form.get("sex")) as Patient["sex"],
        phone: String(form.get("phone")).trim(),
        consentAt: new Date().toISOString(),
        address: String(form.get("address") ?? "").trim(),
        comuna: String(form.get("comuna") ?? "").trim(),
        email: String(form.get("email") ?? "").trim(),
        allergies: String(form.get("allergies") ?? "").trim(),
        morbidHistory: String(form.get("morbidHistory") ?? "").trim(),
        prevision: String(form.get("prevision") ?? "").trim(),
      });
      setPatients((current) => [...current, patient].sort((a, b) => a.name.localeCompare(b.name)));
      formElement.reset();
      setError("");
      setShowForm(false);
    } catch {
      setError("No fue posible guardar el paciente. Revisa que el identificador no esté registrado.");
    }
  }

  if (loading || role === null) return <p className="empty-state">Cargando pacientes…</p>;
  if (role !== "admin") return <p className="notice" role="alert">Acceso reservado a administradores.</p>;

  return (
    <>
      <div className="page-header">
        <div><p className="eyebrow">Registro operativo</p><h2>Pacientes</h2><p>Información protegida en Supabase mediante acceso autenticado y RLS.</p></div>
        <button className="button primary" type="button" onClick={() => setShowForm((visible) => !visible)}>{showForm ? "Cerrar" : "Nuevo paciente"}</button>
      </div>

      {error && !showForm && <p className="notice" role="alert">{error}</p>}

      {showForm && (
        <form className="card clinical-form" onSubmit={addPatient}>
          <label>Identificador<input name="identifier" placeholder="RUN o pasaporte" required /></label>
          <label>Nombre completo<input name="name" required /></label>
          <label>Fecha de nacimiento<input name="birthDate" type="date" required /></label>
          <label>Sexo registral<select name="sex" defaultValue="unknown">{Object.entries(sexLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Teléfono<input name="phone" type="tel" /></label>
          <label>Previsión<input name="prevision" placeholder="FONASA / Isapre / Particular" /></label>
          <label>Correo electrónico<input name="email" type="email" /></label>
          <label>Dirección<input name="address" /></label>
          <label>Comuna<input name="comuna" /></label>
          <label className="span-2">Alergias<input name="allergies" placeholder="Sin alergias conocidas" /></label>
          <label className="span-2">Antecedentes mórbidos<input name="morbidHistory" placeholder="Sin antecedentes relevantes" /></label>
          <label className="consent-field"><input name="consent" type="checkbox" required />El paciente (o su representante) otorgó consentimiento expreso para el tratamiento de sus datos personales y de salud, según la <a href="/privacidad" className="text-button">política de privacidad</a> (Ley 19.628/21.668). Se registrará fecha y usuario.</label>
          <button className="button primary" type="submit">Guardar paciente</button>
          {error && <p className="form-error" role="alert">{error}</p>}
        </form>
      )}

      <section className="toolbar" aria-label="Búsqueda de pacientes"><label className="wide-field">Buscar paciente<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre o identificador" type="search" /></label></section>
      <section className="table-card">
        <table><thead><tr><th>Identificador</th><th>Nombre</th><th>Fecha nacimiento</th><th>Sexo</th><th>Teléfono</th><th>Consentimiento</th></tr></thead><tbody>
          {visiblePatients.map((patient) => <tr className="row-link" key={patient.id} tabIndex={0} onClick={() => openPatient(patient)} onKeyDown={(event) => event.key === "Enter" && openPatient(patient)}><td>{patient.identifier}</td><td>{patient.name}</td><td>{patient.birthDate}</td><td>{sexLabels[patient.sex]}</td><td>{patient.phone || "—"}</td><td>{patient.consentAt ? <span className="status status-completed">Otorgado</span> : <span className="status status-cancelled">Pendiente</span>}</td></tr>)}
        </tbody></table>
        {!loading && !visiblePatients.length && <p className="empty-state">No se encontraron pacientes.</p>}
        {loading && <p className="empty-state">Cargando pacientes…</p>}
      </section>

      {selected && <div className="appointment-info-backdrop" role="dialog" aria-modal="true" aria-label={`Ficha de ${selected.name}`} onClick={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
        <div className="appointment-info patient-detail">
          <div className="card-heading"><div><p className="eyebrow">Ficha del paciente</p><h3>{selected.name}</h3></div><button className="text-button" type="button" onClick={() => setSelected(null)}>Cerrar ✕</button></div>
          <dl>
            <div><dt>Identificador</dt><dd>{selected.identifier}</dd></div>
            <div><dt>Fecha de nacimiento</dt><dd>{selected.birthDate}</dd></div>
            <div><dt>Sexo registral</dt><dd>{sexLabels[selected.sex]}</dd></div>
            <div><dt>Previsión</dt><dd>{selected.prevision || "—"}</dd></div>
            <div><dt>Teléfono</dt><dd>{selected.phone || "—"}</dd></div>
            <div><dt>Correo</dt><dd>{selected.email || "—"}</dd></div>
            <div><dt>Dirección</dt><dd>{[selected.address, selected.comuna].filter(Boolean).join(", ") || "—"}</dd></div>
            <div><dt>Consentimiento</dt><dd>{selected.consentAt ? new Date(selected.consentAt).toLocaleString("es-CL") : "Pendiente"}</dd></div>
            <div><dt>Alergias</dt><dd>{selected.allergies || "Sin alergias registradas"}</dd></div>
            <div><dt>Antecedentes mórbidos</dt><dd>{selected.morbidHistory || "Sin antecedentes registrados"}</dd></div>
          </dl>
          <section className="audit-list" aria-label="Trazabilidad del paciente">
            <h4>Trazabilidad</h4>
            {audit.map((entry) => <div className="workflow-entry" key={entry.id}><strong>{actionLabels[entry.action] ?? entry.action}</strong><span>{new Date(entry.changedAt).toLocaleString("es-CL")} · {entry.actorName}</span><span>{describeChange(entry)}</span></div>)}
            {auditLoading && <p className="empty-inline">Cargando trazabilidad…</p>}
            {!auditLoading && !audit.length && !auditError && <p className="empty-inline">Sin eventos registrados.</p>}
            {auditError && <p className="form-error" role="alert">{auditError}</p>}
          </section>
        </div>
      </div>}
    </>
  );
}
