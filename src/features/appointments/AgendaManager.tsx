"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { emptyPatientRecord, identifierTypeLabels, type Patient } from "@/features/patients/mock-data";
import { createPatient, fetchPatients } from "@/features/patients/repository";
import { activeOptions, fetchCatalog, type CatalogItem } from "@/features/catalog/repository";
import { compressOrderFile } from "@/lib/compress-image";
import { availableSlots, fetchHolidays, fetchSchedules, scheduleError, type Holiday, type RoomSchedule } from "@/features/schedule/repository";
import {
  fetchBranches, fetchBranchServices, fetchCompatibleResources, searchAvailableServiceTypes,
  type Location as BranchLocation, type ResourceChoice, type ServiceType,
} from "@/features/scheduling/repository";
import { emptyClinicalDetail, type Appointment } from "./mock-data";
import { fetchAppointments, saveAppointment, setAppointmentStatus, uploadOrderFile } from "./repository";
import { APPOINTMENT_STATUSES, appointmentStatusLabels, type AppointmentStatus } from "./status";
import { appointmentError } from "./validation";
import { CODE_SYSTEMS, codingError } from "@/features/clinical/coding";
import { CodePicker } from "@/features/clinical/CodePicker";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const emptyDraft = (date: string): Appointment => ({ id: "", patientId: "", patientName: "", practitionerName: "", locationName: "", date, startTime: "", endTime: "", status: "scheduled", reason: "", modality: "OT", ...emptyClinicalDetail });
const emptyNewPatient = { identifier: "", identifierType: "run" as Patient["identifierType"], name: "", birthDate: "", sex: "unknown" as Patient["sex"], prevision: "", phone: "", consent: false };
const normalizePatient = (value: string) => value.toLocaleLowerCase("es-CL").replace(/[^a-z0-9áéíóúñ]/g, "");

