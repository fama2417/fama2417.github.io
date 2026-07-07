"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-client";
import type { UnmatchedStudy } from "@/lib/orthanc";
import { fetchPatients } from "@/features/patients/repository";
import type { Patient } from "@/features/patients/mock-data";
import type { Appointment } from "./mock-data";
import { assignAppointment, fetchAppointments, fetchRadiologists, orderFileUrl, setAppointmentStatus } from "./repository";
import { APPOINTMENT_STATUSES, appointmentStatusLabels, type AppointmentStatus } from "./status";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const shiftDays = (days: number) => { const date = new Date(); date.setDate(date.getDate() + days); return date.toLocaleDateString("en-CA", { timeZone: "America/Santiago" }); };
const modalities = ["US", "DX", "CT", "MR", "MG"] as const;

const reportLabels = { none: "Sin informe", draft: "Borrador", final: "Definitivo" } as const;
const reportClass = { none: "status-cancelled", draft: "status-arrived", final: "status-completed" } as const;
const reportKey = (item: Appointment) => item.reportStatus ?? "none";

const presets = [
  { label: "Hoy", range: () => [today(), today()] },
  { label: "Semana", range: () => [shiftDays(-6), today()] },
  { label: "Mes", range: () => [shiftDays(-29), today()] },
  { label: "7 días", range: () => [today(), shiftDays(6)] },
  { label: "15 días", range: () => [today(), shiftDays(14)] },
  { label: "30 días", range: () => [today(), shiftDays(29)] },
] as const;

const COLUMNS = ["Fecha", "Hora", "Paciente", "ID Paciente", "Previsión", "Modalidad", "Prestación", "Sala", "Profesional", "Estado", "Informe", "Asignado", "Alertas"] as const;
type Column = (typeof COLUMNS)[number];
const DEFAULT_COLUMNS: Column[] = ["Hora", "Paciente", "ID Paciente", "Previsión", "Modalidad", "Prestación", "Estado", "Informe", "Asignado", "Alertas"];

type Filters = { from: string; to: string; patient: string; modality: string; status: string; report: string; professional: string; room: string; priority: string; assignment: string; tag: string; quick: string };
const emptyFilters = (): Filters => ({ from: today(), to: today(), patient: "", modality: "", status: "", report: "", professional: "", room: "", priority: "", assignment: "", tag: "", quick: "" });
const quickLabels: Record<string, string> = { pending: "Por informar", critical: "Hallazgos críticos", follow: "Seguimientos pendientes", mine: "Asignados a mí" };

// ponytail: filtros guardados en localStorage (mismo patrón que las columnas); mover a tabla si se necesitan entre dispositivos
type SavedFilter = { name: string; isDefault: boolean; filters: Filters };
const loadSaved = (): SavedFilter[] => { try { return JSON.parse(localStorage.getItem("worklist-saved-filters") ?? "[]"); } catch { return []; } };
const storeSaved = (items: SavedFilter[]) => localStorage.setItem("worklist-saved-filters", JSON.stringify(items));
const normalize = (value: string) => value.toLocaleLowerCase("es-CL").replace(/[^a-z0-9áéíóúñ]/g, "");

