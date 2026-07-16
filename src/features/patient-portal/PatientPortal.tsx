"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase-client";
import { identifierTypeLabels, sexLabels, type Patient } from "@/features/patients/types";
import {
  deletePatientDocument, downloadFhirBundle, fetchCurrentPatients, fetchPatientAppointments, fetchPatientDocumentRequests, fetchPatientDocuments, fetchReleasedAddenda, fetchReleasedKeyImages, fetchReleasedReports,
  respondToDocumentRequest, setPatientDocumentShare, uploadPatientDocument,
  type PortalAddendum, type PortalAppointment, type PortalDocument, type PortalDocumentRequest, type PortalKeyImage, type PortalPatient, type PortalReport,
} from "./repository";

const statusLabels: Record<string, string> = {
  scheduled: "Agendada", confirmed: "Confirmada", arrived: "En recepción", in_progress: "En curso",
  completed: "Realizada", cancelled: "Cancelada", no_show: "No asistió",
};
const statusClass: Record<string, string> = {
  scheduled: "status-scheduled", confirmed: "status-scheduled", arrived: "status-in_progress", in_progress: "status-in_progress",
  completed: "status-completed", cancelled: "status-cancelled", no_show: "status-cancelled",
};

const tabs = [
  ["inicio", "Inicio"], ["citas", "Mis citas"], ["examenes", "Mis exámenes"], ["informes", "Mis informes"], ["documentos", "Mis documentos"], ["informacion", "Mi información"],
] as const;
type TabId = (typeof tabs)[number][0];

const reportSections: [keyof PortalReport, string][] = [
  ["clinicalIndication", "Indicación"], ["technique", "Técnica"], ["comparison", "Comparación"], ["findings", "Hallazgos"], ["impression", "Impresión"],
];
const documentTypeLabels: Record<PortalDocument["documentType"], string> = {
  imaging: "Radiología / imagenología", laboratory: "Laboratorio", prescription: "Receta u orden", other: "Otro",
};

function formatDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
}

function isUpcoming(appointment: PortalAppointment) {
  return appointment.date >= new Date().toISOString().slice(0, 10) && !["cancelled", "no_show", "completed"].includes(appointment.status);
}