const steps = ["Paciente", "Examen y horario", "Detalles"] as const;
const displayDate = (value: string) => new Intl.DateTimeFormat("es-CL", { dateStyle: "full", timeZone: "America/Santiago" }).format(new Date(`${value}T12:00:00-04:00`));

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
  const [patientQuery, setPatientQuery] = useState("");
  const [pendingOrder, setPendingOrder] = useState<File | null>(null);
  const [manualTime, setManualTime] = useState(false);
  const [schedules, setSchedules] = useState<RoomSchedule[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [branches, setBranches] = useState<BranchLocation[]>([]);
  const [branchServices, setBranchServices] = useState<{ id: string; name: string }[]>([]);
  const [branchId, setBranchId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [procedureQuery, setProcedureQuery] = useState("");
  const [procedureMatches, setProcedureMatches] = useState<ServiceType[]>([]);
  const [selectedServiceType, setSelectedServiceType] = useState<ServiceType | null>(null);
  const [resourceChoices, setResourceChoices] = useState<ResourceChoice[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<{ id: string; status: AppointmentStatus; reason: string } | null>(null);

  useEffect(() => {
    Promise.all([fetchAppointments(), fetchPatients(), fetchCatalog()]).then(([nextAppointments, nextPatients, nextCatalog]) => {
      setAppointments(nextAppointments);
      setPatients(nextPatients);
      setCatalog(nextCatalog);
    }).catch(() => setError("No fue posible cargar la agenda.")).finally(() => setLoading(false));
    fetchSchedules().then(setSchedules).catch(() => undefined);
    fetchHolidays().then(setHolidays).catch(() => undefined);
    fetchBranches().then(setBranches).catch(() => setError("No fue posible cargar las sucursales."));
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
  const waiting = visibleAppointments.filter((item) => item.status === "arrived" || item.status === "in_progress").length;
  const completed = visibleAppointments.filter((item) => item.status === "completed").length;

  const selectedPatient = patients.find((item) => item.id === draft?.patientId);
  const patientMatches = useMemo(() => {
    const needle = normalizePatient(patientQuery);
    if (needle.length < 2 || selectedPatient) return [];
    return patients.filter((patient) => normalizePatient(`${patient.name} ${patient.identifier}`).includes(needle)).slice(0, 8);
  }, [patientQuery, patients, selectedPatient]);
  const set = <Key extends keyof Appointment>(field: Key, value: Appointment[Key]) => setDraft((current) => current && { ...current, [field]: value });

  const procedureDuration = selectedServiceType?.durationMin ?? options.prestacion.find((item) => item.label === draft?.reason)?.durationMin ?? 30;
  const dayHoliday = holidays.find((item) => item.date === draft?.date);
  const slots = useMemo(() => {
    if (!draft || dayHoliday) return [];
    const nowMin = draft.date === today() ? new Date().getHours() * 60 + new Date().getMinutes() : undefined;
    return availableSlots(draft.date, draft.locationName, procedureDuration, schedules, appointments, { excludeId: draft.id, nowMin, practitionerName: draft.practitionerName || undefined });
  }, [draft?.date, draft?.locationName, draft?.practitionerName, procedureDuration, schedules, appointments, dayHoliday, draft?.id]);

  function openDraft(base: Appointment) {
    setDraft(base);
    setStep(0);
    setManualTime(false);
    setPendingOrder(null);
    setNewPatient(null);
    setPatientQuery(base.patientId ? `${base.patientName} · ${base.patientIdentifier ?? ""}` : "");
    setBranchId(branches.find((branch) => branch.name === base.branch)?.id ?? "");
    setServiceId("");
    setProcedureQuery(base.reason);
    setSelectedServiceType(null);
    setResourceChoices(base.locationName ? [{ id: "current", name: base.locationName, kind: "location" }] : []);
    setError("");
    setNotice("");
  }

  useEffect(() => {
    if (!branchId) { setBranchServices([]); setServiceId(""); return; }
    fetchBranchServices(branchId).then((items) => {
      setBranchServices(items);
      setServiceId(items.find((item) => item.name === draft?.service)?.id ?? "");
    }).catch(() => setBranchServices([]));
  }, [branchId, draft?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!branchId || !serviceId || selectedServiceType || procedureQuery.trim().length === 1) { setProcedureMatches([]); return; }
    searchAvailableServiceTypes(branchId, serviceId, procedureQuery).then(setProcedureMatches).catch((cause) => { setProcedureMatches([]); setError(cause instanceof Error ? cause.message : "No fue posible buscar prestaciones."); });
  }, [branchId, serviceId, procedureQuery, selectedServiceType]);

  async function chooseServiceType(type: ServiceType) {
    setSelectedServiceType(type);
    setProcedureQuery(type.name);
    setProcedureMatches([]);
    setDraft((current) => current && { ...current, serviceTypeId: type.id, reason: type.name, procedureCode: type.code, serviceCategory: type.category, practitionerRequirement: type.practitionerRequirement, modality: (type.modality || "OT") as Appointment["modality"], standardCodeSystem: type.standardCodeSystem, standardCode: type.standardCode, standardDisplay: type.standardDisplay, practitionerName: type.practitionerRequirement === "none" ? "" : current.practitionerName, startTime: "", endTime: "", locationName: "" });
    try {
      const choices = await fetchCompatibleResources(branchId, type.id);
      setResourceChoices(choices);
      if (choices.length === 1) set("locationName", choices[0].name);
    } catch { setResourceChoices([]); }
  }

  function chooseBranch(id: string) {
    const branch = branches.find((item) => item.id === id);
    setBranchId(id); setServiceId(""); setSelectedServiceType(null); setProcedureQuery(""); setResourceChoices([]);
    setDraft((current) => current && { ...current, branch: branch?.name ?? "", service: "", reason: "", procedureCode: "", locationName: "", startTime: "", endTime: "" });
  }

  function chooseService(id: string) {
    const service = branchServices.find((item) => item.id === id);
    setServiceId(id); setSelectedServiceType(null); setProcedureQuery(""); setResourceChoices([]);
    setDraft((current) => current && { ...current, service: service?.name ?? "", reason: "", procedureCode: "", locationName: "", startTime: "", endTime: "" });
  }

  function changeProcedureQuery(value: string) {
    setProcedureQuery(value); setSelectedServiceType(null); setResourceChoices([]);
    setDraft((current) => current && { ...current, reason: "", procedureCode: "", locationName: "", startTime: "", endTime: "" });
  }

  function pickSlot(start: string, end: string) {
    setDraft((current) => current && { ...current, startTime: start, endTime: end });
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
      const patient = await createPatient({ ...emptyPatientRecord, identifier: newPatient.identifier.trim(), identifierType: newPatient.identifierType, name: newPatient.name.trim(), birthDate: newPatient.birthDate, sex: newPatient.sex, phone: newPatient.phone.trim(), prevision: newPatient.prevision, consentAt: new Date().toISOString() });
      setPatients((current) => [...current, patient].sort((a, b) => a.name.localeCompare(b.name)));
      setDraft((current) => current && { ...current, patientId: patient.id });
      setPatientQuery(`${patient.name} · ${patient.identifier}`);
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
    if (!draft.branch || !draft.service || !draft.reason || !draft.locationName || (draft.practitionerRequirement === "required" && !draft.practitionerName)) { setStep(1); return setError("Completa sucursal, servicio, prestación, recurso y los participantes obligatorios."); }
    if (!draft.startTime || !draft.endTime) { setStep(1); return setError("Selecciona un horario disponible."); }
    const reasonCoding = codingError(draft.reasonCodeSystem, draft.reasonCode, draft.reasonCodeDisplay, "Diagnóstico de la cita");
    if (reasonCoding) { setStep(2); return setError(reasonCoding); }
    const patient = patients.find((item) => item.id === draft.patientId);
    const exists = Boolean(draft.id);
    const candidate = { ...draft, id: draft.id || crypto.randomUUID(), patientName: patient?.name ?? "" };
    const message = appointmentError(candidate, appointments) || scheduleError(candidate, schedules, holidays);
    if (message) { setStep(1); return setError(message); }
    setSaving(true);
    try {
      await saveAppointment(candidate, exists);
      if (pendingOrder) {
        try {
          candidate.orderFile = await uploadOrderFile(candidate.id, pendingOrder);
        } catch {
          setNotice("La cita quedó guardada, pero no fue posible adjuntar la orden.");
        }
      }
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

  async function changeStatus(id: string, status: AppointmentStatus, reason = "") {
    try {
      await setAppointmentStatus(id, status, reason);
      setAppointments((current) => current.map((item) => item.id === id ? { ...item, status, statusReason: reason } : item));
    } catch {
      setError("No fue posible actualizar el estado.");
    }
  }

  function requestStatus(id: string, status: AppointmentStatus) {
    if (["cancelled", "no_show"].includes(status)) setPendingStatus({ id, status, reason: "" });
    else changeStatus(id, status);
  }

  return (
    <div className="agenda-page">
      <div className="page-header agenda-header"><div><p className="eyebrow">Agenda clínica</p><h2>{displayDate(date)}</h2><p>Reserva, confirma y acompaña cada examen desde una sola vista.</p></div><button className="button primary agenda-new" type="button" onClick={() => draft ? setDraft(null) : openDraft(emptyDraft(date))}>{draft ? "Cerrar reserva" : "+ Nueva reserva"}</button></div>
      {error && !draft && <p className="notice" role="alert">{error}</p>}

      {!draft && <section className="agenda-summary" aria-label="Resumen del día">
        <span><strong>{visibleAppointments.length}</strong> citas</span>
        <span><strong>{waiting}</strong> en atención</span>
        <span><strong>{completed}</strong> atendidas</span>
      </section>}

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
                <label className="span-2 patient-search">Buscar paciente *
                  <input type="search" value={patientQuery} onChange={(event) => { setPatientQuery(event.target.value); set("patientId", ""); }} placeholder="Escribe nombre o Patient ID" autoComplete="off" />
                  {patientMatches.length > 0 && <span className="patient-search-results">{patientMatches.map((patient) => <button type="button" key={patient.id} onClick={() => { set("patientId", patient.id); setPatientQuery(`${patient.name} · ${patient.identifier}`); }}><strong>{patient.name}</strong><small>{identifierTypeLabels[patient.identifierType]} · {patient.identifier}</small></button>)}</span>}
                  {patientQuery.trim().length >= 2 && !selectedPatient && !patientMatches.length && <span className="empty-inline">Sin coincidencias.</span>}
                </label>
                <div className="booking-grid-action"><button className="button secondary" type="button" onClick={() => setNewPatient(newPatient ? null : { ...emptyNewPatient })}>{newPatient ? "Cancelar creación" : "+ Nuevo paciente"}</button></div>
              </div>
              {selectedPatient && !newPatient && (
                <div className="patient-chip">
                  <span><strong>{identifierTypeLabels[selectedPatient.identifierType]} / Patient ID:</strong> {selectedPatient.identifier}</span>
                  <span><strong>Nacimiento:</strong> {selectedPatient.birthDate}</span>
                  <span><strong>Previsión:</strong> {selectedPatient.prevision || "No registrada"}</span>
                  <span><strong>Consentimiento:</strong> {selectedPatient.consentAt ? "Otorgado" : "Pendiente"}</span>
                </div>
              )}
              {newPatient && (
                <div className="booking-grid inner-form">
                  <label>Tipo de identificador<select value={newPatient.identifierType} onChange={(event) => setNewPatient({ ...newPatient, identifierType: event.target.value as Patient["identifierType"] })}>{Object.entries(identifierTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label>Número / Patient ID *<input value={newPatient.identifier} onChange={(event) => setNewPatient({ ...newPatient, identifier: event.target.value })} placeholder="Se usará como Patient ID DICOM" /></label>
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
                <label className="span-2">Sucursal *<select value={branchId} onChange={(event) => chooseBranch(event.target.value)}><option value="">Seleccionar…</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
                <label className="span-2">Servicio *<select value={serviceId} onChange={(event) => chooseService(event.target.value)} disabled={!branchId}><option value="">Seleccionar…</option>{branchServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
                <div className="span-2 procedure-picker"><label>Prestación *<input type="search" value={procedureQuery} onChange={(event) => changeProcedureQuery(event.target.value)} placeholder={serviceId ? "Filtra por nombre o código" : "Selecciona primero sucursal y servicio"} disabled={!serviceId} autoComplete="off" /></label>{serviceId && !selectedServiceType && <div className="procedure-browser"><small>{procedureQuery ? "Resultados" : "Prestaciones disponibles"}</small>{procedureMatches.map((type) => <button type="button" key={type.id} onClick={() => chooseServiceType(type)}><span><strong>{type.name}</strong><small>{type.code || "Sin código"} · {type.durationMin} min</small></span><span>Elegir →</span></button>)}{!procedureMatches.length && <span className="empty-inline">No hay coincidencias.</span>}</div>}{selectedServiceType && <div className="selected-procedure"><span><strong>{selectedServiceType.name}</strong><small>{selectedServiceType.code || "Sin código"} · {selectedServiceType.durationMin} min</small></span><button className="text-button" type="button" onClick={() => changeProcedureQuery("")}>Cambiar</button></div>}</div>
                <label>Recurso compatible *<select value={draft.locationName} onChange={(event) => set("locationName", event.target.value)} disabled={!selectedServiceType && !draft.id}><option value="">Seleccionar…</option>{resourceChoices.map((resource) => <option key={resource.id} value={resource.name}>{resource.name}</option>)}</select></label>
                <label>Fecha *<input required type="date" value={draft.date} onChange={(event) => set("date", event.target.value)} /></label>
                {draft.practitionerRequirement !== "none" && <label>Profesional {draft.practitionerRequirement === "required" ? "*" : "(opcional)"}<select value={draft.practitionerName} onChange={(event) => set("practitionerName", event.target.value)}><option value="">Seleccionar…</option>{options.profesional.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</select></label>}
                {draft.reason && <div className="service-rule-summary"><span>{draft.serviceCategory === "consultation" ? "Consulta" : draft.serviceCategory === "imaging" ? "Imagenología" : draft.serviceCategory === "laboratory" ? "Laboratorio" : draft.serviceCategory === "pathology" ? "Anatomía patológica" : "Procedimiento"}</span>{draft.modality !== "OT" && <span>Modalidad {draft.modality}</span>}</div>}

                <div className="slot-picker span-2">
                  <span className="slot-picker-head">Horarios disponibles <small>· {procedureDuration} min por bloque</small>{draft.startTime && <em> · seleccionado {draft.startTime}–{draft.endTime}</em>}</span>
                  {!draft.locationName || !draft.reason
                    ? <p className="empty-inline">Elige prestación y sala para ver los bloques.</p>
                    : dayHoliday
                    ? <p className="empty-inline">Feriado{dayHoliday.label ? ` (${dayHoliday.label})` : ""}: la sala no atiende.</p>
                    : slots.length
                    ? <div className="time-picker">{[{ label: "Mañana", items: slots.filter((slot) => slot.start < "12:00") }, { label: "Tarde", items: slots.filter((slot) => slot.start >= "12:00") }].filter((period) => period.items.length).map((period) => <div className="time-period" key={period.label}><small>{period.label}</small><div>{period.items.map((slot) => <button type="button" key={slot.start} className={draft.startTime === slot.start ? "active" : ""} onClick={() => pickSlot(slot.start, slot.end)}><strong>{slot.start}</strong><span>– {slot.end}</span></button>)}</div></div>)}</div>
                    : <p className="empty-inline">Sin bloques libres ese día. Ajusta el horario de la sala en Configuración o usa horario manual.</p>}
                  <button type="button" className="text-button" onClick={() => setManualTime((value) => !value)}>{manualTime ? "Ocultar horario manual" : "Otro horario (manual)"}</button>
                </div>

                {manualTime && <>
                  <label>Inicio<input type="time" value={draft.startTime} onChange={(event) => set("startTime", event.target.value)} /></label>
                  <label>Término<input type="time" value={draft.endTime} onChange={(event) => set("endTime", event.target.value)} /></label>
                </>}
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
                <label>Sistema del diagnóstico<select value={draft.reasonCodeSystem || "ICD-10"} onChange={(event) => set("reasonCodeSystem", event.target.value)}>{CODE_SYSTEMS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <CodePicker system={draft.reasonCodeSystem || "ICD-10"} code={draft.reasonCode} display={draft.reasonCodeDisplay}
                  onChange={(code, display) => setDraft((current) => current ? { ...current, reasonCode: code, reasonCodeDisplay: display } : current)} />
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
            {step === steps.length - 1 && <button className="button primary" type="submit" disabled={saving}>{draft.id ? "Actualizar reserva" : "Crear reserva"}</button>}
            {error && <p className="form-error" role="alert">{error}</p>}
            {notice && !error && <p className="form-notice" role="status">{notice}</p>}
          </footer>
        </form>
      )}

      <section className="toolbar agenda-toolbar" aria-label="Filtros de agenda">
        <label>Fecha<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>Profesional<select value={practitioner} onChange={(event) => setPractitioner(event.target.value)}><option value="all">Todos</option>{options.profesional.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</select></label>
        <label>Sala / equipo<select value={location} onChange={(event) => setLocation(event.target.value)}><option value="all">Todas</option>{options.sala.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</select></label>
        <button className="button secondary" type="button" onClick={() => setDate(today())}>Hoy</button>
      </section>

      <section className="schedule-list">
        {visibleAppointments.map((appointment) => <article className={`appointment-card appointment-${appointment.status}`} key={appointment.id}><div className="time-block"><strong>{appointment.startTime}</strong><span>{appointment.endTime}</span></div><div className="appointment-main"><h3>{appointment.patientName}{appointment.priority === "urgente" && <span className="status status-cancelled">Urgente</span>}</h3><p>{appointment.modality} · {appointment.reason}</p><span>{appointment.patientIdentifier && `ID ${appointment.patientIdentifier} · `}{appointment.practitionerName} · {appointment.locationName}{appointment.tags && ` · ${appointment.tags.split(",").join(", ")}`}</span></div><div className="appointment-actions"><select className={`status status-${appointment.status}`} aria-label={`Estado de ${appointment.patientName}`} value={appointment.status} onChange={(event) => requestStatus(appointment.id, event.target.value as AppointmentStatus)}>{APPOINTMENT_STATUSES.map((status) => <option key={status} value={status}>{appointmentStatusLabels[status]}</option>)}</select><button className="text-button" type="button" onClick={() => openDraft(appointment)}>Editar cita</button>{pendingStatus?.id === appointment.id && <div className="status-reason"><input aria-label="Motivo del cambio" autoFocus required value={pendingStatus.reason} onChange={(event) => setPendingStatus({ ...pendingStatus, reason: event.target.value })} placeholder="Motivo obligatorio" /><button className="text-button danger" type="button" disabled={!pendingStatus.reason.trim()} onClick={async () => { await changeStatus(appointment.id, pendingStatus.status, pendingStatus.reason.trim()); setPendingStatus(null); }}>Confirmar</button><button className="text-button" type="button" onClick={() => setPendingStatus(null)}>Cancelar</button></div>}</div></article>)}
        {!loading && !visibleAppointments.length && <div className="empty-state card"><strong>Sin citas para esta selección</strong><span>Cambia los filtros o crea una nueva reserva.</span></div>}
        {loading && <p className="empty-state card">Cargando agenda…</p>}
      </section>
    </div>
  );
}
