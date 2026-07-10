// Helpers puros para hallazgos estructurados (sin imports de supabase/JSX para poder testearse en node).
import { isReportAvailable } from "./exam-summary.ts";

export type FindingForDisplay = {
  reportId: string;
  normalizedText: string;
  status: string;
  codingStatus: string;
  createdAt: string;
  exam: { reportStatus?: "draft" | "final" };
};

const reviewed = (codingStatus: string) => codingStatus === "confirmed" || codingStatus === "corrected";

/**
 * Filtro de visibilidad por rol, sobre la fila completa (nada del hallazgo se renderiza si no pasa):
 * - rechazados nunca se muestran (defensa doble: la query ya los excluye);
 * - el informe debe ser accesible según isReportAvailable;
 * - operator (sin permiso de edición) solo ve hallazgos revisados (confirmed/corrected) de informes finales.
 */
export function visibleFindings<T extends FindingForDisplay>(findings: T[], canEditReports: boolean): T[] {
  return findings.filter((finding) => {
    if (finding.codingStatus === "rejected") return false;
    if (!isReportAvailable(finding.exam, canEditReports)) return false;
    if (!canEditReports && !reviewed(finding.codingStatus)) return false;
    return true;
  });
}

/**
 * Dedupe por re-extracción. Clave: reportId + normalizedText + status — la misma frase con polaridad
 * distinta NO es duplicado y se conserva. Entre duplicados gana el revisado (confirmed/corrected)
 * sobre el sugerido; a igual rango, el más reciente.
 */
export function dedupeFindings<T extends FindingForDisplay>(findings: T[]): T[] {
  const rank = (finding: T) => (reviewed(finding.codingStatus) ? 1 : 0);
  const byKey = new Map<string, T>();
  for (const finding of findings) {
    const key = `${finding.reportId}|${finding.normalizedText}|${finding.status}`;
    const current = byKey.get(key);
    if (!current || rank(finding) > rank(current) || (rank(finding) === rank(current) && finding.createdAt > current.createdAt)) byKey.set(key, finding);
  }
  return [...byKey.values()];
}

/** Hallazgos revisados por un profesional (confirmados o corregidos) dentro del conjunto visible. */
export function countReviewedFindings(findings: { codingStatus: string }[]) {
  return findings.filter((finding) => reviewed(finding.codingStatus)).length;
}

export const findingStatusLabels: Record<string, string> = {
  present: "Presente", absent: "Ausente / descartado", uncertain: "Incierto", history: "Antecedente", recommendation: "Recomendación",
};

export const findingReviewLabels: Record<string, string> = {
  suggested: "Pendiente de revisión", confirmed: "Revisado", corrected: "Corregido", not_required: "Sin codificación requerida", rejected: "Rechazado",
};

export const findingImportanceLabels: Record<string, string> = {
  principal: "Principal", secondary: "Secundario", incidental: "Incidental", negative: "Negativo", not_relevant: "No relevante",
};

export const findingSectionLabels: Record<string, string> = {
  findings: "Hallazgos", impression: "Impresión", clinical_indication: "Indicación clínica",
};

export const extractionMethodLabels: Record<string, string> = {
  local_rules: "Reglas locales", openai: "Extraído automáticamente (IA)", manual: "Registro manual",
};
