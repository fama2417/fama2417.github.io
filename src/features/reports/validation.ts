import type { Appointment } from "../appointments/mock-data.ts";
import { clinicalProfileForCategory } from "../clinical-workspace/profiles.ts";

type FinalReport = {
  clinicalIndication: string;
  technique: string;
  comparison: string;
  findings: string;
  impression: string;
  identityConfirmed: boolean;
  clinicalQuestionAnswered: boolean;
  criticalFinding: boolean;
  criticalFindingType: string;
};

type CriticalCommunication = { reportId: string | null; urgency: string; acknowledged: boolean; communicatedAt: string; recipient: string };

export const criticalFindingTypeError = (category: Appointment["serviceCategory"] = "imaging") =>
  `Indica el tipo de ${clinicalProfileForCategory(category).criticalLabel.toLocaleLowerCase("es-CL")} antes de firmar.`;

export function criticalFindingState<T extends CriticalCommunication>(active: boolean, reportId: string | undefined, communications: readonly T[]) {
  const communication = communications.findLast((item) => item.reportId === reportId && item.urgency === "critical" && item.acknowledged);
  return { status: !active ? "inactive" as const : communication ? "confirmed" as const : "pending" as const, communication };
}

export function validateFinalReport(report: FinalReport, hasAcknowledgedCriticalCommunication: boolean, category: Appointment["serviceCategory"] = "imaging") {
  const profile = clinicalProfileForCategory(category);
  const missing = profile.sections.filter((section) => section.required && !report[section.name].trim()).map((section) => section.label);
  if (missing.length) return `Completa ${missing.join(" y ")} antes de firmar.`;
  if (!report.identityConfirmed) return "Confirma la identidad del paciente antes de firmar.";
  if (!report.clinicalQuestionAnswered) return profile.confirmationLabel;
  if (report.criticalFinding && !report.criticalFindingType) return criticalFindingTypeError(category);
  if (report.criticalFinding && !hasAcknowledgedCriticalCommunication) return "Registra una comunicación crítica confirmada antes de firmar.";
  return "";
}
