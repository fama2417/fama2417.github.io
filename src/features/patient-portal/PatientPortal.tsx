"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase-client";
import { identifierTypeLabels, sexLabels, type Patient } from "@/features/patients/types";
import {
  fetchCurrentPatient, fetchPatientAppointments, fetchReleasedAddenda, fetchReleasedReports,
  type PortalAddendum, type PortalAppointment, type PortalPatient, type PortalReport,
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
  ["inicio", "Inicio"], ["citas", "Mis citas"], ["examenes", "Mis exámenes"], ["informes", "Mis informes"], ["informacion", "Mi información"],
] as const;
type TabId = (typeof tabs)[number][0];

const reportSections: [keyof PortalReport, string][] = [
  ["clinicalIndication", "Indicación"], ["technique", "Técnica"], ["comparison", "Comparación"], ["findings", "Hallazgos"], ["impression", "Impresión"],
];

function formatDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
}

function isUpcoming(appointment: PortalAppointment) {
  return appointment.date >= new Date().toISOString().slice(0, 10) && !["cancelled", "no_show", "completed"].includes(appointment.status);
}

export function PatientPortal() {
  const [ready, setReady] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const [patient, setPatient] = useState<PortalPatient | null>(null);
  const [appointments, setAppointments] = useState<PortalAppointment[]>([]);
  const [reports, setReports] = useState<PortalReport[]>([]);
  const [addenda, setAddenda] = useState<PortalAddendum[]>([]);
  const [tab, setTab] = useState<TabId>("inicio");
  const [openReport, setOpenReport] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const auth = await supabase.auth.getUser();
        if (!auth.data.user) return;
        // El portal es exclusivo de pacientes: una cuenta staff no debe consultar datos aquí.
        const profile = await supabase.from("profiles").select("id").eq("id", auth.data.user.id).maybeSingle();
        if (profile.data) { setIsStaff(true); return; }
        const [nextPatient, nextAppointments, nextReports, nextAddenda] = await Promise.all([
          fetchCurrentPatient(), fetchPatientAppointments(), fetchReleasedReports(), fetchReleasedAddenda(),
        ]);
        setPatient(nextPatient); setAppointments(nextAppointments); setReports(nextReports); setAddenda(nextAddenda);
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
          <p className="eyebrow">Portal de pacientes</p>
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
          <p>Aquí puedes revisar tus citas, exámenes e informes entregados por la institución.</p>
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
                <div><strong>{formatDate(item.date)}{item.time && ` · ${item.time} h`}</strong><span>{item.modality} · {item.reason}{item.location && ` · ${item.location}`}</span></div>
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
                <div><strong>{formatDate(item.date)}{item.time && ` · ${item.time} h`}</strong><span>{item.modality} · {item.reason}</span></div>
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
          const open = openReport === report.appointmentId;
          return (
            <section className="card portal-card portal-report" key={report.id}>
              <button className="portal-report-head" type="button" aria-expanded={open} onClick={() => setOpenReport(open ? "" : report.appointmentId)}>
                <div><strong>{report.modality} · {report.reason}</strong><span>{formatDate(report.date)}{report.time && ` · ${report.time} h`} · Publicado el {new Date(report.releasedAt).toLocaleDateString("es-CL")}</span></div>
                <span className="text-button">{open ? "Ocultar" : "Leer informe"}</span>
              </button>
              {open && <div className="portal-report-body">
                {reportSections.map(([field, label]) => report[field] && <section key={field}><h4>{label}</h4><p>{String(report[field])}</p></section>)}
                {reportAddenda.length > 0 && <section><h4>Información adicional</h4>
                  {reportAddenda.map((item) => <p key={item.id}>{item.text}<br /><small>{item.signerName} · {new Date(item.signedAt).toLocaleDateString("es-CL")}</small></p>)}
                </section>}
                <footer><small>{report.signerName}{report.signerRegistration && ` · ${report.signerRegistration}`}{report.signedAt && ` · Firmado el ${new Date(report.signedAt).toLocaleDateString("es-CL")}`}</small></footer>
              </div>}
            </section>
          );
        })}
      </>}

      {tab === "informacion" && (
        <section className="card portal-card">
          <h3>Mi información</h3>
          <dl className="portal-info">
            <div><dt>Identificación</dt><dd>{identifierTypeLabels[patient.identifierType as Patient["identifierType"]] ?? patient.identifierType} {patient.identifier}</dd></div>
            <div><dt>Fecha de nacimiento</dt><dd>{formatDate(patient.birthDate)}</dd></div>
            <div><dt>Sexo registral</dt><dd>{sexLabels[patient.sex as Patient["sex"]] ?? patient.sex}</dd></div>
            <div><dt>Teléfono</dt><dd>{patient.phone || "—"}</dd></div>
            <div><dt>Correo</dt><dd>{patient.email || "—"}</dd></div>
            <div><dt>Dirección</dt><dd>{[patient.address, patient.comuna].filter(Boolean).join(", ") || "—"}</dd></div>
            <div><dt>Previsión</dt><dd>{patient.prevision || "—"}</dd></div>
            <div><dt>Alergias</dt><dd>{patient.allergies || "Sin registros"}</dd></div>
            <div><dt>Antecedentes</dt><dd>{patient.morbidHistory || "Sin registros"}</dd></div>
            <div><dt>Consentimiento</dt><dd>{patient.consentAt ? new Date(patient.consentAt).toLocaleDateString("es-CL") : "Pendiente"}</dd></div>
          </dl>
          <p className="empty-inline">Si necesitas corregir estos datos, contacta a la institución.</p>
        </section>
      )}
    </div>
  );
}
