"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Appointment } from "@/features/appointments/mock-data";
import { fetchAppointments, orderFileUrl } from "@/features/appointments/repository";
import { appointmentStatusLabels } from "@/features/appointments/status";
import { fetchMyTenant, renderHeader, type Tenant } from "@/features/tenant/repository";
import { supabase } from "@/lib/supabase-client";
import {
  addAddendum, addCommunication, addFollowUp, fetchAddenda, fetchCommunications, fetchFollowUps, fetchReport,
  fetchSignatureUrl, saveReport, updateFollowUpStatus, type FollowUpStatus, type RadiologyReport, type ReportAddendum,
  type ReportCommunication, type ReportFollowUp,
} from "./repository";
import { fetchTemplates, type ReportTemplate } from "./templates";
import { validateFinalReport } from "./validation";

const fallbackOhifUrl = (process.env.NEXT_PUBLIC_OHIF_URL ?? "http://localhost:8042/ohif").replace(/\/$/, "");
const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const emptyReport = (appointmentId: string): RadiologyReport => ({
  appointmentId, clinicalIndication: "", technique: "", comparison: "Sin estudios previos disponibles.", findings: "", impression: "",
  status: "draft", criticalFinding: false, criticalFindingType: "", identityConfirmed: false, clinicalQuestionAnswered: false,
});

const criticalFindingTypes = [
  "Neumotórax a tensión", "Tromboembolismo pulmonar", "Disección o rotura aórtica", "Hemorragia intracraneal",
  "ACV isquémico agudo", "Neumoperitoneo / aire libre", "Isquemia mesentérica", "Fractura inestable de columna",
  "Torsión ovárica o testicular", "Embarazo ectópico", "Otro hallazgo crítico",
];
const channelLabels: Record<ReportCommunication["channel"], string> = { phone: "Teléfono", in_person: "Presencial", secure_message: "Mensajería segura", email: "Correo", other: "Otro" };
const followUpLabels: Record<FollowUpStatus, string> = { pending: "Pendiente", acknowledged: "Recibido", completed: "Realizado" };
const sections = [
  { name: "clinicalIndication", label: "Indicación clínica", hint: "Motivo del examen, antecedentes relevantes." },
  { name: "technique", label: "Técnica", hint: "Protocolo, contraste, limitaciones." },
  { name: "comparison", label: "Comparación", hint: "Estudios previos utilizados." },
  { name: "findings", label: "Hallazgos", hint: "Descripción sistemática por órgano/región." },
  { name: "impression", label: "Impresión", hint: "Conclusión numerada y recomendaciones." },
] as const;

const appointmentDetail = (appointment: Appointment): [string, string][] => [
  ["Identificador", appointment.patientIdentifier ?? ""], ["Previsión", appointment.patientPrevision ?? ""],
  ["Fecha y hora", `${appointment.date} ${appointment.startTime}–${appointment.endTime}`], ["Estado", appointmentStatusLabels[appointment.status]],
  ["Sucursal", appointment.branch], ["Servicio", appointment.service], ["Especialidad", appointment.specialty],
  ["Código de procedimiento", appointment.procedureCode], ["Médico tratante", appointment.treatingPhysician],
  ["Fecha de la orden", appointment.orderDate], ["Prioridad", appointment.priority], ["Anestesia", appointment.anesthesia ? "Sí" : ""],
  ["Contraste", appointment.contrast ? "Sí" : ""], ["Orden de pago", appointment.paymentOrder], ["Comentario", appointment.comment],
  ["Solicitante", [appointment.requesterName, appointment.requesterRun, appointment.requesterEmail].filter(Boolean).join(" · ")],
  ["Retira resultados", [appointment.pickupName, appointment.pickupRun, appointment.pickupPhone].filter(Boolean).join(" · ")],
  ["Procedencia", [appointment.originType, appointment.originDesc].filter(Boolean).join(" · ")], ["Etiquetas", appointment.tags],
];
const signerLabel = (name: string, registration: string) => [name, registration].filter(Boolean).join(" · ");

