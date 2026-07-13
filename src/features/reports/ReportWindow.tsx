"use client";

import { Fragment, FormEvent, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CODE_SYSTEMS, codeHref, codingError } from "@/features/clinical/coding";
import { CodePicker } from "@/features/clinical/CodePicker";
import { ClinicalWorkspace } from "@/features/clinical-workspace/ClinicalWorkspace";
import { clinicalProfileForCategory } from "@/features/clinical-workspace/profiles";
import type { Appointment } from "@/features/appointments/mock-data";
import { fetchAppointments, orderFileUrl } from "@/features/appointments/repository";
import { appointmentStatusLabels } from "@/features/appointments/status";
import { fetchMyTenant, renderHeader, type Tenant } from "@/features/tenant/repository";
import { supabase } from "@/lib/supabase-client";
import {
  addAddendum, addCommunication, addFollowUp, addKeyImage, captureUrl, deleteReport, fetchAddenda, fetchCommunications,
  fetchFollowUps, fetchKeyImages, fetchMyProfile, fetchReport, fetchSignatureUrl, isCaptureKeyImage, removeKeyImage,
  reopenReport, saveReport, updateFollowUpStatus, updateKeyImageCaption, uploadKeyImageCapture, type FollowUpStatus,
  type RadiologyReport, type ReportAddendum, type ReportCommunication, type ReportFollowUp, type ReportKeyImage,
} from "./repository";
import { AiFindingsPanel } from "./AiFindingsPanel";
import { fetchTemplates, type ReportTemplate } from "./templates";
import { profileFor, type ReportSection } from "./profiles";
import { criticalFindingState, criticalFindingTypeError, validateFinalReport } from "./validation";

