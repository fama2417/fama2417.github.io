type FinalReport = {
  findings: string;
  impression: string;
  identityConfirmed: boolean;
  clinicalQuestionAnswered: boolean;
  criticalFinding: boolean;
  criticalFindingType: string;
};

export function validateFinalReport(report: FinalReport, hasAcknowledgedCriticalCommunication: boolean) {
  if (!report.findings.trim() || !report.impression.trim()) return "Completa Hallazgos e Impresión antes de firmar.";
  if (!report.identityConfirmed) return "Confirma la identidad del paciente antes de firmar.";
  if (!report.clinicalQuestionAnswered) return "Confirma que la impresión responde la pregunta clínica.";
  if (report.criticalFinding && !report.criticalFindingType) return "Indica el tipo de hallazgo crítico antes de firmar.";
  if (report.criticalFinding && !hasAcknowledgedCriticalCommunication) return "Registra una comunicación crítica confirmada antes de firmar.";
  return "";
}
