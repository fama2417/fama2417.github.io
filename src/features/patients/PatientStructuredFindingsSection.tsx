"use client";

import type { PatientStructuredFinding } from "./repository";
import { ExamStatusBadge, formatExamDate, isReportAvailable } from "./exam-status";
import {
  extractionMethodLabels, findingImportanceLabels, findingReviewLabels, findingSectionLabels, findingStatusLabels,
} from "./finding-display";

const statusClass: Record<string, string> = {
  present: "status-scheduled", absent: "status-completed", uncertain: "status-in_progress", history: "status-muted", recommendation: "status-in_progress",
};
const reviewClass: Record<string, string> = {
  suggested: "status-in_progress", confirmed: "status-completed", corrected: "status-scheduled", not_required: "status-muted",
};

const lateralityLabels: Record<string, string> = { left: "izquierda", right: "derecha", bilateral: "bilateral", midline: "línea media", unknown: "" };
const severityLabels: Record<string, string> = { mild: "leve", moderate: "moderada", severe: "severa", unknown: "" };

function findingCodeText(finding: PatientStructuredFinding) {
  const code = finding.code;
  if (!code) return "";
  const parts = [code.snomedCode && `SNOMED ${code.snomedCode}${code.snomedDisplay ? ` (${code.snomedDisplay})` : ""}`, code.icd10Code && `CIE-10 ${code.icd10Code}`, code.icd11Code && `CIE-11 ${code.icd11Code}`, code.radlexCode && `RadLex ${code.radlexCode}`].filter(Boolean);
  return parts.length ? parts.join(" · ") : `Código interno ${code.localCode}`;
}

/** Recibe hallazgos ya filtrados por rol y deduplicados (finding-display.ts, aplicado en PatientHistory). */
export function PatientStructuredFindingsSection({ findings, totalCount, canEditReports, limit, onViewAll }: { findings: PatientStructuredFinding[]; totalCount: number; canEditReports: boolean; limit?: number; onViewAll?: () => void }) {
  if (!findings.length) {
    return <p className="empty-state">{totalCount > 0 ? "Sin hallazgos estructurados disponibles para tu rol." : "Sin hallazgos estructurados registrados para este paciente."}</p>;
  }

  const shown = limit ? findings.slice(0, limit) : findings;
  const groups = new Map<string, { exam: PatientStructuredFinding["exam"]; items: PatientStructuredFinding[] }>();
  for (const finding of shown) {
    const group = groups.get(finding.exam.id) ?? { exam: finding.exam, items: [] };
    group.items.push(finding);
    groups.set(finding.exam.id, group);
  }

  return <>
    <p className="empty-inline">Hallazgos estructurados extraídos automáticamente de los informes y revisados en el flujo de reporte. No reemplazan el informe radiológico.</p>
    <section className="imaging-grid findings-grid" aria-label="Hallazgos estructurados por examen">
      {[...groups.values()].map(({ exam, items }) => (
        <article className="card imaging-card" key={exam.id}>
          <header>
            <strong className="imaging-modality">{exam.modality}</strong>
            <ExamStatusBadge status={exam.status} />
          </header>
          <h4>{exam.reason}</h4>
          <p className="imaging-when">{formatExamDate(exam.date)}{exam.time && ` · ${exam.time} h`}</p>
          <div className="finding-list">
            {items.map((finding) => (
              <div className="finding-item" key={finding.id}>
                <div className="badge-row">
                  <span className={`status ${statusClass[finding.status] ?? "status-muted"}`}>{findingStatusLabels[finding.status] ?? finding.status}</span>
                  <span className={`status ${reviewClass[finding.codingStatus] ?? "status-muted"}`}>{findingReviewLabels[finding.codingStatus] ?? finding.codingStatus}</span>
                  <span className="status status-muted">{findingImportanceLabels[finding.importance] ?? finding.importance}</span>
                </div>
                <strong>{finding.findingText}</strong>
                <span className="finding-meta">
                  {[
                    findingSectionLabels[finding.sourceSection] ?? finding.sourceSection,
                    [finding.bodySite, lateralityLabels[finding.laterality], severityLabels[finding.severity]].filter(Boolean).join(" "),
                    findingCodeText(finding),
                    extractionMethodLabels[finding.extractionMethod] ?? finding.extractionMethod,
                    finding.confidence > 0 ? `Confianza de extracción ${Math.round(finding.confidence * 100)}%` : "",
                  ].filter(Boolean).join(" · ")}
                </span>
                {finding.sourceSentence && <span className="finding-source">“{finding.sourceSentence}”</span>}
              </div>
            ))}
          </div>
          {isReportAvailable(exam, canEditReports) && <a className="text-button" href={`/informe/${exam.id}`}>Ver informe →</a>}
        </article>
      ))}
    </section>
    {onViewAll && findings.length > shown.length && <button className="text-button" type="button" onClick={onViewAll}>Ver todos los hallazgos →</button>}
  </>;
}
