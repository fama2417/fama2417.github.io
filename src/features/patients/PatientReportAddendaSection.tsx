"use client";

import type { PatientReportAddendum } from "./repository";
import { formatExamDate, isReportAvailable } from "./exam-status";

export function PatientReportAddendaSection({ addenda, canEditReports, limit, onViewAll }: { addenda: PatientReportAddendum[]; canEditReports: boolean; limit?: number; onViewAll?: () => void }) {
  const shown = limit ? addenda.slice(0, limit) : addenda;
  if (!shown.length) return <p className="empty-state">Sin addenda registrados para este paciente.</p>;
  return <>
    <section className="imaging-grid" aria-label="Addenda de informes">
      {shown.map((addendum) => (
        <article className="card imaging-card" key={addendum.id}>
          <header>
            <strong className="imaging-modality">Adenda</strong>
            <span className="status status-completed">Firmada</span>
          </header>
          <p className="imaging-when">{new Date(addendum.signedAt).toLocaleString("es-CL")}{addendum.signerName && ` · ${addendum.signerName}`}{addendum.signerRegistration && ` (${addendum.signerRegistration})`}</p>
          <p>{addendum.text}</p>
          <dl className="imaging-clinical">
            <div><dt>Examen asociado</dt><dd>{addendum.exam.modality} · {addendum.exam.reason} · {formatExamDate(addendum.exam.date)}{addendum.exam.time && ` · ${addendum.exam.time} h`}</dd></div>
          </dl>
          {isReportAvailable(addendum.exam, canEditReports) && <a className="text-button" href={`/informe/${addendum.exam.id}`}>Ver informe →</a>}
        </article>
      ))}
    </section>
    {onViewAll && <button className="text-button" type="button" onClick={onViewAll}>Ver todos →</button>}
  </>;
}
