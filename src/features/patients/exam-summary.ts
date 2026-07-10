/** Métricas de la ficha clínica, calculadas desde los exámenes reales (sin mocks). Sin imports para poder testearse en node. */
export type ExamForSummary = { date: string; status: string; hasImages: boolean; reportStatus?: "draft" | "final" };

/** Único punto de gating: un informe es accesible si está firmado, o si está en borrador y el rol puede editarlo. */
export function isReportAvailable(exam: { reportStatus?: "draft" | "final" }, canEditReports: boolean) {
  return exam.reportStatus === "final" || (canEditReports && exam.reportStatus === "draft");
}

export type FollowUpForSummary = { status: string; dueDate: string };

/** Estado a mostrar: "overdue" se infiere si no está completado y la fecha límite ya pasó. */
export function followUpDisplayStatus(followUp: FollowUpForSummary, today = new Date().toISOString().slice(0, 10)) {
  return followUp.status !== "completed" && followUp.dueDate < today ? "overdue" : followUp.status;
}

export function countPendingFollowUps(followUps: FollowUpForSummary[]) {
  return followUps.filter((followUp) => followUp.status !== "completed").length;
}

export function countOpenCommunications(communications: { acknowledged: boolean }[]) {
  return communications.filter((communication) => !communication.acknowledged).length;
}

export function summarizeExams(exams: ExamForSummary[], today = new Date().toISOString().slice(0, 10)) {
  return {
    total: exams.length,
    upcoming: exams.filter((exam) => exam.date >= today && exam.status !== "cancelled" && exam.status !== "no_show").length,
    completed: exams.filter((exam) => exam.status === "completed").length,
    withImages: exams.filter((exam) => exam.hasImages).length,
    finalReports: exams.filter((exam) => exam.reportStatus === "final").length,
    draftReports: exams.filter((exam) => exam.reportStatus === "draft").length,
    withoutReport: exams.filter((exam) => !exam.reportStatus).length,
  };
}
