"use client";

import { appointmentStatusLabels, type AppointmentStatus } from "@/features/appointments/status";
import type { PatientExam } from "./repository";

// El gating vive en exam-summary.ts (archivo puro, testeable); se re-exporta aquí para los componentes.
export { isReportAvailable } from "./exam-summary";

export function formatExamDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
}

export function ExamStatusBadge({ status }: { status: string }) {
  return <span className={`status status-${status}`}>{appointmentStatusLabels[status as AppointmentStatus] ?? status}</span>;
}

export function ReportAvailabilityBadge({ exam }: { exam: Pick<PatientExam, "reportStatus"> }) {
  if (!exam.reportStatus) return <span className="status status-muted">Sin informe</span>;
  return exam.reportStatus === "final"
    ? <span className="status status-completed">Informe definitivo</span>
    : <span className="status status-in_progress">Informe borrador</span>;
}

export function ImagesBadge({ hasImages }: { hasImages: boolean }) {
  return hasImages ? <span className="status status-scheduled">Con imágenes</span> : <span className="status status-muted">Sin imágenes</span>;
}
