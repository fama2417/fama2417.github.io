"use client";

import type { PatientCriticalCommunication, PatientExam, PatientFollowUp, PatientKeyImage, PatientReportAddendum, PatientStructuredFinding } from "./repository";
import { countOpenCommunications, countPendingFollowUps, summarizeExams } from "./exam-summary";
import { countReviewedFindings } from "./finding-display";

const icons = {
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5",
  calendar: "M8 3v4M16 3v4M4 9h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
  check: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8.5 12.5l2.5 2.5 4.5-5",
  image: "M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM4 16l4-4 4 4 4-5 4 5M9 9h.01",
  fileCheck: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9.5 14.5l2 2 3.5-4",
  fileDraft: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 16h4",
  fileX: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9.8 13l4.4 4.4M14.2 13l-4.4 4.4",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  chat: "M4 5h16v11H8l-4 4z",
  star: "M12 3l2.7 5.7 6.3.8-4.6 4.3 1.2 6.2-5.6-3-5.6 3 1.2-6.2L3 9.5l6.3-.8z",
  filePlus: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 12v6M9 15h6",
  shield: "M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6zM9 12l2 2 4-4.5",
};

function TileIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

export function PatientClinicalSummaryCards({ exams, followUps, communications, keyImages, addenda, findings }: {
  exams: PatientExam[]; followUps: PatientFollowUp[]; communications: PatientCriticalCommunication[];
  keyImages: PatientKeyImage[]; addenda: PatientReportAddendum[]; findings: PatientStructuredFinding[];
}) {
  const summary = summarizeExams(exams);
  const tiles: [string, number, string][] = [
    ["Total de exámenes", summary.total, icons.file],
    ["Próximos", summary.upcoming, icons.calendar],
    ["Completados", summary.completed, icons.check],
    ["Con imágenes", summary.withImages, icons.image],
    ["Informes definitivos", summary.finalReports, icons.fileCheck],
    ["Borradores", summary.draftReports, icons.fileDraft],
    ["Sin informe", summary.withoutReport, icons.fileX],
    ["Seguimientos pendientes", countPendingFollowUps(followUps), icons.clock],
    ["Comunicaciones abiertas", countOpenCommunications(communications), icons.chat],
    ["Imágenes clave", keyImages.length, icons.star],
    ["Addenda", addenda.length, icons.filePlus],
    ["Hallazgos revisados", countReviewedFindings(findings), icons.shield],
  ];
  return (
    <section className="summary-tiles" aria-label="Resumen de actividad clínica">
      {tiles.map(([label, value, path]) => (
        <div className="card summary-card" key={label}>
          <TileIcon path={path} />
          <div><strong>{value}</strong><span>{label}</span></div>
        </div>
      ))}
    </section>
  );
}
