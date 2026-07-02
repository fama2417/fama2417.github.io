"use client";

import { FormEvent, useMemo, useState } from "react";
import { useStoredCollection } from "@/lib/storage";
import { patients as initialPatients, type Patient } from "@/features/patients/mock-data";
import { initialAppointments, type Appointment } from "./mock-data";
import { APPOINTMENT_STATUSES, appointmentStatusLabels, type AppointmentStatus } from "./status";
import { appointmentError } from "./validation";

const emptyDraft = (date: string): Appointment => ({
  id: "", patientId: "", patientName: "", practitionerName: "Dra. Imagenología", locationName: "Box 1",
  date, startTime: "09:00", endTime: "09:30", status: "scheduled", reason: "", modality: "US",
});

export function AgendaManager() {
  const [appointments, setAppointments] = useStoredCollection<Appointment>("agenda-appointments", initialAppointments);
  const [patients] = useStoredCollection<Patient>("agenda-patients", initialPatients);
  const [date, setDate] = useState(initialAppointments[0].date);
  const [practitioner, setPractitioner] = useState("all");
  const [location, setLocation] = useState("all");
  const [draft, setDraft] = useState<Appointment | null>(null);
  const [error, setError] = useState("");

  const visibleAppointments = useMemo(() => appointments
    .filter((item) => item.date === date && (practitioner === "all" || item.practitionerName === practitioner) && (location === "all" || item.locationName === location))
    .sort((a, b) => a.startTime.localeCompare(b.startTime)), [appointments, date, practitioner, location]);

  function saveAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const patient = patients.find((item) => item.id === draft.patientId);
    const candidate = { ...draft, id: draft.id || crypto.randomUUID(), patientName: patient?.name ?? "" };
    const message = appointmentError(candidate, appointments);
    if (message) return setError(message);
    setAppointments((current) => draft.id ? current.map((item) => item.id === draft.id ? candidate : item) : [...current, candidate]);
    setDraft(null);
    setError("");
  }

  function changeStatus(id: string, status: AppointmentStatus) {
    setAppointments((current) => current.map((item) => item.id === id ? { ...item, status } : item));
  }

  return (
    <>
      <div className="page-header">
        <div><p className="eyebrow">Agenda operativa</p><h2>Agenda diaria</h2><p>Crea, edita y sigue el estado de cada atención.</p></div>
        <button className="button primary" type="button" onClick={() => setDraft(draft ? null : emptyDraft(date))}>{draft ? "Cerrar" : "Nueva cita"}</button>
      </div>

      {draft && (
        <form className="card clinical-form" onSubmit={saveAppointment}>
          <label>Paciente<select required value={draft.patientId} onChange={(event) => setDraft({ ...draft, patientId: event.target.value })}>
            <option value="">Seleccionar…</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.identifier}</option>)}
          </select></label>
          <label>Fecha<input required type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
          <label>Inicio<input required type="time" value={draft.startTime} onChange={(event) => setDraft({ ...draft, startTime: event.target.value })} /></label>
          <label>Término<input required type="time" value={draft.endTime} onChange={(event) => setDraft({ ...draft, endTime: event.target.value })} /></label>
          <label>Profesional<select value={draft.practitionerName} onChange={(event) => setDraft({ ...draft, practitionerName: event.target.value })}><option>Dra. Imagenología</option><option>Dr. Radiología</option></select></label>
          <label>Equipo / box<select value={draft.locationName} onChange={(event) => setDraft({ ...draft, locationName: event.target.value })}><option>Box 1</option><option>Box 2</option><option>Sala RX</option><option>Scanner</option><option>Resonador</option></select></label>
          <label>Modalidad<select value={draft.modality} onChange={(event) => setDraft({ ...draft, modality: event.target.value as Appointment["modality"] })}><option>US</option><option>DX</option><option>CT</option><option>MR</option><option>MG</option></select></label>
          <label>Examen<input required value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} /></label>
          <button className="button primary" type="submit">Guardar cita</button>
          {error && <p className="form-error" role="alert">{error}</p>}
        </form>
      )}

      <section className="toolbar" aria-label="Filtros de agenda">
        <label>Fecha<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>Profesional<select value={practitioner} onChange={(event) => setPractitioner(event.target.value)}><option value="all">Todos</option><option>Dra. Imagenología</option><option>Dr. Radiología</option></select></label>
        <label>Ubicación<select value={location} onChange={(event) => setLocation(event.target.value)}><option value="all">Todas</option><option>Box 1</option><option>Box 2</option><option>Sala RX</option><option>Scanner</option><option>Resonador</option></select></label>
      </section>

      <section className="schedule-list">
        {visibleAppointments.map((appointment) => (
          <article className="appointment-card" key={appointment.id}>
            <div className="time-block"><strong>{appointment.startTime}</strong><span>{appointment.endTime}</span></div>
            <div><h3>{appointment.patientName}</h3><p>{appointment.modality} · {appointment.reason}</p><span>{appointment.practitionerName} · {appointment.locationName}</span></div>
            <div className="appointment-actions">
              <select className={`status status-${appointment.status}`} aria-label={`Estado de ${appointment.patientName}`} value={appointment.status} onChange={(event) => changeStatus(appointment.id, event.target.value as AppointmentStatus)}>
                {APPOINTMENT_STATUSES.map((status) => <option key={status} value={status}>{appointmentStatusLabels[status]}</option>)}
              </select>
              <button className="text-button" type="button" onClick={() => { setDraft(appointment); setError(""); }}>Editar</button>
            </div>
          </article>
        ))}
        {!visibleAppointments.length && <p className="empty-state card">No hay citas para estos filtros.</p>}
      </section>
    </>
  );
}
