"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { emptyPatientRecord, type Patient } from "@/features/patients/mock-data";
import { createPatient, fetchPatients } from "@/features/patients/repository";
import { activeOptions, fetchCatalog, type CatalogItem } from "@/features/catalog/repository";
import { compressOrderFile } from "@/lib/compress-image";
import { fetchHolidays, fetchSchedules, scheduleError, type Holiday, type RoomSchedule } from "@/features/schedule/repository";
import { emptyClinicalDetail, type Appointment } from "./mock-data";
import { fetchAppointments, saveAppointment, setAppointmentStatus, uploadOrderFile } from "./repository";
import { APPOINTMENT_STATUSES, appointmentStatusLabels, type AppointmentStatus } from "./status";
import { appointmentError } from "./validation";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const emptyDraft = (date: string): Appointment => ({ id: "", patientId: "", patientName: "", practitionerName: "", locationName: "", date, startTime: "09:00", endTime: "09:30", status: "scheduled", reason: "", modality: "US", ...emptyClinicalDetail });
const modalities = ["US", "DX", "CT", "MR", "MG"] as const;
const emptyNewPatient = { identifier: "", name: "", birthDate: "", sex: "unknown" as Patient["sex"], prevision: "", phone: "", consent: false };

const steps = ["Paciente", "Reserva", "Detalles y adjuntos"] as const;

