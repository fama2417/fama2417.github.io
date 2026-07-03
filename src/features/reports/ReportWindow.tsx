"use client";

import { useEffect, useState } from "react";
import type { Appointment } from "@/features/appointments/mock-data";
import { fetchAppointments } from "@/features/appointments/repository";
import { appointmentStatusLabels } from "@/features/appointments/status";
import { fetchMyTenant, type Tenant } from "@/features/tenant/repository";
import { fetchReport, saveReport, type RadiologyReport } from "./repository";
import { fetchTemplates, type ReportTemplate } from "./templates";

const ohifUrl = (process.env.NEXT_PUBLIC_OHIF_URL ?? "http://localhost:8042/ohif").replace(/\/$/, "");

const emptyReport = (appointmentId: string): RadiologyReport => ({
  appointmentId, clinicalIndication: "", technique: "", comparison: "Sin estudios previos disponibles.", findings: "", impression: "", status: "draft", criticalFinding: false,
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
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    Promise.all([fetchAppointments(), fetchReport(appointmentId)])
      .then(([appointments, storedReport]) => {
        setAppointment(appointments.find((item) => item.id === appointmentId) ?? null);
        if (storedReport) setReport(storedReport);
      })
      .catch(() => setError("No fue posible cargar el estudio."))
      .finally(() => setLoading(false));
    fetchTemplates().then(setTemplates).catch(() => undefined);
    fetchMyTenant().then(setTenant).catch(() => undefined);
  }, [appointmentId]);

  function applyTemplate(id: string) {
    const template = templates.find((item) => item.id === id);
    if (!template) return;
    setReport((current) => ({ ...current, technique: template.technique, comparison: template.comparison, findings: template.findings, impression: template.impression }));
    setNotice(`Plantilla "${template.name}" aplicada.`);
  }

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

  return <div className="report-workstation">
    <header className="report-workstation-header">
      <div>
        <p className="eyebrow">Informe radiológico</p>
        <h2>{appointment.patientName}</h2>
        <p className="report-meta">
          <span>{appointment.date} {appointment.startTime}</span><span>{appointment.modality} · {appointment.reason}</span>
          <span>{appointment.locationName}</span><span>{appointmentStatusLabels[appointment.status]}</span>
        </p>
      </div>
      <div className="report-header-actions">
        <span className={`report-status ${report.status}`}>{report.status === "final" ? "Definitivo" : "Borrador"}</span>
        {report.status === "final" && <button className="text-button" type="button" onClick={() => window.print()}>Imprimir</button>}
        {viewer && <a className="text-button" href={viewer} target="_blank" rel="noreferrer">Pantalla completa ↗</a>}
      </div>
    </header>
    {error && <p className="notice" role="alert">{error}</p>}
    <div className="report-layout">
      <section className="report-editor" aria-label="Editor de informe">
        <div className="report-fields">
          <div className="card-heading"><h3>Informe estructurado (ACR)</h3>
            {report.status !== "final" && templates.some((template) => template.active && template.modality === appointment.modality) &&
              <select defaultValue="" onChange={(event) => { applyTemplate(event.target.value); event.target.value = ""; }} aria-label="Aplicar plantilla">
                <option value="" disabled>Aplicar plantilla…</option>
                {templates.filter((template) => template.active && template.modality === appointment.modality).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>}
          </div>
          {sections.map((section) => (
            <label key={section.name}>{section.label}
              <textarea name={section.name} value={report[section.name]} placeholder={section.hint} onChange={(event) => setSection(section.name, event.target.value)} disabled={report.status === "final"} />
            </label>
          ))}
        </div>
        <label className="consent-field critical-field"><input type="checkbox" checked={report.criticalFinding} disabled={report.status === "final"} onChange={(event) => setReport((current) => ({ ...current, criticalFinding: event.target.checked }))} />Hallazgo crítico: requiere comunicación inmediata al solicitante (queda marcado en la lista de trabajo).</label>
        <footer className="report-actions">
          {report.status === "final"
            ? <button className="button secondary" type="button" disabled={saving} onClick={() => persist("draft")}>Reabrir como borrador</button>
            : <><button className="button secondary" type="button" disabled={saving} onClick={() => persist("draft")}>Guardar borrador</button>
              <button className="button primary" type="button" disabled={saving} onClick={() => persist("final")}>Firmar definitivo</button></>}
          {notice && <span className="form-notice" role="status">{notice}</span>}
          {report.updatedAt && <span className="report-updated">Última modificación: {new Date(report.updatedAt).toLocaleString("es-CL")}</span>}
        </footer>
      </section>
      <section className="viewer-pane" aria-label="Visor de imágenes">
        {viewer
          ? <iframe src={viewer} title="Visor OHIF" allow="fullscreen" />
          : <p className="empty-state">Este estudio aún no tiene imágenes vinculadas en el PACS.</p>}
      </section>
    </div>

    <div className="print-sheet" aria-hidden="true">
      <header>
        {tenant?.logoUrl && <img src={tenant.logoUrl} alt="" />}
        <div>
          <h1>{tenant?.name ?? "Informe radiológico"}</h1>
          <p>{[tenant?.rut && `RUT ${tenant.rut}`, tenant?.address, tenant?.phone].filter(Boolean).join(" · ")}</p>
        </div>
      </header>
      <h2>Informe radiológico</h2>
      <p><strong>Paciente:</strong> {appointment.patientName} · <strong>ID:</strong> {appointment.patientIdentifier || "—"}</p>
      <p><strong>Examen:</strong> {appointment.modality} · {appointment.reason} · <strong>Fecha:</strong> {appointment.date}</p>
      {report.criticalFinding && <p><strong>⚠ HALLAZGO CRÍTICO comunicado al solicitante.</strong></p>}
      {sections.map((section) => report[section.name] && <section key={section.name}><h3>{section.label}</h3><p>{report[section.name]}</p></section>)}
      <footer>
        <p>{appointment.practitionerName}</p>
        <p>Informe firmado electrónicamente · {report.updatedAt ? new Date(report.updatedAt).toLocaleString("es-CL") : ""}</p>
      </footer>
    </div>
  </div>;
}