export function ReportWindow({ appointmentId }: { appointmentId: string }) {
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [priorReports, setPriorReports] = useState<Appointment[]>([]);
  const [report, setReport] = useState<RadiologyReport>(() => emptyReport(appointmentId));
  const [communications, setCommunications] = useState<ReportCommunication[]>([]);
  const [addenda, setAddenda] = useState<ReportAddendum[]>([]);
  const [followUps, setFollowUps] = useState<ReportFollowUp[]>([]);
  const [communicationDraft, setCommunicationDraft] = useState({ recipient: "", channel: "phone" as ReportCommunication["channel"], communicatedAt: localNow(), acknowledged: false, notes: "" });
  const [followUpDraft, setFollowUpDraft] = useState({ recommendation: "", dueDate: "", responsible: "" });
  const [addendumText, setAddendumText] = useState("");
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [viewerBase, setViewerBase] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signatureImage, setSignatureImage] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data }) => fetch("/api/pacs/session", { method: "POST", headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` } }))
      .then((response) => setViewerBase(response.ok ? "/ohif" : fallbackOhifUrl))
      .catch(() => setViewerBase(fallbackOhifUrl));
  }, []);

  useEffect(() => {
    Promise.all([fetchAppointments(), fetchReport(appointmentId), fetchCommunications(appointmentId), fetchAddenda(appointmentId), fetchFollowUps(appointmentId)])
      .then(([appointments, storedReport, storedCommunications, storedAddenda, storedFollowUps]) => {
        const current = appointments.find((item) => item.id === appointmentId) ?? null;
        setAppointment(current);
        if (current) setPriorReports(appointments
          .filter((item) => item.patientId === current.patientId && item.id !== current.id && item.reportStatus)
          .sort((a, b) => `${b.date}${b.startTime}`.localeCompare(`${a.date}${a.startTime}`)));
        if (storedReport) setReport(storedReport);
        setCommunications(storedCommunications); setAddenda(storedAddenda); setFollowUps(storedFollowUps);
      })
      .catch(() => setError("No fue posible cargar el estudio. Verifica que la migración clínica esté aplicada."))
      .finally(() => setLoading(false));
    fetchTemplates().then(setTemplates).catch(() => undefined);
    fetchMyTenant().then(setTenant).catch(() => undefined);
  }, [appointmentId]);

  useEffect(() => {
    if (report.signerId) fetchSignatureUrl(report.signerId).then(setSignatureImage).catch(() => undefined);
  }, [report.signerId]);

  /** Genera el PDF del informe firmado y lo archiva como serie DICOM junto a las imágenes del estudio. */
  async function archivePdfInPacs() {
    try {
      const { data } = await supabase.auth.getSession();
      const response = await fetch("/api/pacs/report-pdf", {
        method: "POST",
        headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId }),
      });
      const payload = await response.json().catch(() => ({}));
      setNotice(response.ok ? "Informe firmado; PDF archivado en el PACS." : `Informe firmado. ${payload.error ?? "No fue posible archivar el PDF en el PACS."}`);
    } catch {
      setNotice("Informe firmado. No fue posible archivar el PDF en el PACS.");
    }
  }

  function applyTemplate(id: string) {
    const template = templates.find((item) => item.id === id);
    if (!template) return;
    setReport((current) => ({ ...current, technique: template.technique, comparison: template.comparison, findings: template.findings, impression: template.impression }));
    setNotice(`Plantilla "${template.name}" aplicada.`);
  }

  async function persist(status: RadiologyReport["status"]) {
    if (status === "final") {
      const validation = validateFinalReport(report, communications.some((item) => item.urgency === "critical" && item.acknowledged));
      if (validation) return setError(validation);
    }
    setSaving(true); setError(""); setNotice("");
    try {
      const saved = await saveReport({ ...report, status });
      setReport(saved);
      setNotice(status === "final" ? "Informe firmado y bloqueado como definitivo." : "Borrador guardado.");
      if (status === "final") await archivePdfInPacs();
    } catch {
      setError(status === "final" ? "No fue posible firmar. Verifica tu perfil de administración/radiología y el registro profesional." : "No fue posible guardar el borrador.");
    } finally { setSaving(false); }
  }

  async function recordCommunication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const created = await addCommunication(appointmentId, { ...communicationDraft, communicatedAt: new Date(communicationDraft.communicatedAt).toISOString() });
      setCommunications((current) => [...current, created]);
      setCommunicationDraft({ recipient: "", channel: "phone", communicatedAt: localNow(), acknowledged: false, notes: "" });
      setNotice("Intento de comunicación registrado.");
    } catch { setError("No fue posible registrar la comunicación. Requiere perfil de administración o radiología."); }
    finally { setSaving(false); }
  }

  async function createFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const created = await addFollowUp(appointmentId, followUpDraft);
      setFollowUps((current) => [...current, created]);
      setFollowUpDraft({ recommendation: "", dueDate: "", responsible: "" });
      setNotice("Seguimiento accionable registrado.");
    } catch { setError("No fue posible registrar el seguimiento. Requiere perfil de administración o radiología."); }
    finally { setSaving(false); }
  }

  async function changeFollowUpStatus(id: string, status: FollowUpStatus) {
    setError("");
    try {
      const updated = await updateFollowUpStatus(id, status);
      setFollowUps((current) => current.map((item) => item.id === id ? updated : item));
    } catch { setError("No fue posible actualizar el seguimiento."); }
  }

  async function signAddendum(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const created = await addAddendum(appointmentId, addendumText.trim());
      setAddenda((current) => [...current, created]); setAddendumText(""); setNotice("Adenda firmada.");
    } catch { setError("No fue posible firmar la adenda. Requiere perfil de administración/radiología y un informe definitivo."); }
    finally { setSaving(false); }
  }

  if (loading) return <p className="empty-state">Cargando estudio…</p>;
  if (!appointment) return <p className="notice" role="alert">{error || "Estudio no encontrado."}</p>;

  const setSection = (name: string, value: string) => setReport((current) => ({ ...current, [name]: value }));
  const viewer = appointment.studyInstanceUid && viewerBase ? `${viewerBase}/viewer?StudyInstanceUIDs=${encodeURIComponent(appointment.studyInstanceUid)}` : null;
  const fullScreen = appointment.studyInstanceUid && viewerBase === "/ohif"
    ? `/api/pacs/handoff?next=${encodeURIComponent(`/ohif/viewer?StudyInstanceUIDs=${appointment.studyInstanceUid}`)}` : viewer;
  const detail: [string, string][] = [["Anamnesis", appointment.anamnesis || "—"], ["Hipótesis diagnóstica", appointment.diagnosticHypothesis || "—"], ...appointmentDetail(appointment).filter(([, value]) => value)];
  const acknowledgedCommunication = communications.findLast((item) => item.urgency === "critical" && item.acknowledged);

  return <div className="report-workstation">
    <header className="report-workstation-header">
      <div><p className="eyebrow">Informe radiológico</p><h2>{appointment.patientName}</h2><p className="report-meta">
        <span>{appointment.date} {appointment.startTime}</span><span>{appointment.modality} · {appointment.reason}</span><span>{appointment.locationName}</span><span>{appointmentStatusLabels[appointment.status]}</span>
      </p></div>
      <div className="report-header-actions">
        <button className="text-button" type="button" onClick={() => setShowDetail(true)}>Datos de la cita</button>
        <span className={`report-status ${report.status}`}>{report.status === "final" ? "Definitivo" : "Borrador"}</span>
        {report.status === "final" && <button className="text-button" type="button" onClick={() => window.print()}>Imprimir</button>}
        {fullScreen && <a className="text-button" href={fullScreen} target="_blank" rel="noreferrer">Pantalla completa ↗</a>}
      </div>
    </header>
    {error && <p className="notice" role="alert">{error}</p>}
    {showDetail && <div className="appointment-info-backdrop" role="dialog" aria-modal="true" aria-label="Datos del agendamiento" onClick={(event) => { if (event.target === event.currentTarget) setShowDetail(false); }}>
      <div className="appointment-info"><div className="card-heading"><h3>Datos del agendamiento</h3><button className="text-button" type="button" onClick={() => setShowDetail(false)}>Cerrar ✕</button></div>
        <dl>{detail.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {appointment.orderFile ? <button className="button secondary" type="button" onClick={() => orderFileUrl(appointment.orderFile).then((url) => window.open(url, "_blank")).catch(() => setError("No fue posible abrir el documento escaneado."))}>Ver documento escaneado 📎</button> : <p className="empty-inline">Sin documento escaneado adjunto.</p>}
      </div>
    </div>}

    <div className="report-layout">
      <section className="report-editor" aria-label="Editor de informe">
        <div className="report-fields">
          <div className="card-heading"><h3>Informe estructurado (ACR)</h3>{report.status !== "final" && templates.some((template) => template.active) &&
            <select defaultValue="" onChange={(event) => { applyTemplate(event.target.value); event.target.value = ""; }} aria-label="Aplicar plantilla">
              <option value="" disabled>Aplicar plantilla…</option>
              <optgroup label={`Modalidad ${appointment.modality}`}>{templates.filter((template) => template.active && template.modality === appointment.modality).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</optgroup>
              <optgroup label="Otras modalidades">{templates.filter((template) => template.active && template.modality !== appointment.modality).map((template) => <option key={template.id} value={template.id}>{template.modality} · {template.name}</option>)}</optgroup>
            </select>}
          </div>
          {sections.map((section) => <label key={section.name}>{section.label}<textarea name={section.name} value={report[section.name]} placeholder={section.hint} onChange={(event) => setSection(section.name, event.target.value)} disabled={report.status === "final"} /></label>)}

          <div className="report-confirmations">
            <label className="consent-field"><input type="checkbox" checked={report.identityConfirmed} disabled={report.status === "final"} onChange={(event) => setReport((current) => ({ ...current, identityConfirmed: event.target.checked }))} />Confirmo la identidad del paciente y el estudio.</label>
            <label className="consent-field"><input type="checkbox" checked={report.clinicalQuestionAnswered} disabled={report.status === "final"} onChange={(event) => setReport((current) => ({ ...current, clinicalQuestionAnswered: event.target.checked }))} />Confirmo que la impresión responde la pregunta clínica.</label>
          </div>

          <label className="consent-field critical-field"><input type="checkbox" checked={report.criticalFinding} disabled={report.status === "final"} onChange={(event) => setReport((current) => ({ ...current, criticalFinding: event.target.checked, criticalFindingType: event.target.checked ? current.criticalFindingType : "" }))} />Hallazgo crítico: requiere comunicación inmediata y confirmada.</label>
          {report.criticalFinding && <details className="report-clinical-panel collapsible critical-panel" open>
            <summary><span className="collapsible-icon">❤️‍🔥</span>Hallazgo crítico{report.criticalFindingType && <span className="collapsible-hint">{report.criticalFindingType}</span>}{communications.length > 0 && <span className="collapsible-count">{communications.length}</span>}</summary>
            <label>Tipo de hallazgo crítico<select value={report.criticalFindingType} disabled={report.status === "final"} onChange={(event) => setReport((current) => ({ ...current, criticalFindingType: event.target.value }))}><option value="">Seleccionar…</option>{criticalFindingTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
            <h4>Registro de comunicación</h4>
            {communications.map((item) => <div className="workflow-entry" key={item.id}><strong>{item.acknowledged ? "Confirmada" : "Sin confirmación"}</strong><span>{new Date(item.communicatedAt).toLocaleString("es-CL")} · {item.recipient} · {channelLabels[item.channel]}</span>{item.notes && <span>{item.notes}</span>}</div>)}
            <form className="report-inline-form" onSubmit={recordCommunication}>
              <label>Destinatario<input required value={communicationDraft.recipient} onChange={(event) => setCommunicationDraft({ ...communicationDraft, recipient: event.target.value })} /></label>
              <label>Vía<select value={communicationDraft.channel} onChange={(event) => setCommunicationDraft({ ...communicationDraft, channel: event.target.value as ReportCommunication["channel"] })}>{Object.entries(channelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Fecha y hora<input required type="datetime-local" value={communicationDraft.communicatedAt} onChange={(event) => setCommunicationDraft({ ...communicationDraft, communicatedAt: event.target.value })} /></label>
              <label className="consent-field"><input type="checkbox" checked={communicationDraft.acknowledged} onChange={(event) => setCommunicationDraft({ ...communicationDraft, acknowledged: event.target.checked })} />Recepción confirmada</label>
              <label className="span-2">Notas / intento fallido<textarea value={communicationDraft.notes} onChange={(event) => setCommunicationDraft({ ...communicationDraft, notes: event.target.value })} /></label>
              <button className="button secondary" disabled={saving} type="submit">Registrar intento</button>
            </form>
          </details>}

          <details className="report-clinical-panel collapsible">
            <summary><span className="collapsible-icon">📌</span>Seguimientos accionables{followUps.length > 0 && <span className="collapsible-count">{followUps.length}</span>}</summary>
            {followUps.map((item) => <div className="workflow-entry" key={item.id}><strong>{item.recommendation}</strong><span>Plazo: {new Date(`${item.dueDate}T00:00:00`).toLocaleDateString("es-CL")} · Responsable: {item.responsible}</span><label>Estado<select value={item.status} onChange={(event) => changeFollowUpStatus(item.id, event.target.value as FollowUpStatus)}>{Object.entries(followUpLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>)}
            <form className="report-inline-form" onSubmit={createFollowUp}>
              <label className="span-2">Recomendación<textarea required value={followUpDraft.recommendation} onChange={(event) => setFollowUpDraft({ ...followUpDraft, recommendation: event.target.value })} placeholder="Ej.: TC de tórax de control" /></label>
              <label>Fecha límite<input required type="date" value={followUpDraft.dueDate} onChange={(event) => setFollowUpDraft({ ...followUpDraft, dueDate: event.target.value })} /></label>
              <label>Responsable<input required value={followUpDraft.responsible} onChange={(event) => setFollowUpDraft({ ...followUpDraft, responsible: event.target.value })} placeholder="Médico tratante / unidad" /></label>
              <button className="button secondary" disabled={saving} type="submit">Agregar seguimiento</button>
            </form>
          </details>

          {priorReports.length > 0 && <details className="report-clinical-panel collapsible">
            <summary><span className="collapsible-icon">🗂️</span>Informes anteriores del paciente<span className="collapsible-count">{priorReports.length}</span></summary>
            <div className="prior-reports">{priorReports.map((prior) => <a key={prior.id} href={`/informe/${prior.id}`} target="_blank" rel="noreferrer"><span>{prior.date}</span><span className="prior-reason">{prior.modality} · {prior.reason}</span><span className={`report-status ${prior.reportStatus}`}>{prior.reportStatus === "final" ? "Definitivo" : "Borrador"}</span></a>)}</div>
          </details>}

          {report.status === "final" && <details className="report-clinical-panel collapsible">
            <summary><span className="collapsible-icon">✍️</span>Versiones y adendas{addenda.length > 0 && <span className="collapsible-count">{addenda.length + 1}</span>}</summary>
            <div className="workflow-entry"><strong>Versión 1 · Informe definitivo</strong><span>{report.signedAt && new Date(report.signedAt).toLocaleString("es-CL")} · {report.signer && signerLabel(report.signer.name, report.signer.registration)}</span></div>
            {addenda.map((item, index) => <div className="workflow-entry" key={item.id}><strong>Adenda {index + 1}</strong><span>{item.text}</span><span>{new Date(item.signedAt).toLocaleString("es-CL")} · {signerLabel(item.signer.name, item.signer.registration)}</span></div>)}
            <form className="report-inline-form" onSubmit={signAddendum}><label className="span-2">Nueva adenda<textarea required value={addendumText} onChange={(event) => setAddendumText(event.target.value)} placeholder="Corrección o información adicional; no reemplaza el informe original." /></label><button className="button secondary" disabled={saving} type="submit">Firmar adenda</button></form>
          </details>}
        </div>

        <footer className="report-actions">
          {report.status === "draft" && <><button className="button secondary" type="button" disabled={saving} onClick={() => persist("draft")}>Guardar borrador</button><button className="button primary" type="button" disabled={saving} onClick={() => persist("final")}>Firmar definitivo</button></>}
          {report.status === "final" && <span>Definitivo inmutable · las correcciones se agregan como adenda.</span>}
          {notice && <span className="form-notice" role="status">{notice}</span>}
          {report.updatedAt && <span className="report-updated">Última modificación: {new Date(report.updatedAt).toLocaleString("es-CL")}</span>}
        </footer>
      </section>
      <section className="viewer-pane" aria-label="Visor de imágenes">{fullScreen ? <iframe src={fullScreen} title="Visor OHIF" allow="fullscreen" /> : <p className="empty-state">Este estudio aún no tiene imágenes vinculadas en el PACS.</p>}</section>
    </div>

    <div className="print-sheet" aria-hidden="true">
      <header>{tenant?.logoUrl && <img src={tenant.logoUrl} alt="" />}<div><h1>{tenant?.name ?? "Informe radiológico"}</h1><p>{[tenant?.rut && `RUT ${tenant.rut}`, tenant?.address, tenant?.phone].filter(Boolean).join(" · ")}</p></div></header>
      <h2>Informe radiológico</h2>
      {tenant?.reportHeader
        ? renderHeader(tenant.reportHeader, { paciente: appointment.patientName, id: appointment.patientIdentifier || "—", medico: appointment.treatingPhysician || appointment.requesterName || "—", examen: `${appointment.modality} · ${appointment.reason}`, fecha: appointment.date, institucion: tenant.name }).split("\n").map((line, index) => <p key={index}>{line}</p>)
        : <><p><strong>Paciente:</strong> {appointment.patientName} · <strong>ID:</strong> {appointment.patientIdentifier || "—"}</p><p><strong>Examen:</strong> {appointment.modality} · {appointment.reason} · <strong>Fecha:</strong> {appointment.date}</p></>}
      {report.criticalFinding && <p><strong>⚠ HALLAZGO CRÍTICO{report.criticalFindingType && `: ${report.criticalFindingType}`}</strong>{acknowledgedCommunication && <> · Comunicado a {acknowledgedCommunication.recipient} por {channelLabels[acknowledgedCommunication.channel]}, {new Date(acknowledgedCommunication.communicatedAt).toLocaleString("es-CL")}.</>}</p>}
      {sections.map((section) => report[section.name] && <section key={section.name}><h3>{section.label}</h3><p>{report[section.name]}</p></section>)}
      {followUps.length > 0 && <section><h3>Recomendaciones y seguimiento</h3>{followUps.map((item) => <p key={item.id}>{item.recommendation} · Plazo {new Date(`${item.dueDate}T00:00:00`).toLocaleDateString("es-CL")} · {followUpLabels[item.status]}</p>)}</section>}
      {addenda.map((item, index) => <section key={item.id}><h3>Adenda {index + 1}</h3><p>{item.text}</p><p>{signerLabel(item.signer.name, item.signer.registration)} · {new Date(item.signedAt).toLocaleString("es-CL")}</p></section>)}
      <footer>{signatureImage && <img className="signature-image" src={signatureImage} alt="Firma" />}<p>{report.signer ? signerLabel(report.signer.name, report.signer.registration) : "Informe sin firma"}</p><p>Firmado electrónicamente · {report.signedAt ? new Date(report.signedAt).toLocaleString("es-CL") : ""}</p></footer>
    </div>
  </div>;
}