export function PatientPortal() {
  const [ready, setReady] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const [patients, setPatients] = useState<PortalPatient[]>([]);
  const [appointments, setAppointments] = useState<PortalAppointment[]>([]);
  const [reports, setReports] = useState<PortalReport[]>([]);
  const [addenda, setAddenda] = useState<PortalAddendum[]>([]);
  const [keyImages, setKeyImages] = useState<PortalKeyImage[]>([]);
  const [documents, setDocuments] = useState<PortalDocument[]>([]);
  const [documentRequests, setDocumentRequests] = useState<PortalDocumentRequest[]>([]);
  const [requestSelections, setRequestSelections] = useState<Record<string, string[]>>({});
  const [tab, setTab] = useState<TabId>("inicio");
  const [openReport, setOpenReport] = useState("");
  const [error, setError] = useState("");
  const [documentBusy, setDocumentBusy] = useState(false);
  const [documentActionBusy, setDocumentActionBusy] = useState("");
  const [documentNotice, setDocumentNotice] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const auth = await supabase.auth.getUser();
        if (!auth.data.user) return;
        // El portal es exclusivo de pacientes: una cuenta staff no debe consultar datos aquí.
        const profile = await supabase.from("profiles").select("id").eq("id", auth.data.user.id).maybeSingle();
        if (profile.data) { setIsStaff(true); return; }
        const [nextPatients, nextAppointments, nextReports, nextAddenda, nextKeyImages, nextDocuments, nextRequests] = await Promise.all([
          fetchCurrentPatients(), fetchPatientAppointments(), fetchReleasedReports(), fetchReleasedAddenda(), fetchReleasedKeyImages(), fetchPatientDocuments(), fetchPatientDocumentRequests(),
        ]);
        setPatients(nextPatients); setAppointments(nextAppointments); setReports(nextReports); setAddenda(nextAddenda); setKeyImages(nextKeyImages); setDocuments(nextDocuments); setDocumentRequests(nextRequests);
      } catch {
        setError("No fue posible cargar tu información. Intenta nuevamente.");
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const upcoming = useMemo(() => appointments.filter(isUpcoming).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)), [appointments]);
  const performed = useMemo(() => appointments.filter((item) => item.status === "completed"), [appointments]);
  const lastVisit = performed[0];
  const patient = patients[0] ?? null;

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (documentBusy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const file = fields.get("file");
    if (!(file instanceof File) || !file.name) return;
    setDocumentBusy(true); setError(""); setDocumentNotice("");
    try {
      await uploadPatientDocument({
        file, documentDate: String(fields.get("documentDate") ?? ""),
        documentType: String(fields.get("documentType") ?? "other") as PortalDocument["documentType"],
        sourceInstitution: String(fields.get("sourceInstitution") ?? ""),
      });
      setDocuments(await fetchPatientDocuments());
      form.reset();
      setDocumentNotice("Documento guardado en tu registro personal. No fue incorporado a la ficha oficial de ninguna institución.");
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "No fue posible subir el documento.");
    } finally {
      setDocumentBusy(false);
    }
  }

  async function changeDocumentShare(documentId: string, patientId: string, shared: boolean) {
    const action = `${documentId}:${patientId}`;
    if (documentActionBusy) return;
    setDocumentActionBusy(action); setError(""); setDocumentNotice("");
    try {
      await setPatientDocumentShare(documentId, patientId, shared);
      setDocuments(await fetchPatientDocuments());
      setDocumentNotice(shared ? "Acceso concedido a la institución seleccionada." : "Acceso revocado. La institución ya no puede abrir el documento.");
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "No fue posible cambiar el acceso.");
    } finally {
      setDocumentActionBusy("");
    }
  }

  async function removeDocument(documentId: string, filename: string) {
    if (documentActionBusy || !window.confirm(`¿Eliminar ${filename}? Esta acción también revoca todos sus accesos.`)) return;
    setDocumentActionBusy(documentId); setError(""); setDocumentNotice("");
    try {
      await deletePatientDocument(documentId);
      setDocuments(await fetchPatientDocuments());
      setDocumentNotice("Documento eliminado de tu registro personal.");
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "No fue posible eliminar el documento.");
    } finally {
      setDocumentActionBusy("");
    }
  }

  function toggleRequestDocument(requestId: string, documentId: string) {
    setRequestSelections((current) => ({ ...current, [requestId]: (current[requestId] ?? []).includes(documentId) ? (current[requestId] ?? []).filter((id) => id !== documentId) : [...(current[requestId] ?? []), documentId] }));
  }

  async function answerDocumentRequest(requestId: string, status: "approved" | "rejected") {
    if (documentActionBusy) return;
    setDocumentActionBusy(requestId); setError(""); setDocumentNotice("");
    try {
      await respondToDocumentRequest(requestId, status, requestSelections[requestId] ?? []);
      const [nextDocuments, nextRequests] = await Promise.all([fetchPatientDocuments(), fetchPatientDocumentRequests()]);
      setDocuments(nextDocuments); setDocumentRequests(nextRequests);
      setDocumentNotice(status === "approved" ? "Documentos compartidos con tu ficha vinculada." : "Solicitud rechazada.");
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "No fue posible responder la solicitud.");
    } finally { setDocumentActionBusy(""); }
  }

  if (!ready) return <main className="portal-shell"><p className="empty-state">Cargando tu portal…</p></main>;
  if (isStaff) return (
    <main className="portal-shell"><section className="card portal-card">
      <h2>Portal de pacientes</h2>
      <p>Tu cuenta es del equipo clínico: usa la aplicación interna.</p>
      <a className="button primary" href="/">Ir a la aplicación</a>
    </section></main>
  );
  if (!patient) return (
    <main className="portal-shell"><section className="card portal-card">
      <h2>Cuenta no habilitada</h2>
      <p>Tu cuenta no está vinculada a una ficha de paciente. Contacta a la institución.</p>
      <button className="button secondary" type="button" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
    </section></main>
  );

  const firstName = patient.name.split(/\s+/)[0] ?? patient.name;

  return (
    <div className="portal-shell">
      <header className="portal-header">
        <div>
          <p className="eyebrow">Mi salud</p>
          <strong>{patient.name}</strong>
        </div>
        <button className="text-button" type="button" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
      </header>

      <nav className="tab-nav" role="tablist" aria-label="Secciones del portal">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "tab-button active" : "tab-button"} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      {error && <p className="notice" role="alert">{error}</p>}

      {tab === "inicio" && <>
        <section className="card portal-card">
          <h3>Hola, {firstName}</h3>
            <p>Aquí puedes reunir tus atenciones institucionales y los documentos que subas personalmente.</p>
        </section>
        <div className="summary-tiles portal-tiles">
          <div className="card summary-card"><div><strong>{upcoming.length}</strong><span>Próximas citas</span></div></div>
          <div className="card summary-card"><div><strong>{performed.length}</strong><span>Exámenes realizados</span></div></div>
          <div className="card summary-card"><div><strong>{reports.length}</strong><span>Informes disponibles</span></div></div>
          <div className="card summary-card"><div><strong>{lastVisit ? formatDate(lastVisit.date) : "—"}</strong><span>Última atención</span></div></div>
        </div>
        <section className="card portal-card">
          <h3>Próxima cita</h3>
          {upcoming.length
            ? <p><strong>{formatDate(upcoming[0].date)}{upcoming[0].time && ` · ${upcoming[0].time} h`}</strong> — {upcoming[0].modality} · {upcoming[0].reason}{upcoming[0].location && ` · ${upcoming[0].location}`}</p>
            : <p className="empty-inline">No tienes citas agendadas.</p>}
        </section>
      </>}

      {tab === "citas" && (
        <section className="card portal-card">
          <h3>Mis citas</h3>
          {!upcoming.length && <p className="empty-inline">No tienes citas próximas.</p>}
          <ul className="portal-list">
            {upcoming.map((item) => (
              <li key={item.id}>
                <div><strong>{formatDate(item.date)}{item.time && ` · ${item.time} h`}</strong><span>{item.institution}{item.institution && " · "}{item.modality} · {item.reason}{item.location && ` · ${item.location}`}</span></div>
                <span className={`status ${statusClass[item.status] ?? "status-muted"}`}>{statusLabels[item.status] ?? item.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "examenes" && (
        <section className="card portal-card">
          <h3>Mis exámenes</h3>
          {!appointments.length && <p className="empty-inline">Aún no registras exámenes.</p>}
          <ul className="portal-list">
            {appointments.map((item) => (
              <li key={item.id}>
                <div><strong>{formatDate(item.date)}{item.time && ` · ${item.time} h`}</strong><span>{item.institution}{item.institution && " · "}{item.modality} · {item.reason}</span></div>
                <span className="portal-list-badges">
                  <span className={`status ${statusClass[item.status] ?? "status-muted"}`}>{statusLabels[item.status] ?? item.status}</span>
                  {item.reportAvailable && <button className="text-button" type="button" onClick={() => { setTab("informes"); setOpenReport(item.id); }}>Ver informe</button>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "informes" && <>
        {!reports.length && <section className="card portal-card"><h3>Mis informes</h3><p className="empty-inline">Todavía no hay informes disponibles. La institución los publica cuando están listos.</p></section>}
        {reports.map((report) => {
          const reportAddenda = addenda.filter((item) => item.appointmentId === report.appointmentId);
          const reportImages = keyImages.filter((item) => item.appointmentId === report.appointmentId);
          const open = openReport === report.appointmentId;
          return (
            <section className={open ? "card portal-card portal-report portal-report-open" : "card portal-card portal-report"} key={report.id}>
              <button className="portal-report-head" type="button" aria-expanded={open} onClick={() => setOpenReport(open ? "" : report.appointmentId)}>
                <div><strong>{report.modality} · {report.reason}</strong><span>{report.institution}{report.institution && " · "}{formatDate(report.date)}{report.time && ` · ${report.time} h`} · Publicado el {new Date(report.releasedAt).toLocaleDateString("es-CL")}</span></div>
                <span className="text-button">{open ? "Ocultar" : "Leer informe"}</span>
              </button>
              {open && <div className="portal-report-body">
                {reportSections.map(([field, label]) => report[field] && <section key={field}><h4>{label}</h4><p>{String(report[field])}</p></section>)}
                {reportImages.length > 0 && <section><h4>Imágenes del informe</h4>
                  <div className="portal-image-grid">
                    {reportImages.map((item) => <figure key={item.id}><img src={item.url} alt={item.caption || "Imagen del informe"} loading="lazy" />{item.caption && <figcaption>{item.caption}</figcaption>}</figure>)}
                  </div>
                </section>}
                {reportAddenda.length > 0 && <section><h4>Información adicional</h4>
                  {reportAddenda.map((item) => <p key={item.id}>{item.text}<br /><small>{item.signerName} · {new Date(item.signedAt).toLocaleDateString("es-CL")}</small></p>)}
                </section>}
                <footer>
                  <small>{report.signerName}{report.signerRegistration && ` · ${report.signerRegistration}`}{report.signedAt && ` · Firmado el ${new Date(report.signedAt).toLocaleDateString("es-CL")}`}</small>
                  <button className="text-button" type="button" onClick={() => window.print()}>Imprimir / guardar PDF</button>
                </footer>
              </div>}
            </section>
          );
        })}
      </>}

      {tab === "documentos" && <>
        {documentRequests.map((request) => <section className="card portal-card portal-access-request" key={request.id}>
          <p className="eyebrow">Solicitud de ficha vinculada</p>
          <h3>{request.institution} solicita antecedentes</h3>
          <p>{request.message}</p>
          <p className="empty-inline">Elige exactamente qué documentos podrá consultar esta ficha. Ninguna otra institución recibirá acceso.</p>
          <div className="portal-request-documents">
            {documents.map((document) => <label key={document.id}><input type="checkbox" checked={(requestSelections[request.id] ?? []).includes(document.id)} onChange={() => toggleRequestDocument(request.id, document.id)} /> {document.filename} <span>{document.sourceInstitution}</span></label>)}
          </div>
          {!documents.length && <p className="empty-state">Primero debes subir un documento para responder.</p>}
          <div className="form-actions"><button className="button primary" type="button" disabled={!!documentActionBusy || !documents.length} onClick={() => answerDocumentRequest(request.id, "approved")}>Autorizar seleccionados</button><button className="button secondary" type="button" disabled={!!documentActionBusy} onClick={() => answerDocumentRequest(request.id, "rejected")}>Rechazar</button></div>
        </section>)}
        <section className="card portal-card">
          <h3>Subir documento personal</h3>
          <p>Guarda un resultado externo sin incorporarlo a la ficha oficial de una institución.</p>
          <form className="portal-document-form" onSubmit={uploadDocument}>
            <label>Institución de origen<input name="sourceInstitution" required maxLength={160} placeholder="Ej. RedSalud" /></label>
            <label>Fecha del documento<input name="documentDate" type="date" /></label>
            <label>Tipo<select name="documentType" defaultValue="imaging"><option value="imaging">Informe de radiología / imagenología</option><option value="laboratory">Laboratorio</option><option value="prescription">Receta u orden</option><option value="other">Otro</option></select></label>
            <label className="wide-field">Archivo<input name="file" type="file" required accept="application/pdf,image/jpeg,image/png,application/dicom,.dcm" /></label>
            <button className="button primary" type="submit" disabled={documentBusy}>{documentBusy ? "Subiendo…" : "Guardar documento"}</button>
          </form>
          <p className="empty-inline">PDF, JPG, PNG o una instancia DICOM, hasta 20 MB. El archivo quedará marcado como subido por el paciente.</p>
          {documentNotice && <p className="form-notice" role="status">{documentNotice}</p>}
        </section>
        <section className="card portal-card">
          <div className="card-heading"><div><h3>Mis documentos personales</h3><p>Solo tú puedes verlos hasta que autorices una ficha vinculada.</p></div><button className="button secondary" type="button" onClick={() => downloadFhirBundle().catch(() => setError("No fue posible exportar el registro FHIR."))}>Exportar FHIR</button></div>
          <div className="linked-records"><strong>Fichas vinculadas:</strong> {patients.map((record) => <span className="status status-muted" key={record.id}>{record.institution}</span>)}</div>
          {!documents.length && <p className="empty-inline">Todavía no has subido documentos.</p>}
          <ul className="portal-list">
            {documents.map((document) => <li key={document.id}>
              <div className="portal-document-detail">
                <strong>{document.filename}</strong>
                <span>{document.sourceInstitution || "Origen no indicado"} · {documentTypeLabels[document.documentType]}{document.documentDate && ` · ${formatDate(document.documentDate)}`} · {(document.sizeBytes / 1024 / 1024).toFixed(1)} MB</span>
                <span>Subido por ti · documento externo no verificado</span>
                <div className="portal-document-actions">
                  <a className="text-button" href={document.url} target="_blank" rel="noreferrer">Abrir</a>
                  {patients.map((record) => {
                    const shared = document.sharedPatientIds.includes(record.id);
                    const review = document.reviewByPatientId[record.id];
                    const action = `${document.id}:${record.id}`;
                    return <span className="portal-record-access" key={record.id}>
                      {review && <span className={`status ${review === "accepted" ? "status-completed" : "status-cancelled"}`}>{record.institution}: {review === "accepted" ? "incorporado" : "no incorporado"}</span>}
                      <button className="text-button" type="button" disabled={!!documentActionBusy} onClick={() => changeDocumentShare(document.id, record.id, !shared)}>
                        {documentActionBusy === action ? "Guardando…" : `${shared ? "Quitar acceso a mi ficha en" : "Dar acceso a mi ficha en"} ${record.institution || "institución"}`}
                      </button>
                    </span>;
                  })}
                  <button className="text-button danger-text" type="button" disabled={!!documentActionBusy} onClick={() => removeDocument(document.id, document.filename)}>
                    {documentActionBusy === document.id ? "Eliminando…" : "Eliminar"}
                  </button>
                </div>
              </div>
            </li>)}
          </ul>
        </section>
      </>}

      {tab === "informacion" && (
        <section className="card portal-card">
          <h3>Mis fichas institucionales</h3>
          {patients.map((record) => <div className="portal-patient-record" key={record.id}>
            <h4>{record.institution || "Institución"}</h4>
            <dl className="portal-info">
              <div><dt>Identificación</dt><dd>{identifierTypeLabels[record.identifierType as Patient["identifierType"]] ?? record.identifierType} {record.identifier}</dd></div>
              <div><dt>Fecha de nacimiento</dt><dd>{formatDate(record.birthDate)}</dd></div>
              <div><dt>Sexo registral</dt><dd>{sexLabels[record.sex as Patient["sex"]] ?? record.sex}</dd></div>
              <div><dt>Teléfono</dt><dd>{record.phone || "—"}</dd></div>
              <div><dt>Correo</dt><dd>{record.email || "—"}</dd></div>
              <div><dt>Dirección</dt><dd>{[record.address, record.comuna].filter(Boolean).join(", ") || "—"}</dd></div>
              <div><dt>Previsión</dt><dd>{record.prevision || "—"}</dd></div>
              <div><dt>Alergias</dt><dd>{record.allergies || "Sin registros"}</dd></div>
              <div><dt>Antecedentes</dt><dd>{record.morbidHistory || "Sin registros"}</dd></div>
              <div><dt>Consentimiento</dt><dd>{record.consentAt ? new Date(record.consentAt).toLocaleDateString("es-CL") : "Pendiente"}</dd></div>
            </dl>
          </div>)}
          <p className="empty-inline">Si necesitas corregir estos datos, contacta a la institución.</p>
        </section>
      )}
    </div>
  );
}
