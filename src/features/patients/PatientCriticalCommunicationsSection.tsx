"use client";

import type { PatientCriticalCommunication } from "./repository";
import { formatExamDate, isReportAvailable } from "./exam-status";

const urgencyLabels: Record<string, string> = { critical: "Crítico", urgent: "Urgente", unexpected: "Inesperado" };
const urgencyClass: Record<string, string> = { critical: "status-cancelled", urgent: "status-in_progress", unexpected: "status-scheduled" };
const channelLabels: Record<string, string> = { phone: "Teléfono", in_person: "Presencial", secure_message: "Mensaje seguro", email: "Correo", other: "Otro" };

export function PatientCriticalCommunicationsSection({ communications, canEditReports, limit, onViewAll }: { communications: PatientCriticalCommunication[]; canEditReports: boolean; limit?: number; onViewAll?: () => void }) {
  // Modo compacto (dashboard): prioriza las sin acuse de recibo.
  const shown = limit ? [...communications].sort((a, b) => Number(a.acknowledged) - Number(b.acknowledged)).slice(0, limit) : communications;
  if (!shown.length) return <p className="empty-state">Sin comunicaciones críticas registradas.</p>;
  return <>
    <section className="imaging-grid" aria-label="Comunicaciones de hallazgos críticos">
      {shown.map((communication) => (
        <article className={communication.acknowledged ? "card imaging-card" : "card imaging-card comm-open"} key={communication.id}>
          <header>
            <span className={`status ${urgencyClass[communication.urgency] ?? "status-muted"}`}>{urgencyLabels[communication.urgency] ?? communication.urgency}</span>
            <span className={communication.acknowledged ? "status status-completed" : "status status-cancelled"}>{communication.acknowledged ? "Con acuse de recibo" : "Sin acuse de recibo"}</span>
          </header>
          <h4>{new Date(communication.communicatedAt).toLocaleString("es-CL")} · {channelLabels[communication.channel] ?? communication.channel}</h4>
          <p className="imaging-when">Comunicado a: {communication.recipient}</p>
          {communication.notes && <p>{communication.notes}</p>}
          <dl className="imaging-clinical">
            <div><dt>Examen asociado</dt><dd>{communication.exam.modality} · {communication.exam.reason} · {formatExamDate(communication.exam.date)}{communication.exam.time && ` · ${communication.exam.time} h`}</dd></div>
          </dl>
          {isReportAvailable(communication.exam, canEditReports) && <a className="text-button" href={`/informe/${communication.exam.id}`}>Ver informe →</a>}
        </article>
      ))}
    </section>
    {onViewAll && <button className="text-button" type="button" onClick={onViewAll}>Ver todas →</button>}
  </>;
}
