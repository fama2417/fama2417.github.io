type FinalReport = {
  findings: string;
  impression: string;
  identityConfirmed: boolean;
  clinicalQuestionAnswered: boolean;
  criticalFinding: boolean;
  criticalFindingType: string;
};

type CriticalCommunication = { reportId: string | null; urgency: string; acknowledged: boolean; communicatedAt: string; recipient: string };

export const criticalFindingTypeError = "Indica el tipo de hallazgo crítico antes de firmar.";

export function criticalFindingState<T extends CriticalCommunication>(active: boolean, reportId: string | undefined, communications: readonly T[]) {
  const communication = communications.findLast((item) => item.reportId === reportId && item.urgency === "critical" && item.acknowledged);
  return { status: !active ? "inactive" as const : communication ? "confirmed" as const : "pending" as const, communication };
}

export function validateFinalReport(report: FinalReport, hasAcknowledgedCriticalCommunication: boolean) {
  if (!report.findings.trim() || !report.impression.trim()) return "Completa Hallazgos e Impresión antes de firmar.";
  if (!report.identityConfirmed) return "Confirma la identidad del paciente antes de firmar.";
  if (!report.clinicalQuestionAnswered) return "Confirma que la impresión responde la pregunta clínica.";
  if (report.criticalFinding && !report.criticalFindingType) return criticalFindingTypeError;
  if (report.criticalFinding && !hasAcknowledgedCriticalCommunication) return "Registra una comunicación crítica confirmada antes de firmar.";
  return "";
}
