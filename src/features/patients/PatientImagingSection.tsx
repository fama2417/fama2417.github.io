"use client";

import type { PatientExam } from "./repository";
import { ExamStatusBadge, ImagesBadge, ReportAvailabilityBadge, formatExamDate, isReportAvailable } from "./exam-status";

export function PatientImagingSection({ exams, canEditReports }: { exams: PatientExam[]; canEditReports: boolean }) {
  if (!exams.length) return <p className="empty-state">Sin estudios de imagenología registrados.</p>;
  return (
    <section className="imaging-grid" aria-label="Estudios de imagenología">
      {exams.map((exam) => (
        <article className="card imaging-card" key={exam.id}>
          <header>
            <strong className="imaging-modality">{exam.modality}</strong>
            <ExamStatusBadge status={exam.status} />
          </header>
          <h4>{exam.reason}</h4>
          <p className="imaging-when">{formatExamDate(exam.date)}{exam.time && ` · ${exam.time} h`}</p>
          <div className="badge-row">
            <ImagesBadge hasImages={exam.hasImages} />
            <ReportAvailabilityBadge exam={exam} />
          </div>
          {(exam.anamnesis || exam.diagnosticHypothesis || exam.practitioner) && (
            <dl className="imaging-clinical">
              {exam.anamnesis && <div><dt>Anamnesis</dt><dd>{exam.anamnesis}</dd></div>}
              {exam.diagnosticHypothesis && <div><dt>Hipótesis diagnóstica</dt><dd>{exam.diagnosticHypothesis}</dd></div>}
              {exam.practitioner && <div><dt>Profesional</dt><dd>{exam.practitioner}</dd></div>}
            </dl>
          )}
          {/* TODO: si algún día existe un visor standalone, separar la acción "ver imágenes" del informe; hoy el visor OHIF vive embebido en /informe */}
          {isReportAvailable(exam, canEditReports) && <a className="text-button" href={`/informe/${exam.id}`}>{exam.hasImages ? "Ver informe e imágenes →" : "Ver informe →"}</a>}
        </article>
      ))}
    </section>
  );
}