const fallbackOhifUrl = (process.env.NEXT_PUBLIC_OHIF_URL ?? "http://localhost:8042/ohif").replace(/\/$/, "");
const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const emptyReport = (appointmentId: string, appointment?: Appointment): RadiologyReport => ({
  reportCategory: appointment?.serviceCategory ?? "imaging",
  reportCodeSystem: appointment?.standardCodeSystem || "LOCAL",
  reportCode: appointment?.standardCode || appointment?.procedureCode || appointment?.serviceTypeId || "",
  reportCodeDisplay: appointment?.standardDisplay || appointment?.reason || "",
  findingCodeSystem: "SNOMEDCT",
  findingCode: "",
  findingCodeDisplay: "",
  diagnosisCodeSystem: "ICD-10",
  diagnosisCode: "",
  diagnosisCodeDisplay: "",
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
const reportSectionOrder: Record<ReportSection["name"], number> = { impression: 0, findings: 1, clinicalIndication: 2, technique: 3, comparison: 4 };
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
  const [editorTab, setEditorTab] = useState<"report" | "coding">("report");
  const [showDetail, setShowDetail] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiOperationActive, setAiOperationActive] = useState(false);
  const [signatureImage, setSignatureImage] = useState<string | null>(null);
  const [keyImages, setKeyImages] = useState<ReportKeyImage[]>([]);
  const [captureUrls, setCaptureUrls] = useState<Record<string, string>>({});
  const [role, setRole] = useState<string>("");
  const [reportAction, setReportAction] = useState<{ kind: "reopen" | "delete"; reason: string } | null>(null);
  const viewerRef = useRef<HTMLIFrameElement>(null);
  const criticalPanelRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    keyImages.filter((item) => isCaptureKeyImage(item.instanceId)).forEach((item) => {
      setCaptureUrls((current) => {
        if (current[item.id]) return current;
        captureUrl(item.instanceId).then((url) => setCaptureUrls((next) => ({ ...next, [item.id]: url }))).catch(() => undefined);
        return current;
      });
    });
  }, [keyImages]);

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data }) => fetch("/api/pacs/session", { method: "POST", headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` } }))
      .then((response) => setViewerBase(response.ok ? "/ohif" : fallbackOhifUrl))
      .catch(() => setViewerBase(fallbackOhifUrl));
  }, []);

  useEffect(() => {
    Promise.all([fetchAppointments(), fetchReport(appointmentId), fetchAddenda(appointmentId), fetchFollowUps(appointmentId), fetchMyProfile()])
      .then(async ([appointments, storedReport, storedAddenda, storedFollowUps, profile]) => {
        const storedCommunications = storedReport?.id ? await fetchCommunications(storedReport.id) : [];
        const current = appointments.find((item) => item.id === appointmentId) ?? null;
        setAppointment(current);
        if (current) setPriorReports(appointments
          .filter((item) => item.patientId === current.patientId && item.id !== current.id && item.reportStatus)
          .sort((a, b) => `${b.date}${b.startTime}`.localeCompare(`${a.date}${a.startTime}`)));
        if (storedReport) setReport(storedReport);
        else if (current) setReport(emptyReport(appointmentId, current));
        setCommunications(storedCommunications); setAddenda(storedAddenda); setFollowUps(storedFollowUps);
        setRole(profile.role);
      })
      .catch(() => setError("No fue posible cargar el estudio. Verifica que la migración clínica esté aplicada."))
      .finally(() => setLoading(false));
    fetchTemplates().then(setTemplates).catch(() => undefined);
    fetchMyTenant().then(setTenant).catch(() => undefined);
    fetchKeyImages(appointmentId).then(setKeyImages).catch(() => undefined);
  }, [appointmentId]);

  useEffect(() => {
    const receiveCapture = (event: MessageEvent) => {
      const message = event.data as { type?: string; dataUrl?: string; name?: string };
      // Se acepta solo si viene del iframe del visor (independiente del origen, que cambia por el handoff a la VM).
      if (event.source !== viewerRef.current?.contentWindow || message.type !== "agenda-key-image" || !message.dataUrl?.startsWith("data:image/") || message.dataUrl.length > 20_000_000 || report.status === "final") return;
      fetch(message.dataUrl).then((response) => response.blob()).then((blob) => uploadCapture(new File([blob], message.name || "captura-ohif.png", { type: blob.type }))).catch(() => setError("No fue posible recibir la captura de OHIF."));
    };
    window.addEventListener("message", receiveCapture);
    return () => window.removeEventListener("message", receiveCapture);
  }, [report.status]);

  useEffect(() => {
    if (report.signerId) fetchSignatureUrl(report.signerId).then(setSignatureImage).catch(() => undefined);
  }, [report.signerId]);

  /** Archiva en el PACS el PDF del informe definitivo (lo genera el servidor con acceso directo a las imágenes). */
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

  /** Borra del PACS el PDF archivado de este informe. */
  async function deletePdfFromPacs() {
    if (appointment?.serviceCategory !== "imaging") return;
    const { data } = await supabase.auth.getSession();
    const response = await fetch(`/api/pacs/report-pdf?appointmentId=${encodeURIComponent(appointmentId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` } });
    if (!response.ok) throw new Error("No fue posible eliminar el PDF del PACS.");
  }

  function applyTemplate(id: string) {
    const template = templates.find((item) => item.id === id);
    if (!template) return;
    setReport((current) => ({ ...current, technique: template.technique, comparison: template.comparison, findings: template.findings, impression: template.impression }));
    setNotice(`Plantilla "${template.name}" aplicada.`);
  }

  function finalReportError() {
    const criticalState = criticalFindingState(report.criticalFinding, report.id, communications);
    return validateFinalReport(report, criticalState.status === "confirmed") || [
      codingError(report.reportCodeSystem, report.reportCode, report.reportCodeDisplay, "Reporte/prestación", true),
      codingError(report.findingCodeSystem, report.findingCode, report.findingCodeDisplay, "Hallazgo principal"),
      codingError(report.diagnosisCodeSystem, report.diagnosisCode, report.diagnosisCodeDisplay, "Diagnóstico"),
    ].find(Boolean) || "";
  }

  async function persist(status: RadiologyReport["status"]) {
    if (status === "final") {
      const validation = finalReportError();
      if (validation) { setError(validation); return null; }
    }
    setSaving(true); setError(""); setNotice("");
    try {
      const saved = await saveReport({ ...report, status, reportCategory: appointment?.serviceCategory ?? report.reportCategory });
      setReport(saved);
      setNotice(status === "final" ? "Reporte firmado y bloqueado como definitivo." : "Borrador guardado.");
      if (status === "final" && appointment?.serviceCategory === "imaging") await archivePdfInPacs();
      return saved;
    } catch {
      setError(status === "final" ? "No fue posible firmar. Verifica tu perfil de administración/radiología y el registro profesional." : "No fue posible guardar el borrador.");
      return null;
    } finally { setSaving(false); }
  }

  async function ensureDraftSavedForAi() {
    if (saving || !await persist("draft")) throw new Error("Draft save failed");
  }

  async function recordCommunication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const communicationReport = report.id ? report : await persist("draft");
      if (!communicationReport?.id) return;
      const created = await addCommunication(communicationReport.id, appointmentId, { ...communicationDraft, communicatedAt: new Date(communicationDraft.communicatedAt).toISOString() });
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

  async function toggleKeyImage(instanceId: string) {
    setError("");
    const existing = keyImages.find((item) => item.instanceId === instanceId);
    try {
      if (existing) {
        await removeKeyImage(existing.id, existing.instanceId);
        setKeyImages((current) => current.filter((item) => item.id !== existing.id));
      } else {
        const created = await addKeyImage(appointmentId, instanceId);
        setKeyImages((current) => [...current, created]);
      }
    } catch { setError("No fue posible actualizar las imágenes clave (requiere informe en borrador y perfil de radiología/admin)."); }
  }

  async function persistCaption(item: ReportKeyImage) {
    try { await updateKeyImageCaption(item.id, item.caption); } catch { setError("No fue posible guardar la leyenda."); }
  }

  const keyImageSrc = (item: ReportKeyImage) => isCaptureKeyImage(item.instanceId) ? captureUrls[item.id] : `/api/pacs/instances/${item.instanceId}/preview`;

  async function uploadCapture(file: File | undefined) {
    if (!file || report.status === "final") return;
    setSaving(true); setError("");
    try {
      const created = await uploadKeyImageCapture(appointmentId, file);
      setKeyImages((current) => [...current, created]);
      setNotice("Captura agregada como imagen clave.");
    } catch (cause) {
      setError(cause instanceof Error && cause.message.includes("1 MB") ? cause.message : "No fue posible subir la captura (JPG/PNG, requiere perfil de radiología/admin).");
    } finally { setSaving(false); }
  }

  /** Pegar (Ctrl+V) una captura del visor en cualquier parte del editor la agrega como imagen clave. */
  function handlePaste(event: React.ClipboardEvent) {
    const file = Array.from(event.clipboardData.files).find((entry) => entry.type.startsWith("image/"));
    if (file && report.status !== "final") { event.preventDefault(); uploadCapture(file); }
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    const file = Array.from(event.dataTransfer.files).find((entry) => entry.type.startsWith("image/"));
    if (file && report.status !== "final") uploadCapture(file);
  }

  const [addendumFiles, setAddendumFiles] = useState<File[]>([]);

  async function signAddendum(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const created = await addAddendum(appointmentId, addendumText.trim());
      const images = await Promise.all(addendumFiles.map((file) => uploadKeyImageCapture(appointmentId, file, created.id)));
      setAddenda((current) => [...current, created]);
      if (images.length) setKeyImages((current) => [...current, ...images]);
      setAddendumText(""); setAddendumFiles([]); setNotice("Adenda firmada.");
    } catch { setError("No fue posible firmar la adenda. Requiere perfil de administración/radiología y un informe definitivo."); }
    finally { setSaving(false); }
  }

  async function reopen(reason: string) {
    setSaving(true); setError("");
    try {
      const reopened = await reopenReport(appointmentId, reason);
      setReportAction(null);
      setReport(reopened); setNotice("Informe reabierto como borrador. El motivo quedó registrado.");
    } catch { setError("No fue posible reabrir el informe."); }
    finally { setSaving(false); }
  }

  async function removeReport(reason: string) {
    setSaving(true); setError("");
    try {
      await deleteReport(appointmentId, reason);
      setReport(emptyReport(appointmentId, appointment ?? undefined)); setCommunications([]); setAddenda([]); setKeyImages([]); setReportAction(null);
      try {
        await deletePdfFromPacs();
        setNotice("Informe eliminado (también del PACS). El motivo quedó registrado.");
      } catch {
        setNotice("Informe eliminado. El motivo quedó registrado, pero el PDF del PACS requiere limpieza manual.");
      }
    } catch { setError("No fue posible eliminar el informe."); }
    finally { setSaving(false); }
  }

  if (loading) return <p className="empty-state">Cargando estudio…</p>;
  if (!role) return <p className="notice" role="alert">{error || "No fue posible verificar tu perfil."}</p>;
  if (!appointment) return <p className="notice" role="alert">{error || "Estudio no encontrado."}</p>;

  const baseKeyImages = keyImages.filter((item) => !item.addendumId);
  const profile = profileFor(appointment.serviceCategory);
  const workspaceProfile = clinicalProfileForCategory(appointment.serviceCategory);
  const sections = profile.sections;
  const orderedSections = [...sections].sort((a, b) => reportSectionOrder[a.name] - reportSectionOrder[b.name]);
  const examLabel = `${appointment.serviceCategory === "imaging" && appointment.modality !== "OT" ? `${appointment.modality} · ` : ""}${appointment.reason}`;
  if (role === "operator") return <div className="report-workstation read-only-report">
    <header className="report-workstation-header"><div><p className="eyebrow">{profile.title}</p><h2>{appointment.patientName}</h2><p className="report-meta"><span>{appointment.date}</span><span>{examLabel}</span></p></div>{report.status === "final" && <button className="text-button" type="button" onClick={() => window.print()}>Imprimir</button>}</header>
    {report.status !== "final" ? <p className="notice">El informe definitivo aún no está disponible.</p> : <article className="card legal-content">
      {tenant?.reportHeader && <p>{renderHeader(tenant.reportHeader, { paciente: appointment.patientName, id: appointment.patientIdentifier || "—", medico: appointment.treatingPhysician || appointment.requesterName || "—", examen: examLabel, fecha: appointment.date, institucion: tenant.name })}</p>}
      {sections.map((section) => report[section.name] && <section key={section.name}><h3>{section.label}</h3><p>{report[section.name]}</p></section>)}
      {baseKeyImages.length > 0 && <section><h3>Imágenes clave</h3><div className="key-images-grid">{baseKeyImages.map((item) => <figure key={item.id}>{keyImageSrc(item) && <img src={keyImageSrc(item)} alt="Imagen clave" />}{item.caption && <figcaption>{item.caption}</figcaption>}</figure>)}</div></section>}
      {addenda.map((item, index) => <section key={item.id}><h3>Adenda {index + 1}</h3><p>{item.text}</p></section>)}
      <footer><strong>{report.signer ? signerLabel(report.signer.name, report.signer.registration) : ""}</strong>{report.signedAt && <p>Firmado el {new Date(report.signedAt).toLocaleString("es-CL")}</p>}</footer>
    </article>}
  </div>;

  const setSection = (name: string, value: string) => setReport((current) => ({ ...current, [name]: value }));
  const viewer = appointment.studyInstanceUid && viewerBase ? `${viewerBase}/viewer?StudyInstanceUIDs=${encodeURIComponent(appointment.studyInstanceUid)}` : null;
  const fullScreen = appointment.studyInstanceUid && viewerBase === "/ohif"
    ? `/api/pacs/handoff?next=${encodeURIComponent(`/ohif/viewer?StudyInstanceUIDs=${appointment.studyInstanceUid}`)}` : viewer;
  const detail: [string, string][] = [["Anamnesis", appointment.anamnesis || "—"], ["Hipótesis diagnóstica", appointment.diagnosticHypothesis || "—"], ...appointmentDetail(appointment).filter(([, value]) => value)];
  const institutionLabel = tenant?.name || appointment.branch || appointment.service;
  const criticalState = criticalFindingState(report.criticalFinding, report.id, communications);
  const acknowledgedCommunication = criticalState.communication;
  const signingError = report.status === "draft" ? finalReportError() : "";

  function showCriticalCommunication() {
    setEditorTab("report");
    requestAnimationFrame(() => {
      const panel = criticalPanelRef.current;
      if (!panel) return;
      panel.open = true;
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
      const target = criticalState.status === "confirmed"
        ? panel.querySelector<HTMLElement>("summary")
        : report.criticalFindingType
          ? panel.querySelector<HTMLElement>("input[required]")
          : panel.querySelector<HTMLElement>("select");
      target?.focus();
    });
  }

  function handleEditorTabKey(event: KeyboardEvent<HTMLElement>) {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const nextTab = editorTab === "report" ? "coding" : "report";
    setEditorTab(nextTab);
    requestAnimationFrame(() => document.getElementById(`${nextTab}-tab`)?.focus());
  }

  const criticalFindingControl = <Fragment>
    <label className="consent-field critical-field"><input type="checkbox" checked={report.criticalFinding} disabled={report.status === "final"} onChange={(event) => setReport((current) => ({ ...current, criticalFinding: event.target.checked, criticalFindingType: event.target.checked ? current.criticalFindingType : "" }))} />Hallazgo crítico: requiere comunicación inmediata y confirmada.</label>
    {report.criticalFinding && <details ref={criticalPanelRef} className="report-clinical-panel collapsible critical-panel" open>
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
  </Fragment>;

  return <div className="report-workstation">
    <header className="report-workstation-header">
      <div className="report-header-context">
        <div className="report-patient-line"><div><p className="eyebrow">{profile.title}</p><h2>{appointment.patientName}</h2></div>{appointment.patientIdentifier && <span className="report-patient-id">{appointment.patientIdentifier}</span>}</div>
        <strong className="report-study-name">{appointment.reason}</strong>
        <dl className="report-meta">
          <div><dt>Fecha</dt><dd>{appointment.date} · {appointment.startTime}</dd></div>
          {appointment.serviceCategory === "imaging" && <div><dt>Modalidad</dt><dd>{appointment.modality}</dd></div>}
          {institutionLabel && <div><dt>Institución</dt><dd>{institutionLabel}</dd></div>}
          {appointment.locationName && <div><dt>Ubicación</dt><dd>{appointment.locationName}</dd></div>}
          <div><dt>Estado cita</dt><dd>{appointmentStatusLabels[appointment.status]}</dd></div>
        </dl>
      </div>
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

    <ClinicalWorkspace profile={workspaceProfile} editor={<section className="report-editor" aria-label="Editor de informe" onPaste={handlePaste}>
        <nav className="ai-view-switch report-editor-tabs" role="tablist" aria-label="Secciones del informe" onKeyDown={handleEditorTabKey}>
          <button id="report-tab" type="button" role="tab" aria-controls="report-panel" aria-selected={editorTab === "report"} tabIndex={editorTab === "report" ? 0 : -1} onClick={() => setEditorTab("report")}>Informe</button>
          <button id="coding-tab" type="button" role="tab" aria-controls="coding-panel" aria-selected={editorTab === "coding"} tabIndex={editorTab === "coding" ? 0 : -1} onClick={() => setEditorTab("coding")}>Codificación</button>
        </nav>
        <div id="report-panel" className="report-fields report-tab-panel" role="tabpanel" aria-labelledby="report-tab" hidden={editorTab !== "report"}>
          <div className="card-heading"><h3>{profile.editor}</h3>{report.status !== "final" && templates.some((template) => template.active && template.category === appointment.serviceCategory) &&
            <select defaultValue="" onChange={(event) => { applyTemplate(event.target.value); event.target.value = ""; }} aria-label="Aplicar plantilla">
              <option value="" disabled>Aplicar plantilla…</option>
              {templates.filter((template) => template.active && template.category === appointment.serviceCategory && (appointment.serviceCategory !== "imaging" || template.modality === appointment.modality)).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              {appointment.serviceCategory === "imaging" && templates.filter((template) => template.active && template.category === "imaging" && template.modality !== appointment.modality).map((template) => <option key={template.id} value={template.id}>{template.modality} · {template.name}</option>)}
            </select>}
          </div>
          {orderedSections.map((section) => <Fragment key={section.name}>
            <label className={`report-section report-section-${section.name}`}>{section.label}<textarea name={section.name} value={report[section.name]} placeholder={section.hint} onChange={(event) => setSection(section.name, event.target.value)} disabled={report.status === "final"} /></label>
            {section.name === "impression" && criticalFindingControl}
          </Fragment>)}
          <div className="report-confirmations">
            <label className="consent-field"><input type="checkbox" checked={report.identityConfirmed} disabled={report.status === "final"} onChange={(event) => setReport((current) => ({ ...current, identityConfirmed: event.target.checked }))} />Confirmo la identidad del paciente y el estudio.</label>
            <label className="consent-field"><input type="checkbox" checked={report.clinicalQuestionAnswered} disabled={report.status === "final"} onChange={(event) => setReport((current) => ({ ...current, clinicalQuestionAnswered: event.target.checked }))} />Confirmo que la impresión responde la pregunta clínica.</label>
          </div>

          <details className="report-clinical-panel collapsible kin-panel" open>
            <summary><span className="collapsible-icon">🩻</span>Imágenes clave (KIN){fullScreen && <span className="kin-sync-status"><span aria-hidden="true">●</span>Sincronizado con OHIF</span>}{baseKeyImages.length > 0 && <span className="collapsible-count">{baseKeyImages.length}</span>}</summary>
            {baseKeyImages.length > 0 && <div className="key-images-grid">
              {baseKeyImages.map((item) => <figure key={item.id} className="key-image">
                {keyImageSrc(item) && <img src={keyImageSrc(item)} alt="Imagen clave" loading="lazy" />}
                {report.status === "final"
                  ? (item.caption && <figcaption>{item.caption}</figcaption>)
                  : <input value={item.caption} placeholder="Leyenda…" onChange={(event) => setKeyImages((current) => current.map((entry) => entry.id === item.id ? { ...entry, caption: event.target.value } : entry))} onBlur={() => persistCaption(keyImages.find((entry) => entry.id === item.id) ?? item)} />}
                {report.status !== "final" && <button className="text-button" type="button" onClick={() => toggleKeyImage(item.instanceId)}>Quitar</button>}
              </figure>)}
            </div>}
            {report.status === "final" && <p className="empty-inline">El informe está firmado: adjunta nuevas imágenes desde una adenda.</p>}
            {report.status !== "final" && <label className="key-image-dropzone" onDrop={handleDrop} onDragOver={(event) => event.preventDefault()}>
              <input type="file" accept="image/png,image/jpeg" hidden onChange={(event) => { uploadCapture(event.target.files?.[0]); event.target.value = ""; }} />
              <strong>Pega (Ctrl+V), arrastra o haz clic para agregar una imagen clave</strong>
              <span className="empty-inline">CT/MR/PET-CT: captura el corte con la cámara 📷 de OHIF (conserva las anotaciones) y suéltalo aquí — sin pasar por el escritorio si copias al portapapeles.</span>
            </label>}
          </details>

          <AiFindingsPanel reportId={report.id} reportStatus={report.status} disabled={!["admin", "radiologist"].includes(role) || saving} ensureDraftSaved={ensureDraftSavedForAi} onOperationActiveChange={setAiOperationActive} />

          <details className="report-clinical-panel collapsible report-secondary-panel">
            <summary><span className="collapsible-icon">📌</span>Seguimientos accionables{followUps.length > 0 && <span className="collapsible-count">{followUps.length}</span>}</summary>
            {followUps.map((item) => <div className="workflow-entry" key={item.id}><strong>{item.recommendation}</strong><span>Plazo: {new Date(`${item.dueDate}T00:00:00`).toLocaleDateString("es-CL")} · Responsable: {item.responsible}</span><label>Estado<select value={item.status} onChange={(event) => changeFollowUpStatus(item.id, event.target.value as FollowUpStatus)}>{Object.entries(followUpLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>)}
            <form className="report-inline-form" onSubmit={createFollowUp}>
              <label className="span-2">Recomendación<textarea required value={followUpDraft.recommendation} onChange={(event) => setFollowUpDraft({ ...followUpDraft, recommendation: event.target.value })} placeholder="Ej.: TC de tórax de control" /></label>
              <label>Fecha límite<input required type="date" value={followUpDraft.dueDate} onChange={(event) => setFollowUpDraft({ ...followUpDraft, dueDate: event.target.value })} /></label>
              <label>Responsable<input required value={followUpDraft.responsible} onChange={(event) => setFollowUpDraft({ ...followUpDraft, responsible: event.target.value })} placeholder="Médico tratante / unidad" /></label>
              <button className="button secondary" disabled={saving} type="submit">Agregar seguimiento</button>
            </form>
          </details>

          {priorReports.length > 0 && <details className="report-clinical-panel collapsible report-secondary-panel">
            <summary><span className="collapsible-icon">🗂️</span>Informes anteriores del paciente<span className="collapsible-count">{priorReports.length}</span></summary>
            <div className="prior-reports">{priorReports.map((prior) => <a key={prior.id} href={`/informe/${prior.id}`} target="_blank" rel="noreferrer"><span>{prior.date}</span><span className="prior-reason">{prior.modality} · {prior.reason}</span><span className={`report-status ${prior.reportStatus}`}>{prior.reportStatus === "final" ? "Definitivo" : "Borrador"}</span></a>)}</div>
          </details>}

          {report.status === "final" && <details className="report-clinical-panel collapsible" open>
            <summary><span className="collapsible-icon">✍️</span>Versiones y adendas<span className="collapsible-count">{addenda.length + 1}</span></summary>
            <div className="workflow-entry"><strong>Versión 1 · Informe definitivo</strong><span>{report.signedAt && new Date(report.signedAt).toLocaleString("es-CL")} · {report.signer && signerLabel(report.signer.name, report.signer.registration)}</span></div>
            {addenda.map((item, index) => <div className="workflow-entry" key={item.id}>
              <strong>Adenda {index + 1}</strong><span>{item.text}</span>
              <span>{new Date(item.signedAt).toLocaleString("es-CL")} · {signerLabel(item.signer.name, item.signer.registration)}</span>
              {keyImages.some((img) => img.addendumId === item.id) && <div className="key-images-grid">
                {keyImages.filter((img) => img.addendumId === item.id).map((img) => <figure key={img.id} className="key-image">{keyImageSrc(img) && <img src={keyImageSrc(img)} alt="Imagen de adenda" loading="lazy" />}{img.caption && <figcaption>{img.caption}</figcaption>}</figure>)}
              </div>}
            </div>)}
            <form className="report-inline-form" onSubmit={signAddendum}>
              <label className="span-2">Nueva adenda<textarea required value={addendumText} onChange={(event) => setAddendumText(event.target.value)} placeholder="Corrección o información adicional; no reemplaza el informe original." /></label>
              <label className="span-2">Imágenes de la adenda (opcional)<input type="file" accept="image/png,image/jpeg" multiple onChange={(event) => setAddendumFiles(Array.from(event.target.files ?? []))} /><span className="empty-inline">{addendumFiles.length ? `${addendumFiles.length} imagen(es) adjunta(s).` : "Captura desde OHIF y adjunta el corte con la anotación."}</span></label>
              <button className="button secondary" disabled={saving} type="submit">Firmar adenda</button>
            </form>
          </details>}
        </div>

        <div id="coding-panel" className="report-fields report-tab-panel report-coding-panel" role="tabpanel" aria-labelledby="coding-tab" hidden={editorTab !== "coding"}>
          <div className="card-heading"><h3>Codificación estándar</h3></div>
          <section className="report-clinical-panel coding-section">
            <div className="clinical-form">
              <label>Sistema reporte/prestación<select value={report.reportCodeSystem || "LOCAL"} disabled={report.status === "final"} onChange={(event) => setReport((current) => ({ ...current, reportCodeSystem: event.target.value }))}>{CODE_SYSTEMS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <CodePicker system={report.reportCodeSystem || "LOCAL"} code={report.reportCode} display={report.reportCodeDisplay} disabled={report.status === "final"}
                onChange={(code, display) => setReport((current) => ({ ...current, reportCode: code, reportCodeDisplay: display }))} />
              <label>Hallazgo principal<select value={report.findingCodeSystem || "SNOMEDCT"} disabled={report.status === "final"} onChange={(event) => setReport((current) => ({ ...current, findingCodeSystem: event.target.value }))}>{CODE_SYSTEMS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <CodePicker system={report.findingCodeSystem || "SNOMEDCT"} code={report.findingCode} display={report.findingCodeDisplay} disabled={report.status === "final"}
                onChange={(code, display) => setReport((current) => ({ ...current, findingCode: code, findingCodeDisplay: display }))} />
              <label>Diagnóstico administrativo<select value={report.diagnosisCodeSystem || "ICD-10"} disabled={report.status === "final"} onChange={(event) => setReport((current) => ({ ...current, diagnosisCodeSystem: event.target.value }))}>{CODE_SYSTEMS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <CodePicker system={report.diagnosisCodeSystem || "ICD-10"} code={report.diagnosisCode} display={report.diagnosisCodeDisplay} disabled={report.status === "final"}
                onChange={(code, display) => setReport((current) => ({ ...current, diagnosisCode: code, diagnosisCodeDisplay: display }))} />
            </div>
          </section>
        </div>

        <div className="report-editor-footer">
          {report.criticalFinding && <div className={`critical-status ${criticalState.status}`} role={criticalState.status === "pending" ? "alert" : "status"} aria-live={criticalState.status === "pending" ? "assertive" : "polite"} aria-atomic="true">
            <span className="critical-status-icon" aria-hidden="true">{criticalState.status === "pending" ? "⚠" : "✓"}</span>
            <div className="critical-status-copy">
              <strong>{criticalState.status === "pending" ? "Hallazgo crítico pendiente de comunicación" : "Hallazgo crítico comunicado"}</strong>
              {criticalState.status === "pending"
                ? <span>Requiere comunicación inmediata y confirmada.</span>
                : <span>{acknowledgedCommunication?.communicatedAt && `Fecha y hora: ${new Date(acknowledgedCommunication.communicatedAt).toLocaleString("es-CL")}`}{acknowledgedCommunication?.recipient && ` · Destinatario: ${acknowledgedCommunication.recipient}`}</span>}
              {!report.criticalFindingType && <span className="critical-status-warning">{criticalFindingTypeError}</span>}
            </div>
            <button className="button secondary critical-status-action" type="button" onClick={showCriticalCommunication}>{criticalState.status === "pending" ? "Registrar comunicación" : "Ver registro"}</button>
          </div>}
          <footer className="report-actions">
            <div className="report-save-state">
              {report.status === "final" && <strong>Definitivo · las correcciones se agregan como adenda.</strong>}
              <span className="report-updated">{saving ? "Guardando cambios…" : report.updatedAt ? `Última modificación: ${new Date(report.updatedAt).toLocaleString("es-CL")}` : "Borrador aún no guardado"}</span>
              {notice && <span className="form-notice" role="status">{notice}</span>}
              {report.status === "draft" && (aiOperationActive || signingError) && <span className="report-signing-error" role="status">{aiOperationActive ? "Espera a que finalice el análisis antes de firmar." : signingError}</span>}
            </div>
            <div className="report-action-buttons">
              {report.status === "draft" && <><button className="button secondary" type="button" disabled={saving} onClick={() => persist("draft")}>Guardar borrador</button><button className="button primary" type="button" disabled={saving || aiOperationActive} title={aiOperationActive ? "Espera a que finalice el análisis antes de firmar." : undefined} onClick={() => persist("final")}>Firmar definitivo</button></>}
              {report.status === "final" && role === "admin" && <><button className="button secondary" type="button" disabled={saving} onClick={() => setReportAction({ kind: "reopen", reason: "" })}>Reabrir informe</button><button className="text-button danger" type="button" disabled={saving} onClick={() => setReportAction({ kind: "delete", reason: "" })}>Eliminar informe</button></>}
            </div>
          </footer>
        </div>
      </section>} viewer={appointment.serviceCategory === "imaging" ? <section className="viewer-pane" aria-label="Visor de imágenes">{fullScreen ? <iframe ref={viewerRef} src={fullScreen} title="Visor OHIF" allow="fullscreen" /> : <p className="empty-state">Este estudio aún no tiene imágenes vinculadas en el PACS.</p>}</section> : undefined} />

    {reportAction && <div className="appointment-info-backdrop" role="dialog" aria-modal="true" aria-label={reportAction.kind === "reopen" ? "Reabrir reporte" : "Eliminar reporte"} onClick={(event) => { if (event.target === event.currentTarget) setReportAction(null); }}>
      <form className="appointment-info status-change-dialog" onSubmit={(event) => { event.preventDefault(); const reason = reportAction.reason.trim(); if (!reason) return; reportAction.kind === "reopen" ? reopen(reason) : removeReport(reason); }}>
        <div className="card-heading"><div><p className="eyebrow">Auditoría clínica</p><h3>{reportAction.kind === "reopen" ? "Reabrir reporte" : "Eliminar reporte"}</h3></div><button className="text-button" type="button" onClick={() => setReportAction(null)}>Cerrar ✕</button></div>
        <p>{reportAction.kind === "reopen" ? "El reporte volverá a borrador para corregirse." : "Eliminar el reporte es irreversible; las adendas e imágenes clave asociadas se eliminan."}</p>
        <label>Motivo<textarea autoFocus required value={reportAction.reason} onChange={(event) => setReportAction({ ...reportAction, reason: event.target.value })} /></label>
        <div className="form-actions"><button className="button primary" type="submit" disabled={!reportAction.reason.trim() || saving}>{reportAction.kind === "reopen" ? "Reabrir" : "Eliminar"}</button><button className="button secondary" type="button" onClick={() => setReportAction(null)}>Cancelar</button></div>
      </form>
    </div>}

    <div className="print-sheet" aria-hidden="true">
      <header>{tenant?.logoUrl && <img src={tenant.logoUrl} alt="" />}<div><h1>{tenant?.name ?? profile.title}</h1><p>{[tenant?.rut && `RUT ${tenant.rut}`, tenant?.address, tenant?.phone].filter(Boolean).join(" · ")}</p></div></header>
      <h2>{profile.title}</h2>
      {tenant?.reportHeader
        ? renderHeader(tenant.reportHeader, { paciente: appointment.patientName, id: appointment.patientIdentifier || "—", medico: appointment.treatingPhysician || appointment.requesterName || "—", examen: examLabel, fecha: appointment.date, institucion: tenant.name }).split("\n").map((line, index) => <p key={index}>{line}</p>)
        : <><p><strong>Paciente:</strong> {appointment.patientName} · <strong>ID:</strong> {appointment.patientIdentifier || "—"}</p><p><strong>Prestación:</strong> {examLabel} · <strong>Fecha:</strong> {appointment.date}</p></>}
      {report.criticalFinding && <p><strong>⚠ HALLAZGO CRÍTICO{report.criticalFindingType && `: ${report.criticalFindingType}`}</strong>{acknowledgedCommunication && <> · Comunicado a {acknowledgedCommunication.recipient} por {channelLabels[acknowledgedCommunication.channel]}, {new Date(acknowledgedCommunication.communicatedAt).toLocaleString("es-CL")}.</>}</p>}
      {sections.map((section) => report[section.name] && <section key={section.name}><h3>{section.label}</h3><p>{report[section.name]}</p></section>)}
      {baseKeyImages.length > 0 && <section className="key-images-print"><h3>Imágenes clave</h3><div>
        {baseKeyImages.map((item) => <figure key={item.id}>{keyImageSrc(item) && <img src={keyImageSrc(item)} alt="Imagen clave" />}{item.caption && <figcaption>{item.caption}</figcaption>}</figure>)}
      </div></section>}
      {followUps.length > 0 && <section><h3>Recomendaciones y seguimiento</h3>{followUps.map((item) => <p key={item.id}>{item.recommendation} · Plazo {new Date(`${item.dueDate}T00:00:00`).toLocaleDateString("es-CL")} · {followUpLabels[item.status]}</p>)}</section>}
      {addenda.map((item, index) => <section key={item.id}><h3>Adenda {index + 1}</h3><p>{item.text}</p><p>{signerLabel(item.signer.name, item.signer.registration)} · {new Date(item.signedAt).toLocaleString("es-CL")}</p>
        {keyImages.some((img) => img.addendumId === item.id) && <div className="key-images-print"><div>{keyImages.filter((img) => img.addendumId === item.id).map((img) => <figure key={img.id}>{keyImageSrc(img) && <img src={keyImageSrc(img)} alt="Imagen de adenda" />}{img.caption && <figcaption>{img.caption}</figcaption>}</figure>)}</div></div>}
      </section>)}
      <footer>{signatureImage && <img className="signature-image" src={signatureImage} alt="Firma" />}<p>{report.signer ? signerLabel(report.signer.name, report.signer.registration) : "Informe sin firma"}</p><p>Firmado electrónicamente · {report.signedAt ? new Date(report.signedAt).toLocaleString("es-CL") : ""}</p></footer>
    </div>
  </div>;
}
