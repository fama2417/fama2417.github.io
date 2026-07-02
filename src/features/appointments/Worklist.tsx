"use client";

import { useEffect, useMemo, useState } from "react";
import type { Appointment } from "./mock-data";
import { fetchAppointments } from "./repository";
import { appointmentStatusLabels } from "./status";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const ohifUrl = (process.env.NEXT_PUBLIC_OHIF_URL ?? "http://localhost:8042/ohif").replace(/\/$/, "");
const orthancUrl = (process.env.NEXT_PUBLIC_ORTHANC_URL ?? "http://localhost:8042").replace(/\/$/, "");

export function Worklist() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [date, setDate] = useState(today);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => { fetchAppointments().then(setAppointments).catch(() => setError("No fue posible cargar la worklist.")).finally(() => setLoading(false)); }, []);
  const worklist = useMemo(() => appointments.filter((item) => item.date === date && !["cancelled", "no_show"].includes(item.status)).sort((a, b) => a.startTime.localeCompare(b.startTime)), [appointments, date]);

  return <>
    <div className="page-header"><div><p className="eyebrow">Lista de trabajo</p><h2>Estudios del día</h2><p>Derivada de las citas almacenadas en Supabase.</p></div><a className="button primary" href={ohifUrl} target="_blank" rel="noreferrer">Abrir OHIF</a></div>
    {error && <p className="notice" role="alert">{error}</p>}
    <section className="toolbar"><label>Fecha<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><div className="integration-links"><a href={`${orthancUrl}/ui/app/`} target="_blank" rel="noreferrer">Administrar Orthanc ↗</a></div></section>
    <section className="table-card"><table><thead><tr><th>Hora</th><th>Paciente</th><th>Modalidad</th><th>Examen</th><th>Equipo</th><th>Estado</th><th>Imágenes</th></tr></thead><tbody>{worklist.map((item) => <tr key={item.id}><td>{item.startTime}</td><td>{item.patientName}</td><td>{item.modality}</td><td>{item.reason}</td><td>{item.locationName}</td><td><span className={`status status-${item.status}`}>{appointmentStatusLabels[item.status]}</span></td><td>{item.studyInstanceUid ? <a className="text-button" href={`${ohifUrl}/viewer?StudyInstanceUIDs=${encodeURIComponent(item.studyInstanceUid)}`} target="_blank" rel="noreferrer">Ver imágenes</a> : "Pendiente"}</td></tr>)}</tbody></table>{!loading && !worklist.length && <p className="empty-state">No hay estudios para esta fecha.</p>}{loading && <p className="empty-state">Cargando worklist…</p>}</section>
  </>;
}
