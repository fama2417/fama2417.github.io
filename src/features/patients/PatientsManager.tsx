"use client";

import { FormEvent, useMemo, useState } from "react";
import { useStoredCollection } from "@/lib/storage";
import { patients as initialPatients, type Patient } from "./mock-data";

const sexLabels = { female: "Femenino", male: "Masculino", other: "Otro", unknown: "No informado" };
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9áéíóúñ]/g, "");

export function PatientsManager() {
  const [patients, setPatients] = useStoredCollection<Patient>("agenda-patients", initialPatients);
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const visiblePatients = useMemo(() => {
    const needle = normalize(query);
    return patients.filter((patient) => normalize(`${patient.identifier} ${patient.name}`).includes(needle));
  }, [patients, query]);

  function addPatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const identifier = String(form.get("identifier")).trim();
    if (patients.some((patient) => normalize(patient.identifier) === normalize(identifier))) {
      setError("Ya existe un paciente con ese identificador.");
      return;
    }

    setPatients((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        identifier,
        name: String(form.get("name")).trim(),
        birthDate: String(form.get("birthDate")),
        sex: String(form.get("sex")) as Patient["sex"],
        phone: String(form.get("phone")).trim(),
      },
    ]);
    event.currentTarget.reset();
    setError("");
    setShowForm(false);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Registro operativo</p>
          <h2>Pacientes</h2>
          <p>Datos de demostración guardados sólo en este navegador.</p>
        </div>
        <button className="button primary" type="button" onClick={() => setShowForm((visible) => !visible)}>
          {showForm ? "Cerrar" : "Nuevo paciente"}
        </button>
      </div>

      {showForm && (
        <form className="card clinical-form" onSubmit={addPatient}>
          <label>Identificador<input name="identifier" placeholder="RUN o pasaporte" required /></label>
          <label>Nombre completo<input name="name" required /></label>
          <label>Fecha de nacimiento<input name="birthDate" type="date" required /></label>
          <label>Sexo registral<select name="sex" defaultValue="unknown">
            {Object.entries(sexLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label>Teléfono<input name="phone" type="tel" /></label>
          <button className="button primary" type="submit">Guardar paciente</button>
          {error && <p className="form-error" role="alert">{error}</p>}
        </form>
      )}

      <section className="toolbar" aria-label="Búsqueda de pacientes">
        <label className="wide-field">Buscar paciente
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre o identificador" type="search" />
        </label>
      </section>

      <section className="table-card">
        <table>
          <thead><tr><th>Identificador</th><th>Nombre</th><th>Fecha nacimiento</th><th>Sexo</th><th>Teléfono</th></tr></thead>
          <tbody>
            {visiblePatients.map((patient) => (
              <tr key={patient.id}><td>{patient.identifier}</td><td>{patient.name}</td><td>{patient.birthDate}</td><td>{sexLabels[patient.sex]}</td><td>{patient.phone || "—"}</td></tr>
            ))}
          </tbody>
        </table>
        {!visiblePatients.length && <p className="empty-state">No se encontraron pacientes.</p>}
      </section>
    </>
  );
}