export function AgendaManager() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [date, setDate] = useState(today);
  const [practitioner, setPractitioner] = useState("all");
  const [location, setLocation] = useState("all");
  const [draft, setDraft] = useState<Appointment | null>(null);
  const [step, setStep] = useState(0);
  const [newPatient, setNewPatient] = useState<typeof emptyNewPatient | null>(null);
  const [pendingOrder, setPendingOrder] = useState<File | null>(null);
  const [schedules, setSchedules] = useState<RoomSchedule[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([fetchAppointments(), fetchPatients(), fetchCatalog()]).then(([nextAppointments, nextPatients, nextCatalog]) => {
      setAppointments(nextAppointments);
      setPatients(nextPatients);
      setCatalog(nextCatalog);
    }).catch(() => setError("No fue posible cargar la agenda.")).finally(() => setLoading(false));
    fetchSchedules().then(setSchedules).catch(() => undefined);
    fetchHolidays().then(setHolidays).catch(() => undefined);
  }, []);

  const options = useMemo(() => ({
    sucursal: activeOptions(catalog, "sucursal"),
    servicio: activeOptions(catalog, "servicio"),
    especialidad: activeOptions(catalog, "especialidad"),
    profesional: activeOptions(catalog, "profesional"),
    sala: activeOptions(catalog, "sala"),
    prestacion: activeOptions(catalog, "prestacion"),
    etiqueta: activeOptions(catalog, "etiqueta"),
    prevision: activeOptions(catalog, "prevision"),
  }), [catalog]);

  const visibleAppointments = useMemo(() => appointments
    .filter((item) => item.date === date && (practitioner === "all" || item.practitionerName === practitioner) && (location === "all" || item.locationName === location))
    .sort((a, b) => a.startTime.localeCompare(b.startTime)), [appointments, date, practitioner, location]);

  const selectedPatient = patients.find((item) => item.id === draft?.patientId);
  const set = <Key extends keyof Appointment>(field: Key, value: Appointment[Key]) => setDraft((current) => current && { ...current, [field]: value });

  function openDraft(base: Appointment) {
    setDraft(base);
    setStep(0);
    setPendingOrder(null);
    setNewPatient(null);
    setError("");
    setNotice("");
  }

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

  async function saveNewPatient() {
    if (!newPatient) return;
    if (!newPatient.identifier || !newPatient.name || !newPatient.birthDate) return setError("Completa identificador, nombre y fecha de nacimiento.");
    if (!newPatient.consent) return setError("Registra el consentimiento del paciente para continuar.");
    try {
      const patient = await createPatient({ ...emptyPatientRecord, identifier: newPatient.identifier.trim(), name: newPatient.name.trim(), birthDate: newPatient.birthDate, sex: newPatient.sex, phone: newPatient.phone.trim(), prevision: newPatient.prevision, consentAt: new Date().toISOString() });
      setPatients((current) => [...current, patient].sort((a, b) => a.name.localeCompare(b.name)));
      setDraft((current) => current && { ...current, patientId: patient.id });
      setNewPatient(null);
      setError("");
      setNotice(`Paciente ${patient.name} creado (ID ${patient.identifier}).`);
    } catch {
      setError("No fue posible crear el paciente. Revisa que el identificador no exista.");
    }
  }

  async function selectOrder(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      const compressed = await compressOrderFile(file);
      setPendingOrder(compressed);
      setNotice(`Orden lista para adjuntar (${Math.round(compressed.size / 1024)} KB).`);
    } catch (cause) {
      setPendingOrder(null);
      setError(cause instanceof Error ? cause.message : "No fue posible procesar el archivo.");
    }
  }

  async function submitAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    if (!draft.patientId) { setStep(0); return setError("Selecciona o crea el paciente."); }
    if (!draft.practitionerName || !draft.reason || !draft.locationName) { setStep(1); return setError("Completa profesional, prestación y sala."); }
    const patient = patients.find((item) => item.id === draft.patientId);
    const exists = Boolean(draft.id);
    const candidate = { ...draft, id: draft.id || crypto.randomUUID(), patientName: patient?.name ?? "" };
    const message = appointmentError(candidate, appointments) || scheduleError(candidate, schedules, holidays);
    if (message) { setStep(1); return setError(message); }
    setSaving(true);
    try {
      await saveAppointment(candidate, exists);
      if (pendingOrder) candidate.orderFile = await uploadOrderFile(candidate.id, pendingOrder);
      setAppointments((current) => exists ? current.map((item) => item.id === candidate.id ? candidate : item) : [...current, candidate]);
      setDraft(null);
      setPendingOrder(null);
      setError("");
    } catch {
      setError("No fue posible guardar la cita.");
    } finally {
      setSaving(false);
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

  return (
    <>
      <div className="page-header"><div><p className="eyebrow">Agenda operativa</p><h2>Reserva de exámenes</h2><p>Los listados de opciones se administran en Configuración → Parámetros de la agenda.</p></div><button className="button primary" type="button" onClick={() => draft ? setDraft(null) : openDraft(emptyDraft(date))}>{draft ? "Cerrar" : "Nueva reserva"}</button></div>
      {error && !draft && <p className="notice" role="alert">{error}</p>}

      {draft && (
        <form className="booking-form" onSubmit={submitAppointment}>
          <nav className="stepper" aria-label="Pasos de la reserva">
            {steps.map((label, index) => (
              <button key={label} type="button" className={`step-chip ${index === step ? "current" : ""} ${index < step ? "done" : ""}`} onClick={() => setStep(index)}>
                <span>{index + 1}</span>{label}
              </button>
            ))}
          </nav>

          {step === 0 && (
            <fieldset className="booking-section">
              <legend>Paciente</legend>
              <div className="booking-grid">
                <label className="span-2">Buscar paciente *<select value={draft.patientId} onChange={(event) => set("patientId", event.target.value)}><option value="">Seleccionar…</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.identifier}</option>)}</select></label>
                <div className="booking-grid-action"><button className="button secondary" type="button" onClick={() => setNewPatient(newPatient ? null : { ...emptyNewPatient })}>{newPatient ? "Cancelar creación" : "+ Nuevo paciente"}</button></div>
              </div>
              {selectedPatient && !newPatient && (
                <div className="patient-chip">
                  <span><strong>ID Paciente (DICOM):</strong> {selectedPatient.identifier}</span>
                  <span><strong>Nacimiento:</strong> {selectedPatient.birthDate}</span>
                  <span><strong>Previsión:</strong> {selectedPatient.prevision || "No registrada"}</span>
                  <span><strong>Consentimiento:</strong> {selectedPatient.consentAt ? "Otorgado" : "Pendiente"}</span>
                </div>
              )}
              {newPatient && (
                <div className="booking-grid inner-form">
                  <label>ID Paciente / RUN *<input value={newPatient.identifier} onChange={(event) => setNewPatient({ ...newPatient, identifier: event.target.value })} placeholder="Se usará como Patient ID DICOM" /></label>
                  <label>Nombre completo *<input value={newPatient.name} onChange={(event) => setNewPatient({ ...newPatient, name: event.target.value })} /></label>
                  <label>Fecha de nacimiento *<input type="date" value={newPatient.birthDate} onChange={(event) => setNewPatient({ ...newPatient, birthDate: event.target.value })} /></label>
                  <label>Sexo registral<select value={newPatient.sex} onChange={(event) => setNewPatient({ ...newPatient, sex: event.target.value as Patient["sex"] })}><option value="unknown">No informado</option><option value="female">Femenino</option><option value="male">Masculino</option><option value="other">Otro</option></select></label>
                  <label>Previsión<select value={newPatient.prevision} onChange={(event) => setNewPatient({ ...newPatient, prevision: event.target.value })}><option value="">—</option>{options.prevision.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</select></label>
                  <label>Teléfono<input type="tel" value={newPatient.phone} onChange={(event) => setNewPatient({ ...newPatient, phone: event.target.value })} /></label>
                  <label className="consent-field"><input type="checkbox" checked={newPatient.consent} onChange={(event) => setNewPatient({ ...newPatient, consent: event.target.checked })} />El paciente otorgó consentimiento para el tratamiento de sus datos (Ley 19.628/21.668).</label>
                  <div className="booking-grid-action"><button className="button primary" type="button" onClick={saveNewPatient}>Guardar paciente</button></div>
                </div>
              )}
            </fieldset>
          )}

          {step === 1 && (
            <fieldset className="booking-section">
              <legend>Reserva</legend>
              <div className="booking-grid">
                <label>Sucursal<select value={draft.branch} onChange={(event) => set("branch", event.target.value)}><option value="">—</option>{options.sucursal.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</select></label>
                <label>Servicio<select value={draft.service} onChange={(event) => set("service", event.target.value)}><option value="">—</option>{options.servicio.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</select></label>
                <label>Especialidad<select value={draft.specialty} onChange={(event) => set("specialty", event.target.value)}><option value="">—</option>{options.especialidad.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</select></label>
                <label>Profesional *<select value={draft.practitionerName} onChange={(event) => set("practitionerName", event.target.value)}><option value="">Seleccionar…</option>{options.profesional.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</select></label>
                <label>Modalidad *<select value={draft.modality} onChange={(event) => set("modality", event.target.value as Appointment["modality"])}>{modalities.map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
                <label className="span-2">Prestación *<select value={draft.reason} onChange={(event) => pickProcedure(event.target.value)}><option value="">Seleccionar…</option>{options.prestacion.map((item) => <option key={item.id} value={item.label}>{item.code ? `${item.code} · ` : ""}{item.label}</option>)}</select></label>
                <label>Sala / equipo *<select value={draft.locationName} onChange={(event) => set("locationName", event.target.value)}><option value="">Seleccionar…</option>{options.sala.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</select></label>
                <label>Fecha *<input required type="date" value={draft.date} onChange={(event) => set("date", event.target.value)} /></label>
                <label>Inicio *<input required type="time" value={draft.startTime} onChange={(event) => set("startTime", event.target.value)} /></label>
                <label>Término *<input required type="time" value={draft.endTime} onChange={(event) => set("endTime", event.target.value)} /></label>
              </div>
            </fieldset>
          )}

          {step === 2 && (
            <fieldset className="booking-section">
              <legend>Detalles y adjuntos</legend>
              <div className="booking-grid">
                <label>Médico tratante<input value={draft.treatingPhysician} onChange={(event) => set("treatingPhysician", event.target.value)} placeholder="Quien solicita el examen" /></label>
                <label>Fecha de la orden<input type="date" value={draft.orderDate} onChange={(event) => set("orderDate", event.target.value)} /></label>
                <label>Anestesia<select value={draft.anesthesia ? "si" : "no"} onChange={(event) => set("anesthesia", event.target.value === "si")}><option value="no">No</option><option value="si">Sí</option></select></label>
                <label>Contraste<select value={draft.contrast ? "si" : "no"} onChange={(event) => set("contrast", event.target.value === "si")}><option value="no">No</option><option value="si">Sí</option></select></label>
                <label>Prioridad<select value={draft.priority} onChange={(event) => set("priority", event.target.value as Appointment["priority"])}><option value="normal">Normal</option><option value="urgente">Urgente</option></select></label>
                <label>Orden de pago<input value={draft.paymentOrder} onChange={(event) => set("paymentOrder", event.target.value)} placeholder="N.º de orden o bono" /></label>
                <label>Estado<select value={draft.status} onChange={(event) => set("status", event.target.value as AppointmentStatus)}>{APPOINTMENT_STATUSES.map((status) => <option key={status} value={status}>{appointmentStatusLabels[status]}</option>)}</select></label>
                <label>Orden médica escaneada{draft.orderFile && !pendingOrder && <span className="form-notice">Adjunta: {draft.orderFile.split("/").pop()}</span>}<input type="file" accept="image/*,.pdf" onChange={(event) => selectOrder(event.target.files?.[0])} /><span className="empty-inline">Las imágenes se comprimen automáticamente a máx. 1 MB.</span></label>
                <div className="booking-tags"><span>Etiquetas de cita</span><div>{options.etiqueta.map((item) => <button key={item.id} type="button" className={`tag ${draft.tags.split(",").includes(item.label) ? "active" : ""}`} onClick={() => toggleTag(item.label)}>{item.label}</button>)}{!options.etiqueta.length && <span className="empty-inline">Sin etiquetas configuradas.</span>}</div></div>
                <label className="span-2">Anamnesis<textarea value={draft.anamnesis} onChange={(event) => set("anamnesis", event.target.value)} placeholder="Antecedentes clínicos relevantes para el examen" /></label>
                <label className="span-2">Hipótesis diagnóstica<textarea value={draft.diagnosticHypothesis} onChange={(event) => set("diagnosticHypothesis", event.target.value)} /></label>
                <label className="span-2">Comentario<textarea value={draft.comment} onChange={(event) => set("comment", event.target.value)} /></label>
              </div>
              {draft.id && (
                <div className="booking-grid inner-form">
                  <p className="eyebrow" style={{ gridColumn: "1 / -1" }}>Retiro de examen</p>
                  <label>Nombre<input value={draft.pickupName} onChange={(event) => set("pickupName", event.target.value)} placeholder="Quien retira los resultados" /></label>
                  <label>RUN<input value={draft.pickupRun} onChange={(event) => set("pickupRun", event.target.value)} /></label>
                  <label>Teléfono<input type="tel" value={draft.pickupPhone} onChange={(event) => set("pickupPhone", event.target.value)} /></label>
                </div>
              )}
            </fieldset>
          )}

          <footer className="booking-actions">
            {step > 0 && <button className="button secondary" type="button" onClick={() => setStep(step - 1)}>← Anterior</button>}
            {step < steps.length - 1 && <button className="button secondary" type="button" onClick={() => setStep(step + 1)}>Siguiente →</button>}
            <button className="button primary" type="submit" disabled={saving}>{draft.id ? "Actualizar reserva" : "Crear reserva"}</button>
            {error && <p className="form-error" role="alert">{error}</p>}
            {notice && !error && <p className="form-notice" role="status">{notice}</p>}
          </footer>
        </form>
      )}

      <section className="toolbar" aria-label="Filtros de agenda">
        <label>Fecha<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>Profesional<select value={practitioner} onChange={(event) => setPractitioner(event.target.value)}><option value="all">Todos</option>{options.profesional.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</select></label>
        <label>Sala / equipo<select value={location} onChange={(event) => setLocation(event.target.value)}><option value="all">Todas</option>{options.sala.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</select></label>
      </section>

      <section className="schedule-list">
        {visibleAppointments.map((appointment) => <article className="appointment-card" key={appointment.id}><div className="time-block"><strong>{appointment.startTime}</strong><span>{appointment.endTime}</span></div><div><h3>{appointment.patientName}{appointment.priority === "urgente" && <span className="status status-cancelled" style={{ marginLeft: 8 }}>Urgente</span>}</h3><p>{appointment.modality} · {appointment.reason}</p><span>{appointment.patientIdentifier && `ID ${appointment.patientIdentifier} · `}{appointment.practitionerName} · {appointment.locationName}{appointment.tags && ` · ${appointment.tags.split(",").join(", ")}`}</span></div><div className="appointment-actions"><select className={`status status-${appointment.status}`} aria-label={`Estado de ${appointment.patientName}`} value={appointment.status} onChange={(event) => changeStatus(appointment.id, event.target.value as AppointmentStatus)}>{APPOINTMENT_STATUSES.map((status) => <option key={status} value={status}>{appointmentStatusLabels[status]}</option>)}</select><button className="text-button" type="button" onClick={() => openDraft(appointment)}>Editar</button></div></article>)}
        {!loading && !visibleAppointments.length && <p className="empty-state card">No hay citas para estos filtros.</p>}
        {loading && <p className="empty-state card">Cargando agenda…</p>}
      </section>
    </>
  );
}
