import assert from "node:assert/strict";
import test from "node:test";
import { countOpenCommunications, countPendingFollowUps, followUpDisplayStatus, summarizeExams } from "./exam-summary.ts";

const today = "2026-07-09";

test("resume métricas clínicas desde exámenes reales", () => {
  const summary = summarizeExams([
    { date: "2026-07-20", status: "scheduled", hasImages: false },
    { date: "2026-07-10", status: "cancelled", hasImages: false },
    { date: "2026-07-01", status: "completed", hasImages: true, reportStatus: "final" },
    { date: "2026-06-15", status: "completed", hasImages: true, reportStatus: "draft" },
    { date: "2026-05-02", status: "no_show", hasImages: false },
  ], today);
  assert.deepEqual(summary, { total: 5, upcoming: 1, completed: 2, withImages: 2, finalReports: 1, draftReports: 1, withoutReport: 3 });
});

test("sin exámenes todo queda en cero", () => {
  const summary = summarizeExams([], today);
  assert.deepEqual(summary, { total: 0, upcoming: 0, completed: 0, withImages: 0, finalReports: 0, draftReports: 0, withoutReport: 0 });
});

test("examen de hoy cuenta como futuro si sigue vigente", () => {
  assert.equal(summarizeExams([{ date: today, status: "confirmed", hasImages: false }], today).upcoming, 1);
});

test("seguimiento vencido se infiere de fecha límite pasada y estado no completado", () => {
  assert.equal(followUpDisplayStatus({ status: "pending", dueDate: "2026-07-01" }, today), "overdue");
  assert.equal(followUpDisplayStatus({ status: "acknowledged", dueDate: "2026-07-01" }, today), "overdue");
  assert.equal(followUpDisplayStatus({ status: "completed", dueDate: "2026-07-01" }, today), "completed");
  assert.equal(followUpDisplayStatus({ status: "pending", dueDate: today }, today), "pending");
  assert.equal(followUpDisplayStatus({ status: "pending", dueDate: "2026-08-01" }, today), "pending");
});

test("seguimientos pendientes cuentan todo lo no completado", () => {
  assert.equal(countPendingFollowUps([
    { status: "pending", dueDate: "2026-08-01" },
    { status: "acknowledged", dueDate: "2026-07-01" },
    { status: "completed", dueDate: "2026-06-01" },
  ]), 2);
  assert.equal(countPendingFollowUps([]), 0);
});

test("comunicaciones abiertas son las sin acuse de recibo", () => {
  assert.equal(countOpenCommunications([{ acknowledged: false }, { acknowledged: true }, { acknowledged: false }]), 2);
  assert.equal(countOpenCommunications([]), 0);
});
