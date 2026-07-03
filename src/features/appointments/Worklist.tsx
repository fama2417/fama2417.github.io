"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Appointment } from "./mock-data";
import { fetchAppointments, orderFileUrl, setAppointmentStatus } from "./repository";
import { APPOINTMENT_STATUSES, appointmentStatusLabels, type AppointmentStatus } from "./status";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const shiftDays = (days: number) => { const date = new Date(); date.setDate(date.getDate() + days); return date.toLocaleDateString("en-CA", { timeZone: "America/Santiago" }); };
const ohifUrl = (process.env.NEXT_PUBLIC_OHIF_URL ?? "http://localhost:8042/ohif").replace(/\/$/, "");
const orthancUrl = (process.env.NEXT_PUBLIC_ORTHANC_URL ?? "http://localhost:8042").replace(/\/$/, "");
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

const COLUMNS = ["Fecha", "Hora", "Paciente", "Modalidad", "Prestación", "Sala", "Profesional", "Estado", "Informe", "Alertas"] as const;
type Column = (typeof COLUMNS)[number];
const DEFAULT_COLUMNS: Column[] = ["Hora", "Paciente", "Modalidad", "Prestación", "Sala", "Estado", "Informe", "Alertas"];

export function Worklist() {
  const router = useRouter();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [patientQuery, setPatientQuery] = useState("");
  const [modality, setModality] = useState("");
  const [status, setStatus] = useState("");
  const [report, setReport] = useState("");
  const [columns, setColumns] = useState<Column[]>(DEFAULT_COLUMNS);
  const [showColumns, setShowColumns] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchAppointments().then(setAppointments).catch(() => setError("No fue posible cargar la worklist.")).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    const stored = localStorage.getItem("worklist-columns");
    if (stored) setColumns((JSON.parse(stored) as Column[]).filter((column) => COLUMNS.includes(column)));
  }, []);

  function toggleColumn(column: Column) {
    setColumns((current) => {
      const next = current.includes(column) ? current.filter((entry) => entry !== column) : COLUMNS.filter((entry) => current.includes(entry) || entry === column);
      localStorage.setItem("worklist-columns", JSON.stringify(next));
      return next;
    });
  }

  const worklist = useMemo(() => appointments
    .filter((item) => (!from || item.date >= from) && (!to || item.date <= to))
    .filter((item) => item.patientName.toLowerCase().includes(patientQuery.toLowerCase()))
    .filter((item) => (!modality || item.modality === modality) && (!status || item.status === status) && (!report || reportKey(item) === report))
    .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`)), [appointments, from, to, patientQuery, modality, status, report]);

  async function changeStatus(item: Appointment, status: AppointmentStatus) {
    const reason = ["cancelled", "no_show"].includes(status) ? window.prompt("Motivo del cambio de estado:") ?? "" : "";
    try {
      await setAppointmentStatus(item.id, status, reason);
      setAppointments((current) => current.map((entry) => entry.id === item.id ? { ...entry, status, statusReason: reason } : entry));
    } catch {
      setError("No fue posible actualizar el estado.");
    }
  }

  async function openOrder(path: string) {
    try {
      window.open(await orderFileUrl(path), "_blank");
    } catch {
      setError("No fue posible abrir la orden adjunta.");
    }
  }

  function exportCsv() {
    const header = ["Fecha", "Hora", "Paciente", "Modalidad", "Prestación", "Código", "Sala", "Profesional", "Estado", "Motivo", "Informe", "Prioridad"];
    const lines = worklist.map((item) => [item.date, item.startTime, item.patientName, item.modality, item.reason, item.procedureCode, item.locationName, item.practitionerName, appointmentStatusLabels[item.status], item.statusReason, reportLabels[reportKey(item)], item.priority]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`).join(";"));
    const blob = new Blob(["﻿" + [header.join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `worklist_${from}_${to}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const cell = (item: Appointment, column: Column) => {
    switch (column) {
      case "Fecha": return item.date;
      case "Hora": return <>{item.priority === "urgente" && <span className="priority-dot" title="Urgente" />}{item.startTime}</>;
      case "Paciente": return item.patientName;
      case "Modalidad": return item.modality;
      case "Prestación": return item.reason;
      case "Sala": return item.locationName;
      case "Profesional": return item.practitionerName;
      case "Estado": return <select className={`status status-${item.status}`} value={item.status} title={item.statusReason || undefined} onClick={(event) => event.stopPropagation()} onChange={(event) => changeStatus(item, event.target.value as AppointmentStatus)} aria-label={`Estado de ${item.patientName}`}>{APPOINTMENT_STATUSES.map((value) => <option key={value} value={value}>{appointmentStatusLabels[value]}</option>)}</select>;
      case "Informe": return <span className={`status ${reportClass[reportKey(item)]}`}>{reportLabels[reportKey(item)]}</span>;
      case "Alertas": return <span className="alert-icons" onClick={(event) => event.stopPropagation()}>
        {item.criticalFinding && <span title="Hallazgo crítico">❤️‍🔥</span>}
        {item.orderFile && <button className="text-button" type="button" title="Ver orden médica adjunta" onClick={() => openOrder(item.orderFile)}>📎</button>}
        {item.studyInstanceUid && <a className="text-button" title="Abrir imágenes en OHIF" href={`${ohifUrl}/viewer?StudyInstanceUIDs=${encodeURIComponent(item.studyInstanceUid)}`} target="_blank" rel="noreferrer">🖼️</a>}
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
        <a href={`${orthancUrl}/ui/app/`} target="_blank" rel="noreferrer">Orthanc ↗</a>
        <a href={ohifUrl} target="_blank" rel="noreferrer">OHIF ↗</a>
      </div>
    </div>
    {error && <p className="notice" role="alert">{error}</p>}
    <div className="filter-layout">
      <aside className="filter-panel" aria-label="Filtros">
        <label>Paciente<input value={patientQuery} onChange={(event) => setPatientQuery(event.target.value)} placeholder="Nombre" type="search" /></label>
        <label>Desde<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>Hasta<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <div className="preset-row">{presets.map((preset) => <button key={preset.label} className="tag" type="button" onClick={() => { const [nextFrom, nextTo] = preset.range(); setFrom(nextFrom); setTo(nextTo); }}>{preset.label}</button>)}</div>
        <label>Modalidad<select value={modality} onChange={(event) => setModality(event.target.value)}><option value="">Todas</option>{modalities.map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
        <label>Estado de la cita<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos</option>{Object.entries(appointmentStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Estado del informe<select value={report} onChange={(event) => setReport(event.target.value)}><option value="">Todos</option>{Object.entries(reportLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button className="text-button" type="button" onClick={() => { setPatientQuery(""); setModality(""); setStatus(""); setReport(""); setFrom(today()); setTo(today()); }}>Restablecer</button>
      </aside>
      <section className="table-card">
        <table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>
          {worklist.map((item) => <tr key={item.id} className="row-link" tabIndex={0} onClick={() => router.push(`/informe/${item.id}`)} onKeyDown={(event) => event.key === "Enter" && router.push(`/informe/${item.id}`)}>
            {columns.map((column) => <td key={column}>{cell(item, column)}</td>)}
          </tr>)}
        </tbody></table>
        {!loading && !worklist.length && <p className="empty-state">No se encontraron resultados.</p>}
        {loading && <p className="empty-state">Cargando worklist…</p>}
      </section>
    </div>
  </>;
}
