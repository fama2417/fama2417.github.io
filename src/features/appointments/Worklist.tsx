"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Appointment } from "./mock-data";
import { fetchAppointments } from "./repository";
import { appointmentStatusLabels } from "./status";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const ohifUrl = (process.env.NEXT_PUBLIC_OHIF_URL ?? "http://localhost:8042/ohif").replace(/\/$/, "");
const orthancUrl = (process.env.NEXT_PUBLIC_ORTHANC_URL ?? "http://localhost:8042").replace(/\/$/, "");
const modalities = ["US", "DX", "CT", "MR", "MG"] as const;

export function Worklist() {
  const router = useRouter();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [date, setDate] = useState(today);
  const [patientQuery, setPatientQuery] = useState("");
  const [modality, setModality] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => { fetchAppointments().then(setAppointments).catch(() => setError("No fue posible cargar la worklist.")).finally(() => setLoading(false)); }, []);

  const worklist = useMemo(() => appointments
    .filter((item) => (!date || item.date === date) && !["cancelled", "no_show"].includes(item.status))
    .filter((item) => item.patientName.toLowerCase().includes(patientQuery.toLowerCase()))
    .filter((item) => (!modality || item.modality === modality) && (!status || item.status === status))
    .sort((a, b) => a.startTime.localeCompare(b.startTime)), [appointments, date, patientQuery, modality, status]);

  return <>
    <div className="page-header"><div><p className="eyebrow">Lista de trabajo</p><h2>Estudios agendados</h2><p>Abre un paciente para redactar el informe radiológico junto a sus imágenes.</p></div><div className="integration-links"><a href={`${orthancUrl}/ui/app/`} target="_blank" rel="noreferrer">Administrar Orthanc ↗</a><a href={ohifUrl} target="_blank" rel="noreferrer">Abrir OHIF ↗</a></div></div>
    {error && <p className="notice" role="alert">{error}</p>}
    <div className="filter-layout">
      <aside className="filter-panel" aria-label="Filtros">
        <label>Paciente<input value={patientQuery} onChange={(event) => setPatientQuery(event.target.value)} placeholder="Nombre" type="search" /></label>
        <label>Fecha del estudio<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>Modalidad<select value={modality} onChange={(event) => setModality(event.target.value)}><option value="">Todas</option>{modalities.map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
        <label>Estado<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos</option>{Object.entries(appointmentStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button className="text-button" type="button" onClick={() => { setPatientQuery(""); setModality(""); setStatus(""); setDate(today()); }}>Restablecer</button>
      </aside>
      <section className="table-card">
        <table><thead><tr><th>Hora</th><th>Paciente</th><th>Modalidad</th><th>Procedimiento</th><th>Sala</th><th>Estado</th><th>Imágenes</th></tr></thead><tbody>
          {worklist.map((item) => <tr key={item.id} className="row-link" tabIndex={0} onClick={() => router.push(`/informe/${item.id}`)} onKeyDown={(event) => event.key === "Enter" && router.push(`/informe/${item.id}`)}>
            <td>{item.startTime}</td><td>{item.patientName}</td><td>{item.modality}</td><td>{item.reason}</td><td>{item.locationName}</td>
            <td><span className={`status status-${item.status}`}>{appointmentStatusLabels[item.status]}</span></td>
            <td>{item.studyInstanceUid ? "Disponibles" : "Pendiente"}</td>
          </tr>)}
        </tbody></table>
        {!loading && !worklist.length && <p className="empty-state">No se encontraron resultados.</p>}
        {loading && <p className="empty-state">Cargando worklist…</p>}
      </section>
    </div>
  </>;
}