async function fixupApi(method: "GET" | "POST", body?: unknown) {
  const { data } = await supabase.auth.getSession();
  const response = await fetch("/api/pacs/unmatched", { method, headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "No fue posible consultar el PACS.");
  return payload;
}

export function Worklist() {
  const router = useRouter();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [saved, setSaved] = useState<SavedFilter[]>([]);
  const [selectedSaved, setSelectedSaved] = useState("");
  const [radiologists, setRadiologists] = useState<{ id: string; full_name: string }[]>([]);
  const [uid, setUid] = useState("");
  const [role, setRole] = useState("");
  const [columns, setColumns] = useState<Column[]>(DEFAULT_COLUMNS);
  const [showColumns, setShowColumns] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [unmatched, setUnmatched] = useState<UnmatchedStudy[]>([]);
  const [pacsConfigured, setPacsConfigured] = useState<boolean | null>(null);
  const [fixup, setFixup] = useState<UnmatchedStudy | null>(null);
  const [fixupQuery, setFixupQuery] = useState("");
  const [fixupPatients, setFixupPatients] = useState<Patient[]>([]);
  const [fixupTarget, setFixupTarget] = useState<{ kind: "appointment" | "patient"; id: string; label: string } | null>(null);
  const [fixupSaving, setFixupSaving] = useState(false);

  const set = (key: keyof Filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));

  useEffect(() => { fetchAppointments().then(setAppointments).catch(() => setError("No fue posible cargar la worklist.")).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      setUid(data.user?.id ?? "");
      const profile = await supabase.from("profiles").select("role").eq("id", data.user?.id ?? "").single();
      const nextRole = profile.data?.role ?? "";
      setRole(nextRole);
      if (nextRole === "admin") { fetchRadiologists().then(setRadiologists); loadUnmatched(); }
    });
    const stored = localStorage.getItem("worklist-columns");
    if (stored) setColumns((JSON.parse(stored) as Column[]).filter((column) => COLUMNS.includes(column)));
    const savedFilters = loadSaved();
    setSaved(savedFilters);
    const preset = savedFilters.find((item) => item.isDefault);
    if (preset) { setFilters({ ...emptyFilters(), ...preset.filters }); setSelectedSaved(preset.name); }
    // Acceso directo desde los indicadores del Inicio: /worklist?view=pending|critical|follow|mine|today
    const view = new URLSearchParams(window.location.search).get("view") ?? "";
    if (view === "today") setFilters((current) => ({ ...current, from: today(), to: today() }));
    else if (quickLabels[view]) setFilters((current) => ({ ...current, quick: view, from: "", to: "" }));
  }, []);

  async function loadUnmatched() {
    try {
      const payload = await fixupApi("GET");
      setPacsConfigured(payload.configured); setUnmatched(payload.studies ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible revisar estudios PACS sin vincular.");
    }
  }

  function toggleColumn(column: Column) {
    setColumns((current) => {
      const next = current.includes(column) ? current.filter((entry) => entry !== column) : COLUMNS.filter((entry) => current.includes(entry) || entry === column);
      localStorage.setItem("worklist-columns", JSON.stringify(next));
      return next;
    });
  }

  function saveCurrentFilters() {
    const name = window.prompt("Nombre del filtro:")?.trim();
    if (!name) return;
    const next = [...saved.filter((item) => item.name !== name), { name, isDefault: false, filters }];
    setSaved(next); storeSaved(next); setSelectedSaved(name);
  }

  function applySaved(name: string) {
    setSelectedSaved(name);
    const preset = saved.find((item) => item.name === name);
    if (preset) setFilters({ ...emptyFilters(), ...preset.filters });
  }

  function toggleDefault() {
    if (!selectedSaved) return;
    const next = saved.map((item) => ({ ...item, isDefault: item.name === selectedSaved ? !item.isDefault : false }));
    setSaved(next); storeSaved(next);
  }

  function deleteSaved() {
    if (!selectedSaved) return;
    const next = saved.filter((item) => item.name !== selectedSaved);
    setSaved(next); storeSaved(next); setSelectedSaved("");
  }

  const professionals = useMemo(() => [...new Set(appointments.map((item) => item.practitionerName).filter(Boolean))].sort(), [appointments]);
  const rooms = useMemo(() => [...new Set(appointments.map((item) => item.locationName).filter(Boolean))].sort(), [appointments]);
  const tags = useMemo(() => [...new Set(appointments.flatMap((item) => item.tags.split(",").map((tag) => tag.trim()).filter(Boolean)))].sort(), [appointments]);
  const fixupNeedle = normalize(fixupQuery);
  const fixupAppointments = useMemo(() => fixupNeedle.length < 2 ? [] : appointments.filter((item) => !item.orthancStudyId && normalize(`${item.patientName} ${item.patientIdentifier ?? ""} ${item.date}`).includes(fixupNeedle)).slice(0, 6), [appointments, fixupNeedle]);
  const fixupPatientMatches = useMemo(() => fixupNeedle.length < 2 ? [] : fixupPatients.filter((patient) => normalize(`${patient.name} ${patient.identifier}`).includes(fixupNeedle)).slice(0, 6), [fixupPatients, fixupNeedle]);

  const worklist = useMemo(() => appointments
    .filter((item) => (!filters.from || item.date >= filters.from) && (!filters.to || item.date <= filters.to))
    .filter((item) => `${item.patientName} ${item.patientIdentifier ?? ""}`.toLowerCase().includes(filters.patient.toLowerCase()))
    .filter((item) => (!filters.modality || item.modality === filters.modality) && (!filters.status || item.status === filters.status) && (!filters.report || reportKey(item) === filters.report))
    .filter((item) => (!filters.professional || item.practitionerName === filters.professional) && (!filters.room || item.locationName === filters.room) && (!filters.priority || item.priority === filters.priority))
    .filter((item) => !filters.assignment || (filters.assignment === "mias" ? item.assignedTo === uid : !item.assignedTo))
    .filter((item) => !filters.tag || item.tags.split(",").map((tag) => tag.trim()).includes(filters.tag))
    .filter((item) => !filters.quick
      || (filters.quick === "pending" && item.studyInstanceUid && item.reportStatus !== "final")
      || (filters.quick === "critical" && item.criticalFinding)
      || (filters.quick === "follow" && item.actionablePending)
      || (filters.quick === "mine" && item.assignedTo === uid))
    .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`)), [appointments, filters, uid]);

  async function changeStatus(item: Appointment, status: AppointmentStatus) {
    const reason = ["cancelled", "no_show"].includes(status) ? window.prompt("Motivo del cambio de estado:") ?? "" : "";
    try {
      await setAppointmentStatus(item.id, status, reason);
      setAppointments((current) => current.map((entry) => entry.id === item.id ? { ...entry, status, statusReason: reason } : entry));
    } catch {
      setError("No fue posible actualizar el estado.");
    }
  }

  async function assign(item: Appointment, profileId: string) {
    try {
      await assignAppointment(item.id, profileId || null);
      const name = radiologists.find((entry) => entry.id === profileId)?.full_name;
      setAppointments((current) => current.map((entry) => entry.id === item.id ? { ...entry, assignedTo: profileId || undefined, assigneeName: name } : entry));
    } catch {
      setError("No fue posible asignar la cita.");
    }
  }

  async function openOrder(path: string) {
    try {
      window.open(await orderFileUrl(path), "_blank");
    } catch {
      setError("No fue posible abrir la orden adjunta.");
    }
  }

  function openFixup(study: UnmatchedStudy) {
    setFixup(study); setFixupQuery(study.patientId || study.patientName); setFixupTarget(null); setError("");
    fetchPatients().then(setFixupPatients).catch(() => setError("No fue posible cargar pacientes para FixUp."));
  }

  async function linkFixup() {
    if (!fixup || !fixupTarget) return;
    setFixupSaving(true); setError(""); setNotice("");
    try {
      await fixupApi("POST", { studyId: fixup.id, [fixupTarget.kind === "appointment" ? "appointmentId" : "patientId"]: fixupTarget.id });
      setUnmatched((current) => current.filter((study) => study.id !== fixup.id));
      setAppointments(await fetchAppointments());
      setNotice(`Estudio vinculado a ${fixupTarget.label}.`);
      setFixup(null); setFixupTarget(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible vincular el estudio.");
    } finally { setFixupSaving(false); }
  }

  function exportCsv() {
    const header = ["Fecha", "Hora", "Paciente", "ID Paciente", "Previsión", "Modalidad", "Prestación", "Código", "Sala", "Profesional", "Estado", "Motivo", "Informe", "Asignado", "Prioridad"];
    const lines = worklist.map((item) => [item.date, item.startTime, item.patientName, item.patientIdentifier ?? "", item.patientPrevision ?? "", item.modality, item.reason, item.procedureCode, item.locationName, item.practitionerName, appointmentStatusLabels[item.status], item.statusReason, reportLabels[reportKey(item)], item.assigneeName ?? "", item.priority]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`).join(";"));
    const blob = new Blob(["﻿" + [header.join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `worklist_${filters.from}_${filters.to}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const cell = (item: Appointment, column: Column) => {
    switch (column) {
      case "Fecha": return item.date;
      case "Hora": return <>{item.priority === "urgente" && <span className="priority-dot" title="Urgente" />}{item.startTime}</>;
      case "Paciente": return item.patientName;
      case "ID Paciente": return item.patientIdentifier || "—";
      case "Previsión": return item.patientPrevision || "—";
      case "Modalidad": return item.modality;
      case "Prestación": return item.reason;
      case "Sala": return item.locationName;
      case "Profesional": return item.practitionerName;
      case "Estado": return <select className={`status status-${item.status}`} value={item.status} title={item.statusReason || undefined} onClick={(event) => event.stopPropagation()} onChange={(event) => changeStatus(item, event.target.value as AppointmentStatus)} aria-label={`Estado de ${item.patientName}`}>{APPOINTMENT_STATUSES.map((value) => <option key={value} value={value}>{appointmentStatusLabels[value]}</option>)}</select>;
      case "Informe": return <span className={`status ${reportClass[reportKey(item)]}`}>{reportLabels[reportKey(item)]}</span>;
      case "Asignado": return role === "admin" && radiologists.length
        ? <select className="assign-select" value={item.assignedTo ?? ""} onClick={(event) => event.stopPropagation()} onChange={(event) => assign(item, event.target.value)} aria-label={`Asignar informe de ${item.patientName}`}>
            <option value="">Sin asignar</option>
            {radiologists.map((entry) => <option key={entry.id} value={entry.id}>{entry.full_name}</option>)}
          </select>
        : <span>{item.assigneeName ?? (item.assignedTo === uid && uid ? "Yo" : item.assignedTo ? "Asignado" : "—")}</span>;
      case "Alertas": return <span className="alert-icons" onClick={(event) => event.stopPropagation()}>
        {item.criticalFinding && <span title="Hallazgo crítico">❤️‍🔥</span>}
        {item.actionablePending && <span title="Seguimiento accionable pendiente">📅</span>}
        {item.orderFile && <button className="text-button" type="button" title="Ver orden médica adjunta" onClick={() => openOrder(item.orderFile)}>📎</button>}
        {item.studyInstanceUid && <a className="text-button" title="Abrir imágenes" href={`/api/pacs/handoff?next=${encodeURIComponent(`/ohif/viewer?StudyInstanceUIDs=${item.studyInstanceUid}`)}`} target="_blank" rel="noreferrer">🖼️</a>}
      </span>;
    }
  };

  return <>
    <div className="page-header"><div><p className="eyebrow">Lista de trabajo</p><h2>Estudios agendados</h2><p>Abre un paciente para redactar el informe radiológico junto a sus imágenes.</p></div>
      <div className="integration-links">
        <button className="text-button" type="button" onClick={exportCsv}>Exportar CSV</button>
        <span className="column-picker">
          <button className="text-button" type="button" onClick={() => setShowColumns((visible) => !visible)}>Columnas ▾</button>
          {showColumns && <span className="column-menu">{COLUMNS.map((column) => <label key={column}><input type="checkbox" checked={columns.includes(column)} onChange={() => toggleColumn(column)} />{column}</label>)}</span>}
        </span>
      </div>
    </div>
    {error && <p className="notice" role="alert">{error}</p>}
    {notice && <p className="form-notice" role="status">{notice}</p>}
    {role === "admin" && pacsConfigured === false && <p className="notice">FixUp está listo, pero falta configurar <strong>Institución PACS</strong> en Configuración → Institución.</p>}
    {role === "admin" && unmatched.length > 0 && <section className="card pacs-unmatched" aria-label="Estudios PACS sin vincular">
      <div className="card-heading"><div><h3>Estudios PACS sin vincular ({unmatched.length})</h3><p>Requieren FixUp antes de entrar a la lista de trabajo.</p></div><button className="text-button" type="button" onClick={loadUnmatched}>Actualizar</button></div>
      <div className="pacs-unmatched-list">{unmatched.map((study) => <button type="button" key={study.id} onClick={() => openFixup(study)}><span className="fixup-alert" aria-hidden="true">!</span><span><strong>{study.patientName}</strong><small>{study.patientId || "Sin Patient ID"}{study.accessionNumber && ` · Accession ${study.accessionNumber}`} · {study.date} · {study.modality} · {study.description}</small></span><span>FixUp →</span></button>)}</div>
    </section>}
    <div className="filter-layout">
      <aside className="filter-panel" aria-label="Filtros">
        <div className="saved-filters">
          <label>Filtros guardados
            <select value={selectedSaved} onChange={(event) => applySaved(event.target.value)}>
              <option value="">—</option>
              {saved.map((item) => <option key={item.name} value={item.name}>{item.name}{item.isDefault ? " ★" : ""}</option>)}
            </select>
          </label>
          <div className="preset-row">
            <button className="tag" type="button" onClick={saveCurrentFilters}>Guardar actual</button>
            {selectedSaved && <button className="tag" type="button" onClick={toggleDefault} title="Se aplica al abrir la worklist">{saved.find((item) => item.name === selectedSaved)?.isDefault ? "Quitar predet." : "Predeterminado"}</button>}
            {selectedSaved && <button className="tag" type="button" onClick={deleteSaved}>Eliminar</button>}
          </div>
        </div>
        <label>Paciente<input value={filters.patient} onChange={(event) => set("patient", event.target.value)} placeholder="Nombre o identificador" type="search" /></label>
        <label>Desde<input type="date" value={filters.from} onChange={(event) => set("from", event.target.value)} /></label>
        <label>Hasta<input type="date" value={filters.to} onChange={(event) => set("to", event.target.value)} /></label>
        <div className="preset-row">{presets.map((preset) => <button key={preset.label} className="tag" type="button" onClick={() => { const [nextFrom, nextTo] = preset.range(); setFilters((current) => ({ ...current, from: nextFrom, to: nextTo })); }}>{preset.label}</button>)}</div>
        <label>Modalidad<select value={filters.modality} onChange={(event) => set("modality", event.target.value)}><option value="">Todas</option>{modalities.map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
        <label>Estado de la cita<select value={filters.status} onChange={(event) => set("status", event.target.value)}><option value="">Todos</option>{Object.entries(appointmentStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Estado del informe<select value={filters.report} onChange={(event) => set("report", event.target.value)}><option value="">Todos</option>{Object.entries(reportLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Profesional<select value={filters.professional} onChange={(event) => set("professional", event.target.value)}><option value="">Todos</option>{professionals.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        <label>Sala<select value={filters.room} onChange={(event) => set("room", event.target.value)}><option value="">Todas</option>{rooms.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        <label>Prioridad<select value={filters.priority} onChange={(event) => set("priority", event.target.value)}><option value="">Todas</option><option value="normal">Normal</option><option value="urgente">Urgente</option></select></label>
        <label>Vista rápida<select value={filters.quick} onChange={(event) => set("quick", event.target.value)}><option value="">Todas</option>{Object.entries(quickLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Asignación<select value={filters.assignment} onChange={(event) => set("assignment", event.target.value)}><option value="">Todas</option><option value="mias">Asignadas a mí</option><option value="sin">Sin asignar</option></select></label>
        {tags.length > 0 && <label>Etiqueta de cita<select value={filters.tag} onChange={(event) => set("tag", event.target.value)}><option value="">Todas</option>{tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select></label>}
        <button className="text-button" type="button" onClick={() => { setFilters(emptyFilters()); setSelectedSaved(""); }}>Restablecer</button>
      </aside>
      <section className="table-card">
        <table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>
          {worklist.map((item) => { const target = role === "operator" ? `/pacientes/${item.patientId}` : `/informe/${item.id}`; return <tr key={item.id} className="row-link" tabIndex={0} onClick={() => router.push(target)} onKeyDown={(event) => event.key === "Enter" && router.push(target)}>
            {columns.map((column) => <td key={column}>{cell(item, column)}</td>)}
          </tr>; })}
        </tbody></table>
        {!loading && !worklist.length && <p className="empty-state">No se encontraron resultados.</p>}
        {loading && <p className="empty-state">Cargando worklist…</p>}
      </section>
    </div>
    {fixup && <div className="appointment-info-backdrop" role="dialog" aria-modal="true" aria-label="FixUp de estudio PACS" onClick={(event) => { if (event.target === event.currentTarget) setFixup(null); }}>
      <div className="appointment-info fixup-modal">
        <div className="card-heading"><div><p className="eyebrow">FixUp PACS</p><h3>{fixup.patientName}</h3></div><button className="text-button" type="button" onClick={() => setFixup(null)}>Cerrar ✕</button></div>
        <p>{fixup.patientId || "Sin Patient ID"}{fixup.accessionNumber && ` · Accession ${fixup.accessionNumber}`} · {fixup.date} · {fixup.modality} · {fixup.description}</p>
        <label>Buscar cita o paciente<input type="search" value={fixupQuery} onChange={(event) => { setFixupQuery(event.target.value); setFixupTarget(null); }} placeholder="Nombre, Patient ID o fecha" autoFocus /></label>
        <div className="fixup-results">
          {fixupAppointments.length > 0 && <section><h4>Citas sin imágenes</h4>{fixupAppointments.map((item) => <button type="button" className={fixupTarget?.kind === "appointment" && fixupTarget.id === item.id ? "selected" : ""} key={item.id} onClick={() => setFixupTarget({ kind: "appointment", id: item.id, label: `${item.patientName} (${item.date})` })}><strong>{item.patientName} · {item.date} {item.startTime}</strong><span>{item.patientIdentifier} · {item.modality} · {item.reason}</span></button>)}</section>}
          {fixupPatientMatches.length > 0 && <section><h4>Crear cita desde paciente</h4>{fixupPatientMatches.map((patient) => <button type="button" className={fixupTarget?.kind === "patient" && fixupTarget.id === patient.id ? "selected" : ""} key={patient.id} onClick={() => setFixupTarget({ kind: "patient", id: patient.id, label: patient.name })}><strong>{patient.name}</strong><span>{patient.identifier} · se creará una cita completada con los datos DICOM</span></button>)}</section>}
          {fixupNeedle.length >= 2 && !fixupAppointments.length && !fixupPatientMatches.length && <p className="empty-inline">Sin coincidencias. Crea primero el paciente desde Agenda si sus datos no existen.</p>}
        </div>
        {fixupTarget && <p className="form-notice">Destino: {fixupTarget.label}</p>}
        <button className="button primary" type="button" disabled={!fixupTarget || fixupSaving} onClick={linkFixup}>{fixupSaving ? "Vinculando…" : fixupTarget?.kind === "patient" ? "Crear cita y vincular" : "Vincular con esta cita"}</button>
      </div>
    </div>}
  </>;
}
