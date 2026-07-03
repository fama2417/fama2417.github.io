"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Patient } from "./mock-data";
import { createPatient, fetchPatients } from "./repository";

const sexLabels = { female: "Femenino", male: "Masculino", other: "Otro", unknown: "No informado" };
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9áéíóúñ]/g, "");

export function PatientsManager() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const visiblePatients = useMemo(() => {
    const needle = normalize(query);
    return patients.filter((patient) => normalize(`${patient.identifier} ${patient.name}`).includes(needle));
  }, [patients, query]);

  useEffect(() => {
    fetchPatients().then(setPatients).catch(() => setError("No fue posible cargar los pacientes.")).finally(() => setLoading(false));
  }, []);

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

  return (
    <>
      <div className="page-header">
        <div><p className="eyebrow">Registro operativo</p><h2>Pacientes</h2><p>Información protegida en Supabase mediante acceso autenticado y RLS.</p></div>
        <button className="button primary" type="button" onClick={() => setShowForm((visible) => !visible)}>{showForm ? "Cerrar" : "Nuevo paciente"}</button>
      </div>

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
          {visiblePatients.map((patient) => <tr key={patient.id}><td>{patient.identifier}</td><td>{patient.name}</td><td>{patient.birthDate}</td><td>{sexLabels[patient.sex]}</td><td>{patient.phone || "—"}</td><td>{patient.consentAt ? <span className="status status-completed">Otorgado</span> : <span className="status status-cancelled">Pendiente</span>}</td></tr>)}
        </tbody></table>
        {!loading && !visiblePatients.length && <p className="empty-state">No se encontraron pacientes.</p>}
        {loading && <p className="empty-state">Cargando pacientes…</p>}
      </section>
    </>
  );
}
