"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-client";
import type { Patient } from "./types";
import { PatientClinicalHeader } from "./PatientClinicalHeader";
import { PatientEditDialog } from "./PatientEditDialog";
import { PatientAccountSection } from "./PatientAccountSection";
import { PatientClinicalSummaryCards } from "./PatientClinicalSummaryCards";
import { PatientClinicalTimeline } from "./PatientClinicalTimeline";
import { PatientImagingSection } from "./PatientImagingSection";
import { PatientFollowUpsSection } from "./PatientFollowUpsSection";
import { PatientCriticalCommunicationsSection } from "./PatientCriticalCommunicationsSection";
import { PatientKeyImagesSection } from "./PatientKeyImagesSection";
import { PatientReportAddendaSection } from "./PatientReportAddendaSection";
import { PatientStructuredFindingsSection } from "./PatientStructuredFindingsSection";
import { PatientLabTrendsSection } from "./PatientLabTrendsSection";
import { countOpenCommunications, countPendingFollowUps } from "./exam-summary";
import { isReportAvailable } from "./exam-status";
import { dedupeFindings, visibleFindings } from "./finding-display";
import {
  fetchPatient, fetchPatientAcceptedDocuments, fetchPatientAudit, fetchPatientCriticalCommunications, fetchPatientDocumentRequests, fetchPatientExams, fetchPatientFollowUps,
  fetchPatientKeyImages, fetchPatientLabObservations, fetchPatientReportAddenda, fetchPatientSharedDocuments, fetchPatientStructuredFindings, requestPatientDocuments, reviewPatientDocument,
  type PatientAuditEntry, type PatientCriticalCommunication, type PatientExam, type PatientFollowUp,
  type PatientAcceptedDocument, type PatientDocumentRequest, type PatientKeyImage, type PatientLabObservation, type PatientReportAddendum, type PatientSharedDocument, type PatientStructuredFinding,
} from "./repository";

const actionLabels: Record<string, string> = { INSERT: "Creación", UPDATE: "Modificación", DELETE: "Eliminación" };
const fieldLabels: Record<string, string> = {
  identifier: "Identificador", full_name: "Nombre", birth_date: "Fecha de nacimiento", sex: "Sexo", phone: "Teléfono",
  identifier_type: "Tipo de identificador",
  email: "Correo", address: "Dirección", comuna: "Comuna", prevision: "Previsión", allergies: "Alergias",
  morbid_history: "Antecedentes mórbidos", privacy_consent_at: "Consentimiento",
};

function describeChange(entry: PatientAuditEntry) {
  if (entry.action === "INSERT") return "Creación del registro del paciente.";
  if (entry.action === "DELETE") return "Eliminación del registro.";
  const changes = Object.entries(entry.details ?? {}).filter(([key]) => fieldLabels[key]);
  if (!changes.length) return "Actualización sin cambios en datos personales.";
  return changes.map(([key, value]) => `${fieldLabels[key]}: ${value === null || value === "" ? "—" : String(value)}`).join(" · ");
}

type TabId = "resumen" | "timeline" | "imagenologia" | "seguimientos" | "comunicaciones" | "informes" | "documentos" | "hallazgos" | "laboratorio" | "auditoria";

const sharedDocumentTypeLabels: Record<PatientSharedDocument["documentType"], string> = {
  imaging: "Imagenología", laboratory: "Laboratorio", prescription: "Receta u orden", other: "Otro",
};

