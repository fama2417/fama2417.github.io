"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Patient } from "@/features/patients/mock-data";
import { fetchPatients } from "@/features/patients/repository";
import { activeOptions, fetchCatalog, type CatalogItem } from "@/features/catalog/repository";
import { emptyClinicalDetail, type Appointment } from "./mock-data";
import { fetchAppointments, saveAppointment, setAppointmentStatus, uploadOrderFile } from "./repository";
import { APPOINTMENT_STATUSES, appointmentStatusLabels, type AppointmentStatus } from "./status";
import { appointmentError } from "./validation";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const emptyDraft = (date: string): Appointment => ({ id: "", patientId: "", patientName: "", practitionerName: "", locationName: "", date, startTime: "09:00", endTime: "09:30", status: "scheduled", reason: "", modality: "US", ...emptyClinicalDetail });
const modalities = ["US", "DX", "CT", "MR", "MG"] as const;

export function AgendaManager() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [date, setDate] = useState(today);
  const [practitioner, setPractitioner] = useState("all");
  const [location, setLocation] = useState("all");
  const [draft, setDraft] = useState<Appointment | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchAppointments(), fetchPatients(), fetchCatalog()]).then(([nextAppointments, nextPatients, nextCatalog]) => {
      setAppointments(nextAppointments);
      setPatients(nextPatients);
      setCatalog(nextCatalog);
    }).catch(() => setError("No fue posible cargar la agenda.")).finally(() => setLoading(false));
  }, []);

  const options = useMemo(() => ({
    sucursal: activeOptions(catalog, "sucursal"),
    servicio: activeOptions(catalog, "servicio"),
    especialidad: activeOptions(catalog, "especialidad"),
    profesional: activeOptions(catalog, "profesional"),
    sala: activeOptions(catalog, "sala"),
    prestacion: activeOptions(catalog, "prestacion"),
    etiqueta: activeOptions(catalog, "etiqueta"),
  }), [catalog]);

  const visibleAppointments = useMemo(() => appointments
    .filter((item) => item.date === date && (practitioner === "all" || item.practitionerName === practitioner) && (location === "all" || item.locationName === location))
    .sort((a, b) => a.startTime.localeCompare(b.startTime)), [appointments, date, practitioner, location]);

  const set = <Key extends keyof Appointment>(field: Key, value: Appointment[Key]) => setDraft((current) => current && { ...current, [field]: value });

  function pickProcedure(label: string) {
    const item = options.prestacion.find((entry) => entry.label === label);
    setDraft((current) => current && { ...current, reason: label, procedureCode: item?.code ?? "" });
  }

  function toggleTag(tag: string) {
    setDraft((current) => {
      if (!current) return current;
      const tags = current.tags ? current.tags.split(",") : [];
      const next = tags.includes(tag) ? tags.filter((entry) => entry !== tag) : [...tags, tag];
      return { ...current, tags: next.join(",") };
    });
  }

  async function submitAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const patient = patients.find((item) => item.id === draft.patientId);
    const exists = Boolean(draft.id);
    const candidate = { ...draft, id: draft.id || crypto.randomUUID(), patientName: patient?.name ?? "" };
    const message = appointmentError(candidate, appointments);
    if (message) return setError(message);
    try {
      await saveAppointment(candidate, exists);
      setAppointments((current) => exists ? current.map((item) => item.id === candidate.id ? candidate : item) : [...current, candidate]);
      setDraft(null);
      setError("");
    } catch {
      setError("No fue posible guardar la cita. Si agregaste campos nuevos, aplica la última migración.");
    }
  }

  async function changeStatus(id: string, status: AppointmentStatus) {
    const reason = ["cancelled", "no_show"].includes(status) ? window.prompt("Motivo del cambio de estado:") ?? "" : "";
    try {
      await setAppointmentStatus(id, status, reason);
      setAppointments((current) => current.map((item) => item.id === id ? { ...item, status, statusReason: reason } : item));
    } catch {
      setError("No fue posible actualizar el estado.");
    }
  }

  async function attachOrder(file: File | undefined) {
    if (!file || !draft?.id) return;
    try {
      const path = await uploadOrderFile(draft.id, file);
      setDraft((current) => current && { ...current, orderFile: path });
      setAppointments((current) => current.map((item) => item.id === draft.id ? { ...item, orderFile: path } : item));
    } catch {
      setError("No fue posible adjuntar la orden.");
    }
  }

  return (
    <>
      <div className="page-header"><div><p className="eyebrow">Agenda operativa</p><h2>Reserva de exámenes</h2><p>Los listados de opciones se administran en Configuración → Parámetros de la agenda.</p></div><button className="button primary" type="button" onClick={() => setDraft(draft ? null : emptyDraft(date))}>{draft ? "Cerrar" : "Nueva reserva"}</button></div>
      {error && !draft && <p className="notice" role="alert">{error}</p>}

      {draft && (
        <form className="booking-form" onSubmit={submitAppointment}>
          <fieldset className="booking-section">
            <legend>Reserva</legend>
            <div className="booking-grid">
              <label>Paciente *<select required value={draft.patientId} onChange={(event) => set("patientId", event.target.value)}><option value="">Seleccionar…</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.identifier}</option>)}</select></label>
              <label>Sucursal<select value={draft.branch} onChange={(event) => set("branch", event.target.value)}><option value="">—</option>{options.sucursal.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</select></label>
              <label>Servicio<select value={draft.service} onChange={(event) => set("service", event.target.value)}><option value="">—</option>{options.servicio.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</select></label>
              <label>Especialidad<select value={draft.specialty} onChange={(event) => set("specialty", event.target.value)}><option value="">—</option>{options.especialidad.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</select></label>
              <label>Profesional *<select required value={draft.practitionerName} onChange={(event) => set("practitionerName", event.target.value)}><option value="">Seleccionar…</option>{options.profesional.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</select></label>
              <label>Modalidad *<select value={draft.modality} onChange={(event) => set("modality", event.target.value as Appointment["modality"])}>{modalities.map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
              <label className="span-2">Prestación *<select required value={draft.reason} onChange={(event) => pickProcedure(event.target.value)}><option value="">Seleccionar…</option>{options.prestacion.map((item) => <option key={item.id} value={item.label}>{item.code ? `${item.code} · ` : ""}{item.label}</option>)}</select></label>
              <label>Sala / equipo *<select required value={draft.locationName} onChange={(event) => set("locationName", event.target.value)}><option value="">Seleccionar…</option>{options.sala.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</select></label>
              <label>Fecha *<input required type="date" value={draft.date} onChange={(event) => set("date", event.target.value)} /></label>
              <label>Inicio *<input required type="time" value={draft.startTime} onChange={(event) => set("startTime", event.target.value)} /></label>
              <label>Término *<input required type="time" value={draft.endTime} onChange={(event) => set("endTime", event.target.value)} /></label>
            </div>
          </fieldset>

          <fieldset className="booking-section">
            <legend>Detalles de cita</legend>
            <div className="booking-grid">
              <label>Médico tratante<input value={draft.treatingPhysician} onChange={(event) => set("treatingPhysician", event.target.value)} placeholder="Quien solicita el examen" /></label>
              <label>Fecha de la orden<input type="date" value={draft.orderDate} onChange={(event) => set("orderDate", event.target.value)} /></label>
              <label>Anestesia<select value={draft.anesthesia ? "si" : "no"} onChange={(event) => set("anesthesia", event.target.value === "si")}><option value="no">No</option><option value="si">Sí</option></select></label>
              <label>Contraste<select value={draft.contrast ? "si" : "no"} onChange={(event) => set("contrast", event.target.value === "si")}><option value="no">No</option><option value="si">Sí</option></select></label>
              <label>Prioridad<select value={draft.priority} onChange={(event) => set("priority", event.target.value as Appointment["priority"])}><option value="normal">Normal</option><option value="urgente">Urgente</option></select></label>
              <label>Orden de pago<input value={draft.paymentOrder} onChange={(event) => set("paymentOrder", event.target.value)} placeholder="N.º de orden o bono" /></label>
              <label>Estado<select value={draft.status} onChange={(event) => set("status", event.target.value as AppointmentStatus)}>{APPOINTMENT_STATUSES.map((status) => <option key={status} value={status}>{appointmentStatusLabels[status]}</option>)}</select></label>
              <div className="booking-tags"><span>Etiquetas de cita</span><div>{options.etiqueta.map((item) => <button key={item.id} type="button" className={`tag ${draft.tags.split(",").includes(item.label) ? "active" : ""}`} onClick={() => toggleTag(item.label)}>{item.label}</button>)}{!options.etiqueta.length && <span className="empty-inline">Sin etiquetas configuradas.</span>}</div></div>
              <label className="span-2">Hipótesis diagnóstica<textarea value={draft.diagnosticHypothesis} onChange={(event) => set("diagnosticHypothesis", event.target.value)} /></label>
              <label className="span-2">Comentario<textarea value={draft.comment} onChange={(event) => set("comment", event.target.value)} /></label>
            </div>
          </fieldset>

          <fieldset className="booking-section">
            <legend>Procedencia</legend>
            <div className="booking-grid">
              <label>Tipo<select value={draft.originType} onChange={(event) => set("originType", event.target.value as Appointment["originType"])}><option value="interna">Interna</option><option value="externa">Externa</option></select></label>
              <label className="span-2">Descripción<input value={draft.originDesc} onChange={(event) => set("originDesc", event.target.value)} placeholder="Servicio o institución de origen" /></label>
            </div>
          </fieldset>

          <fieldset className="booking-section">
            <legend>Solicitante del examen</legend>
            <div className="booking-grid">
              <label>Tipo<select value={draft.requesterType} onChange={(event) => set("requesterType", event.target.value as Appointment["requesterType"])}><option value="interno">Interno</option><option value="externo">Externo</option></select></label>
              <label>Nombre<input value={draft.requesterName} onChange={(event) => set("requesterName", event.target.value)} /></label>
              <label>RUN<input value={draft.requesterRun} onChange={(event) => set("requesterRun", event.target.value)} /></label>
              <label>Correo electrónico<input type="email" value={draft.requesterEmail} onChange={(event) => set("requesterEmail", event.target.value)} /></label>
            </div>
          </fieldset>

          <fieldset className="booking-section">
            <legend>Retiro de examen</legend>
            <div className="booking-grid">
              <label>Nombre<input value={draft.pickupName} onChange={(event) => set("pickupName", event.target.value)} placeholder="Quien retira los resultados" /></label>
              <label>RUN<input value={draft.pickupRun} onChange={(event) => set("pickupRun", event.target.value)} /></label>
              <label>Teléfono<input type="tel" value={draft.pickupPhone} onChange={(event) => set("pickupPhone", event.target.value)} /></label>
              {draft.id
                ? <label>Orden médica escaneada{draft.orderFile && <span className="form-notice">Adjunta: {draft.orderFile.split("/").pop()}</span>}<input type="file" accept="image/*,.pdf" onChange={(event) => attachOrder(event.target.files?.[0])} /></label>
                : <label>Orden médica escaneada<span className="empty-inline">Guarda la reserva y vuelve a editarla para adjuntar.</span></label>}
            </div>
          </fieldset>

          <footer className="booking-actions">
            <button className="button primary" type="submit">{draft.id ? "Actualizar reserva" : "Crear reserva"}</button>
            {error && <p className="form-error" role="alert">{error}</p>}
          </footer>
        </form>
      )}

      <section className="toolbar" aria-label="Filtros de agenda">
        <label>Fecha<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>Profesional<select value={practitioner} onChange={(event) => setPractitioner(event.target.value)}><option value="all">Todos</option>{options.profesional.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</select></label>
        <label>Sala / equipo<select value={location} onChange={(event) => setLocation(event.target.value)}><option value="all">Todas</option>{options.sala.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</select></label>
      </section>

      <section className="schedule-list">
        {visibleAppointments.map((appointment) => <article className="appointment-card" key={appointment.id}><div className="time-block"><strong>{appointment.startTime}</strong><span>{appointment.endTime}</span></div><div><h3>{appointment.patientName}{appointment.priority === "urgente" && <span className="status status-cancelled" style={{ marginLeft: 8 }}>Urgente</span>}</h3><p>{appointment.modality} · {appointment.reason}</p><span>{appointment.practitionerName} · {appointment.locationName}{appointment.tags && ` · ${appointment.tags.split(",").join(", ")}`}</span></div><div className="appointment-actions"><select className={`status status-${appointment.status}`} aria-label={`Estado de ${appointment.patientName}`} value={appointment.status} onChange={(event) => changeStatus(appointment.id, event.target.value as AppointmentStatus)}>{APPOINTMENT_STATUSES.map((status) => <option key={status} value={status}>{appointmentStatusLabels[status]}</option>)}</select><button className="text-button" type="button" onClick={() => { setDraft(appointment); setError(""); }}>Editar</button></div></article>)}
        {!loading && !visibleAppointments.length && <p className="empty-state card">No hay citas para estos filtros.</p>}
        {loading && <p className="empty-state card">Cargando agenda…</p>}
      </section>
    </>
  );
}
