"use client";

import { useMemo, useState } from "react";
import { useStoredCollection } from "@/lib/storage";
import { initialAppointments, type Appointment } from "./mock-data";
import { appointmentStatusLabels } from "./status";

export function Worklist() {
  const [appointments] = useStoredCollection<Appointment>("agenda-appointments", initialAppointments);
  const [date, setDate] = useState(initialAppointments[0].date);
  const worklist = useMemo(() => appointments.filter((item) => item.date === date && !["cancelled", "no_show"].includes(item.status)).sort((a, b) => a.startTime.localeCompare(b.startTime)), [appointments, date]);

  return (
    <>
      <div className="page-header"><div><p className="eyebrow">Lista de trabajo</p><h2>Estudios del día</h2><p>Derivada de la agenda; Orthanc asociará las imágenes DICOM en la siguiente etapa conectada.</p></div><a className="button primary" href="http://localhost:8042/ohif/" target="_blank" rel="noreferrer">Abrir OHIF</a></div>
      <section className="toolbar"><label>Fecha<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><div className="integration-links"><a href="http://localhost:8042/ui/app/" target="_blank" rel="noreferrer">Administrar Orthanc ↗</a></div></section>
      <section className="table-card">
        <table><thead><tr><th>Hora</th><th>Paciente</th><th>Modalidad</th><th>Examen</th><th>Equipo</th><th>Estado</th></tr></thead>
          <tbody>{worklist.map((item) => <tr key={item.id}><td>{item.startTime}</td><td>{item.patientName}</td><td>{item.modality}</td><td>{item.reason}</td><td>{item.locationName}</td><td><span className={`status status-${item.status}`}>{appointmentStatusLabels[item.status]}</span></td></tr>)}</tbody>
        </table>
        {!worklist.length && <p className="empty-state">No hay estudios para esta fecha.</p>}
      </section>
    </>
  );
}