export function PatientHistory({ patientId }: { patientId: string }) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [exams, setExams] = useState<PatientExam[]>([]);
  const [followUps, setFollowUps] = useState<PatientFollowUp[]>([]);
  const [communications, setCommunications] = useState<PatientCriticalCommunication[]>([]);
  const [keyImages, setKeyImages] = useState<PatientKeyImage[]>([]);
  const [addenda, setAddenda] = useState<PatientReportAddendum[]>([]);
  const [findings, setFindings] = useState<PatientStructuredFinding[]>([]);
  const [labs, setLabs] = useState<PatientLabObservation[]>([]);
  const [sharedDocuments, setSharedDocuments] = useState<PatientSharedDocument[]>([]);
  const [acceptedDocuments, setAcceptedDocuments] = useState<PatientAcceptedDocument[]>([]);
  const [documentRequests, setDocumentRequests] = useState<PatientDocumentRequest[]>([]);
  const [requestMessage, setRequestMessage] = useState("Solicitamos antecedentes externos relevantes para complementar tu atención.");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [documentBusy, setDocumentBusy] = useState("");
  const [documentNotice, setDocumentNotice] = useState("");
  const [role, setRole] = useState("");
  const [audit, setAudit] = useState<PatientAuditEntry[]>([]);
  const [tab, setTab] = useState<TabId>("resumen");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetchPatient(patientId), fetchPatientExams(patientId), fetchPatientFollowUps(patientId), fetchPatientCriticalCommunications(patientId),
      fetchPatientKeyImages(patientId), fetchPatientReportAddenda(patientId), fetchPatientStructuredFindings(patientId), fetchPatientLabObservations(patientId),
      fetchPatientSharedDocuments(patientId), fetchPatientAcceptedDocuments(patientId), fetchPatientDocumentRequests(patientId), supabase.auth.getUser(),
    ])
      .then(async ([nextPatient, nextExams, nextFollowUps, nextCommunications, nextKeyImages, nextAddenda, nextFindings, nextLabs, nextSharedDocuments, nextAcceptedDocuments, nextDocumentRequests, auth]) => {
        setPatient(nextPatient); setExams(nextExams); setFollowUps(nextFollowUps); setCommunications(nextCommunications);
        setKeyImages(nextKeyImages); setAddenda(nextAddenda); setFindings(nextFindings); setLabs(nextLabs); setSharedDocuments(nextSharedDocuments); setAcceptedDocuments(nextAcceptedDocuments); setDocumentRequests(nextDocumentRequests);
        const profile = await supabase.from("profiles").select("role").eq("id", auth.data.user?.id ?? "").single();
        const nextRole = profile.data?.role ?? "";
        setRole(nextRole);
        if (nextRole === "admin") fetchPatientAudit(patientId).then(setAudit).catch(() => undefined);
      })
      .catch(() => setError("No fue posible cargar la ficha del paciente."));
  }, [patientId]);

  if (error) return <p className="notice" role="alert">{error}</p>;
  if (!patient) return <p className="empty-state">Cargando ficha…</p>;
  const canEditReports = role === "admin" || role === "radiologist";
  const pendingFollowUps = countPendingFollowUps(followUps);
  const openCommunications = countOpenCommunications(communications);
  // Único punto de filtrado por rol: las imágenes clave de informes no accesibles no se exponen (ni en conteos).
  const visibleKeyImages = keyImages.filter((image) => isReportAvailable(image.exam, canEditReports));
  // Hallazgos: filtro por rol + dedupe una sola vez; alimenta sección y conteo del Resumen.
  const displayFindings = dedupeFindings(visibleFindings(findings, canEditReports));
  // Laboratorio no depende de un informe: el repositorio ya entrega solo resultados confirmados.
  const visibleLabs = labs;
  const canReviewDocuments = ["admin", "radiologist", "clinician"].includes(role);
  const pendingDocumentRequest = documentRequests.find((request) => request.status === "pending");

  async function refreshDocumentWorkspace() {
    const [shared, accepted, requests] = await Promise.all([fetchPatientSharedDocuments(patientId), fetchPatientAcceptedDocuments(patientId), fetchPatientDocumentRequests(patientId)]);
    setSharedDocuments(shared); setAcceptedDocuments(accepted); setDocumentRequests(requests);
  }

  async function sendDocumentRequest() {
    if (documentBusy) return;
    setDocumentBusy("request"); setDocumentNotice("");
    try { await requestPatientDocuments(patientId, requestMessage); await refreshDocumentWorkspace(); setDocumentNotice("Solicitud enviada al portal del paciente."); }
    catch (cause) { setDocumentNotice(cause instanceof Error ? cause.message : "No fue posible enviar la solicitud."); }
    finally { setDocumentBusy(""); }
  }

  async function reviewDocument(documentId: string, status: "accepted" | "rejected") {
    if (documentBusy) return;
    setDocumentBusy(documentId); setDocumentNotice("");
    try { await reviewPatientDocument(patientId, documentId, status, reviewNotes[documentId] ?? ""); await refreshDocumentWorkspace(); setDocumentNotice(status === "accepted" ? "Documento incorporado como copia clínica trazable." : "Documento marcado como no incorporado."); }
    catch (cause) { setDocumentNotice(cause instanceof Error ? cause.message : "No fue posible registrar la revisión."); }
    finally { setDocumentBusy(""); }
  }
  const tabs: [TabId, string][] = [
    ["resumen", "Resumen"],
    ["timeline", "Timeline"],
    ["imagenologia", "Imagenología"],
    ["seguimientos", pendingFollowUps ? `Seguimientos (${pendingFollowUps})` : "Seguimientos"],
    ["comunicaciones", openCommunications ? `Comunicaciones críticas (${openCommunications})` : "Comunicaciones críticas"],
    ["informes", "Informes"],
    ["documentos", sharedDocuments.length ? `Documentos externos (${sharedDocuments.length})` : "Documentos externos"],
    ["hallazgos", "Hallazgos"],
    ...(visibleLabs.length ? [["laboratorio", "Laboratorio"] as [TabId, string]] : []),
    ...(role === "admin" ? [["auditoria", "Auditoría"] as [TabId, string]] : []),
  ];

  return <div className="patient-workspace">
    <PatientClinicalHeader patient={patient} onEdit={role === "admin" ? () => setEditing(true) : undefined} />
    {editing && role === "admin" && <PatientEditDialog patient={patient} onClose={() => setEditing(false)} onSaved={(updated) => { setPatient(updated); setEditing(false); }} />}
    {role === "admin" && <PatientAccountSection patient={patient} onChanged={(userId) => setPatient((current) => current ? { ...current, userId } : current)} />}
    {openCommunications > 0 && (
      <div className="critical-banner" role="alert">
        <strong>{openCommunications === 1 ? "1 comunicación crítica sin acuse de recibo." : `${openCommunications} comunicaciones críticas sin acuse de recibo.`}</strong>
        <button className="text-button" type="button" onClick={() => setTab("comunicaciones")}>Revisar →</button>
      </div>
    )}
    <nav className="tab-nav" role="tablist" aria-label="Secciones de la ficha">
      {tabs.map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "tab-button active" : "tab-button"} onClick={() => setTab(id)}>{label}</button>
      ))}
    </nav>
    {tab === "resumen" && <>
      <PatientClinicalSummaryCards exams={exams} followUps={followUps} communications={communications} keyImages={visibleKeyImages} addenda={addenda} findings={displayFindings} />
      <div className="dashboard-grid">
        <section className="card dashboard-block" aria-label="Timeline clínico reciente">
          <h3>Timeline clínico</h3>
          <PatientClinicalTimeline exams={exams} canEditReports={canEditReports} limit={4} onViewAll={() => setTab("timeline")} />
        </section>
        <div className="dashboard-side">
          <section className="card dashboard-block" aria-label="Seguimientos pendientes">
            <h3>Seguimientos pendientes</h3>
            <PatientFollowUpsSection followUps={followUps} canEditReports={canEditReports} limit={3} onViewAll={() => setTab("seguimientos")} />
          </section>
          <section className="card dashboard-block" aria-label="Comunicaciones críticas recientes">
            <h3>Comunicaciones críticas</h3>
            <PatientCriticalCommunicationsSection communications={communications} canEditReports={canEditReports} limit={2} onViewAll={() => setTab("comunicaciones")} />
          </section>
        </div>
      </div>
      <div className="dashboard-lower">
        <section className="card dashboard-block" aria-label="Informes y documentos">
          <h3>Informes y documentos</h3>
          <PatientKeyImagesSection keyImages={visibleKeyImages} canEditReports={canEditReports} limit={2} onViewAll={() => setTab("informes")} />
          <PatientReportAddendaSection addenda={addenda} canEditReports={canEditReports} limit={1} onViewAll={() => setTab("informes")} />
        </section>
        <section className="card dashboard-block" aria-label="Hallazgos estructurados recientes">
          <h3>Hallazgos estructurados</h3>
          <PatientStructuredFindingsSection findings={displayFindings} totalCount={findings.length} canEditReports={canEditReports} limit={3} onViewAll={() => setTab("hallazgos")} />
        </section>
      </div>
    </>}
    {tab === "timeline" && <PatientClinicalTimeline exams={exams} canEditReports={canEditReports} />}
    {tab === "imagenologia" && <PatientImagingSection exams={exams} canEditReports={canEditReports} />}
    {tab === "seguimientos" && <PatientFollowUpsSection followUps={followUps} canEditReports={canEditReports} />}
    {tab === "comunicaciones" && <PatientCriticalCommunicationsSection communications={communications} canEditReports={canEditReports} />}
    {tab === "informes" && <>
      <section className="report-docs-block">
        <h3>Imágenes clave</h3>
        <PatientKeyImagesSection keyImages={visibleKeyImages} canEditReports={canEditReports} />
      </section>
      <section className="report-docs-block">
        <h3>Addenda</h3>
        <PatientReportAddendaSection addenda={addenda} canEditReports={canEditReports} />
      </section>
    </>}
    {tab === "documentos" && (
      <section className="card external-documents" aria-label="Documentos externos compartidos por el paciente">
        <div className="card-heading"><div><h3>Documentos externos compartidos</h3><p className="empty-inline">Archivos aportados por el paciente. No son parte de la ficha hasta que un profesional los incorpore.</p></div></div>
        {canReviewDocuments && !pendingDocumentRequest && <div className="document-request-box"><label>Mensaje al paciente<textarea value={requestMessage} maxLength={500} onChange={(event) => setRequestMessage(event.target.value)} /></label><button className="button secondary" type="button" disabled={!!documentBusy} onClick={sendDocumentRequest}>{documentBusy === "request" ? "Enviando…" : "Solicitar antecedentes"}</button></div>}
        {pendingDocumentRequest && <p className="form-notice">Solicitud pendiente desde el {new Date(pendingDocumentRequest.createdAt).toLocaleDateString("es-CL")}: {pendingDocumentRequest.message}</p>}
        {documentNotice && <p className="form-notice" role="status">{documentNotice}</p>}
        {!sharedDocuments.length && <p className="empty-state">El paciente no ha compartido documentos con esta institución.</p>}
        <div className="external-document-list">
          {sharedDocuments.map((document) => <article className="external-document" key={document.id}>
            <div>
              <strong>{document.filename}</strong>
              <span>{document.sourceInstitution || "Origen no indicado"} · {sharedDocumentTypeLabels[document.documentType]}{document.documentDate && ` · ${new Date(`${document.documentDate}T00:00:00`).toLocaleDateString("es-CL")}`}</span>
              <span>Subido por el paciente · no verificado · compartido el {new Date(document.sharedAt).toLocaleDateString("es-CL")}</span>
              {document.reviewStatus && <span className={`status ${document.reviewStatus === "accepted" ? "status-completed" : "status-cancelled"}`}>{document.reviewStatus === "accepted" ? "Incorporado a la ficha" : "No incorporado"}</span>}
              {canReviewDocuments && document.reviewStatus !== "accepted" && <label className="review-note">Nota de revisión<textarea value={reviewNotes[document.id] ?? ""} maxLength={1000} onChange={(event) => setReviewNotes((current) => ({ ...current, [document.id]: event.target.value }))} /></label>}
            </div>
            <div className="document-review-actions"><a className="button secondary" href={document.url} target="_blank" rel="noreferrer">Abrir original</a>{canReviewDocuments && document.reviewStatus !== "accepted" && <><button className="button primary" type="button" disabled={!!documentBusy} onClick={() => reviewDocument(document.id, "accepted")}>{documentBusy === document.id ? "Guardando…" : "Incorporar a ficha"}</button><button className="text-button danger-text" type="button" disabled={!!documentBusy} onClick={() => reviewDocument(document.id, "rejected")}>No incorporar</button></>}</div>
          </article>)}
        </div>
        <div className="accepted-documents"><h3>Copias clínicas incorporadas</h3>{!acceptedDocuments.length && <p className="empty-inline">Aún no se han incorporado documentos externos.</p>}{acceptedDocuments.map((document) => <article className="external-document accepted" key={document.id}><div><strong>{document.filename}</strong><span>{document.sourceInstitution} · incorporado el {new Date(document.acceptedAt).toLocaleDateString("es-CL")} por {document.reviewerName}</span>{document.note && <span>Nota: {document.note}</span>}</div><a className="button secondary" href={document.url} target="_blank" rel="noreferrer">Abrir copia clínica</a></article>)}</div>
      </section>
    )}
    {tab === "hallazgos" && <PatientStructuredFindingsSection findings={displayFindings} totalCount={findings.length} canEditReports={canEditReports} />}
    {tab === "laboratorio" && <section className="card" aria-label="Resultados de laboratorio"><h3>Resultados de laboratorio</h3><PatientLabTrendsSection observations={visibleLabs} /></section>}
    {tab === "auditoria" && role === "admin" && (
      <section className="card audit-list" aria-label="Trazabilidad del paciente">
        <h3>Trazabilidad</h3>
        <p className="empty-inline">Registro administrativo de cambios sobre los datos del paciente (Ley 19.628/21.719).</p>
        {audit.map((entry) => <div className="workflow-entry" key={entry.id}><strong>{actionLabels[entry.action] ?? entry.action}</strong><span>{new Date(entry.changedAt).toLocaleString("es-CL")} · {entry.actorName}</span><span>{describeChange(entry)}</span></div>)}
        {!audit.length && <p className="empty-inline">Sin eventos registrados.</p>}
      </section>
    )}
  </div>;
}
