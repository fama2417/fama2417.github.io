"use client";

import type { PatientFollowUp } from "./repository";
import { followUpDisplayStatus } from "./exam-summary";
import { formatExamDate, isReportAvailable } from "./exam-status";

const followUpStatusLabels: Record<string, string> = { pending: "Pendiente", acknowledged: "Reconocido", completed: "Completado", overdue: "Vencido" };
const followUpStatusClass: Record<string, string> = { pending: "status-in_progress", acknowledged: "status-scheduled", completed: "status-completed", overdue: "status-cancelled" };

export function PatientFollowUpsSection({ followUps, canEditReports, limit, onViewAll }: { followUps: PatientFollowUp[]; canEditReports: boolean; limit?: number; onViewAll?: () => void }) {
  // Modo compacto (dashboard): solo lo no completado, acotado.
  const shown = limit ? followUps.filter((followUp) => followUpDisplayStatus(followUp) !== "completed").slice(0, limit) : followUps;
  if (!shown.length) return <p className="empty-state">{limit ? "Sin seguimientos pendientes." : "Sin seguimientos registrados para este paciente."}</p>;
  return <>
    <section className="imaging-grid" aria-label="Seguimientos recomendados">
      {shown.map((followUp) => {
        const displayStatus = followUpDisplayStatus(followUp);
        return (
          <article className="card imaging-card" key={followUp.id}>
            <header>
              <strong className="imaging-modality">Seguimiento</strong>
              <span className={`status ${followUpStatusClass[displayStatus] ?? "status-muted"}`}>{followUpStatusLabels[displayStatus] ?? displayStatus}</span>
            </header>
            <h4>{followUp.recommendation}</h4>
            <p className="imaging-when">Fecha límite: {formatExamDate(followUp.dueDate)} · Responsable: {followUp.responsible}</p>
            <dl className="imaging-clinical">
              <div><dt>Examen asociado</dt><dd>{followUp.exam.modality} · {followUp.exam.reason} · {formatExamDate(followUp.exam.date)}{followUp.exam.time && ` · ${followUp.exam.time} h`}</dd></div>
              <div><dt>Registrado</dt><dd>{new Date(followUp.createdAt).toLocaleDateString("es-CL")}</dd></div>
            </dl>
            {isReportAvailable(followUp.exam, canEditReports) && <a className="text-button" href={`/informe/${followUp.exam.id}`}>Ver informe →</a>}
          </article>
        );
      })}
    </section>
    {onViewAll && <button className="text-button" type="button" onClick={onViewAll}>Ver todos →</button>}
  </>;
}
