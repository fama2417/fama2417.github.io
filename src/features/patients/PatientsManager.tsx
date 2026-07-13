"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-client";
import { identifierTypeLabels, sexLabels, type Patient } from "./types";
import { createPatient, fetchPatients } from "./repository";
import { hasMinimumPatientSearch } from "./search";

const PAGE_SIZE = 50;
const STAFF_ROLES = ["admin", "operator", "radiologist", "clinician"];
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9áéíóúñ]/g, "");

export function PatientsManager() {
  const router = useRouter();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser()
      .then(({ data }) => supabase.from("profiles").select("role").eq("id", data.user?.id ?? "").single())
      .then(({ data }) => setRole(data?.role ?? ""))
      .catch(() => { setError("No fue posible cargar los pacientes."); setLoading(false); });
  }, []);

  useEffect(() => {
    if (role === null || !STAFF_ROLES.includes(role)) { if (role !== null) setLoading(false); return; }
    // Operator/radiologist: sin lista inicial del padrón; exigen un término mínimo de búsqueda.
    if (role !== "admin" && !hasMinimumPatientSearch(query)) { setPatients([]); setLoading(false); return; }
    // Búsqueda server-side con debounce; límite fijo con aviso en vez de paginación por páginas.
    const handle = setTimeout(() => {
      setLoading(true);
      fetchPatients({ search: query, limit: PAGE_SIZE })
        .then((next) => { setPatients(next); setError(""); })
        .catch(() => setError("No fue posible cargar los pacientes."))
        .finally(() => setLoading(false));
    }, query ? 300 : 0);
    return () => clearTimeout(handle);
  }, [role, query]);

  async function addPatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const identifier = String(form.get("identifier")).trim();
    const identifierType = String(form.get("identifierType")) as Patient["identifierType"];
    if (patients.some((patient) => patient.identifierType === identifierType && normalize(patient.identifier) === normalize(identifier))) return setError("Ya existe un paciente con ese identificador.");

    try {
      const patient = await createPatient({
        identifier,
        identifierType,
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

  if (role === null) return <p className="empty-state">Cargando pacientes…</p>;
  if (!STAFF_ROLES.includes(role)) return <p className="notice" role="alert">Acceso reservado al personal clínico autorizado.</p>;
  const isAdmin = role === "admin";
  const staffNeedsQuery = !isAdmin && !hasMinimumPatientSearch(query);

  return (
    <>
      <div className="page-header">
        {isAdmin
          ? <div><p className="eyebrow">Registro operativo</p><h2>Pacientes</h2><p>Información protegida en Supabase mediante acceso autenticado y RLS.</p></div>
          : <div><p className="eyebrow">Búsqueda clínica</p><h2>Pacientes</h2><p>Busca por nombre o identificador para abrir la ficha clínica del paciente.</p></div>}
        {isAdmin && <button className="button primary" type="button" onClick={() => setShowForm((visible) => !visible)}>{showForm ? "Cerrar" : "Nuevo paciente"}</button>}
      </div>

      {error && !showForm && <p className="notice" role="alert">{error}</p>}

      {isAdmin && showForm && (
        <form className="card clinical-form" onSubmit={addPatient}>
          <label>Tipo de identificador<select name="identifierType" defaultValue="run">{Object.entries(identifierTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Número de identificador<input name="identifier" placeholder="RUN, pasaporte u otro" required /></label>
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
          {!staffNeedsQuery && patients.map((patient) => <tr className="row-link" key={patient.id} tabIndex={0} onClick={() => router.push(`/pacientes/${patient.id}`)} onKeyDown={(event) => event.key === "Enter" && router.push(`/pacientes/${patient.id}`)}><td>{identifierTypeLabels[patient.identifierType]} · {patient.identifier}</td><td>{patient.name}</td><td>{patient.birthDate}</td><td>{sexLabels[patient.sex]}</td><td>{patient.phone || "—"}</td><td>{patient.consentAt ? <span className="status status-completed">Otorgado</span> : <span className="status status-cancelled">Pendiente</span>}</td></tr>)}
        </tbody></table>
        {staffNeedsQuery && <p className="empty-state">Ingresa al menos 3 caracteres para buscar un paciente.</p>}
        {!staffNeedsQuery && !loading && !patients.length && <p className="empty-state">No se encontraron pacientes.</p>}
        {!staffNeedsQuery && !loading && patients.length >= PAGE_SIZE && <p className="empty-state">Mostrando los primeros {PAGE_SIZE} resultados. Usa la búsqueda para acotar.</p>}
        {!staffNeedsQuery && loading && <p className="empty-state">Cargando pacientes…</p>}
      </section>
    </>
  );
}
