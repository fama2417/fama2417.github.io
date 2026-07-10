"use client";

import type { PatientExam } from "./repository";
import { ExamStatusBadge, ImagesBadge, ReportAvailabilityBadge, formatExamDate, isReportAvailable } from "./exam-status";

export function PatientClinicalTimeline({ exams, canEditReports, limit, onViewAll }: { exams: PatientExam[]; canEditReports: boolean; limit?: number; onViewAll?: () => void }) {
  if (!exams.length) return <p className="empty-state">Sin exámenes registrados.</p>;
  const shown = limit ? exams.slice(0, limit) : exams;
  return <>
    <ol className="clinical-timeline" aria-label="Línea de tiempo clínica">
      {shown.map((exam) => (
        <li key={exam.id}>
          <div className="timeline-when">
            <strong>{formatExamDate(exam.date)}</strong>
            {exam.time && <span>{exam.time} h</span>}
          </div>
          <div className="timeline-event">
            <strong>{exam.modality} · {exam.reason}</strong>
            <div className="badge-row">
              <ExamStatusBadge status={exam.status} />
              <ImagesBadge hasImages={exam.hasImages} />
              <ReportAvailabilityBadge exam={exam} />
            </div>
            {isReportAvailable(exam, canEditReports) && <a className="text-button" href={`/informe/${exam.id}`}>Ver informe →</a>}
          </div>
        </li>
      ))}
    </ol>
    {onViewAll && exams.length > shown.length && <button className="text-button" type="button" onClick={onViewAll}>Ver timeline completo →</button>}
  </>;
}
