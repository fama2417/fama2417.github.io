"use client";

import { useEffect, useState } from "react";
import type { Appointment } from "@/features/appointments/mock-data";
import { fetchAppointments } from "@/features/appointments/repository";
import { appointmentStatusLabels } from "@/features/appointments/status";
import { fetchReport, saveReport, type RadiologyReport } from "./repository";

const ohifUrl = (process.env.NEXT_PUBLIC_OHIF_URL ?? "http://localhost:8042/ohif").replace(/\/$/, "");

const emptyReport = (appointmentId: string): RadiologyReport => ({
  appointmentId, clinicalIndication: "", technique: "", comparison: "Sin estudios previos disponibles.", findings: "", impression: "", status: "draft",
});

// Secciones del informe estructurado según las guías de comunicación diagnóstica del ACR (ACR Practice Parameter for Communication of Diagnostic Imaging Findings).
const sections = [
  { name: "clinicalIndication", label: "Indicación clínica", hint: "Motivo del examen, antecedentes relevantes." },
  { name: "technique", label: "Técnica", hint: "Protocolo, contraste, limitaciones." },
  { name: "comparison", label: "Comparación", hint: "Estudios previos utilizados." },
  { name: "findings", label: "Hallazgos", hint: "Descripción sistemática por órgano/región." },
  { name: "impression", label: "Impresión", hint: "Conclusión numerada y recomendaciones." },
] as const;

export function ReportWindow({ appointmentId }: { appointmentId: string }) {
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [report, setReport] = useState<RadiologyReport>(() => emptyReport(appointmentId));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([fetchAppointments(), fetchReport(appointmentId)])
      .then(([appointments, storedReport]) => {
        setAppointment(appointments.find((item) => item.id === appointmentId) ?? null);
        if (storedReport) setReport(storedReport);
      })
      .catch(() => setError("No fue posible cargar el estudio."))
      .finally(() => setLoading(false));
  }, [appointmentId]);

  async function persist(status: RadiologyReport["status"]) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const next = { ...report, status };
      await saveReport(next);
      setReport(next);
      setNotice(status === "final" ? "Informe firmado como definitivo." : "Borrador guardado.");
    } catch {
      setError("No fue posible guardar. Solo perfiles de radiología pueden informar.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="empty-state">Cargando estudio…</p>;
  if (!appointment) return <p className="notice" role="alert">Estudio no encontrado.</p>;

  const setSection = (name: string, value: string) => setReport((current) => ({ ...current, [name]: value }));
  const viewer = appointment.studyInstanceUid ? `${ohifUrl}/viewer?StudyInstanceUIDs=${encodeURIComponent(appointment.studyInstanceUid)}` : null;

  return <>
    <div className="page-header">
      <div>
        <p className="eyebrow">Informe radiológico</p>
        <h2>{appointment.patientName}</h2>
        <p className="report-meta">
          <span>{appointment.date} {appointment.startTime}</span><span>{appointment.modality} · {appointment.reason}</span>
          <span>{appointment.locationName}</span><span>{appointmentStatusLabels[appointment.status]}</span>
        </p>
      </div>
      <span className={`report-status ${report.status}`}>{report.status === "final" ? "Definitivo" : "Borrador"}</span>
    </div>
    {error && <p className="notice" role="alert">{error}</p>}
    <div className="report-layout">
      <section className="report-editor" aria-label="Editor de informe">
        <h3>Informe estructurado (ACR)</h3>
        {sections.map((section) => (
          <label key={section.name}>{section.label}
            <textarea name={section.name} value={report[section.name]} placeholder={section.hint} onChange={(event) => setSection(section.name, event.target.value)} disabled={report.status === "final"} />
          </label>
        ))}
        <div className="report-actions">
          {report.status === "final"
            ? <button className="button secondary" type="button" disabled={saving} onClick={() => persist("draft")}>Reabrir como borrador</button>
            : <><button className="button secondary" type="button" disabled={saving} onClick={() => persist("draft")}>Guardar borrador</button>
              <button className="button primary" type="button" disabled={saving} onClick={() => persist("final")}>Firmar definitivo</button></>}
          {notice && <span className="form-notice" role="status">{notice}</span>}
        </div>
        {report.updatedAt && <p className="report-meta"><span>Última modificación: {new Date(report.updatedAt).toLocaleString("es-CL")}</span></p>}
      </section>
      <section className="viewer-pane" aria-label="Visor de imágenes">
        {viewer
          ? <iframe src={viewer} title="Visor OHIF" allow="fullscreen" />
          : <p className="empty-state">Este estudio aún no tiene imágenes vinculadas en el PACS.</p>}
      </section>
    </div>
    {viewer && <p className="report-meta" style={{ marginTop: 8 }}><a className="text-button" href={viewer} target="_blank" rel="noreferrer">Abrir visor en ventana completa ↗</a></p>}
  </>;
}
