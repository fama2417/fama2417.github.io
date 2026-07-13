import assert from "node:assert/strict";
import test from "node:test";
import { clinicalProfileForCategory } from "../clinical-workspace/profiles.ts";
import { criticalFindingState, validateFinalReport } from "./validation.ts";

const valid = {
  findings: "Sin hallazgos agudos.", impression: "Examen sin alteraciones.", identityConfirmed: true,
  clinicalQuestionAnswered: true, criticalFinding: false, criticalFindingType: "",
};

test("valida los requisitos de un informe definitivo", () => {
  assert.equal(validateFinalReport(valid, false), "");
  assert.match(validateFinalReport({ ...valid, findings: "" }, false), /Hallazgos/);
  assert.match(validateFinalReport({ ...valid, criticalFinding: true }, false), /tipo de hallazgo crítico/);
  assert.match(validateFinalReport({ ...valid, criticalFinding: true, criticalFindingType: "Hemorragia intracraneal" }, false), /comunicación/);
  assert.equal(validateFinalReport({ ...valid, criticalFinding: true, criticalFindingType: "Hemorragia intracraneal" }, true), "");
});

test("deriva el estado crítico y elige la última comunicación confirmada", () => {
  const old = { reportId: "report-a", urgency: "critical", acknowledged: true, communicatedAt: "2026-07-10T10:00:00Z", recipient: "Urgencias" };
  const current = { reportId: "report-a", urgency: "critical", acknowledged: true, communicatedAt: "2026-07-10T11:00:00Z", recipient: "Médico tratante" };
  assert.equal(criticalFindingState(false, "report-a", [old]).status, "inactive");
  assert.equal(criticalFindingState(true, "report-a", [{ ...old, acknowledged: false }]).status, "pending");
  assert.equal(criticalFindingState(true, "report-a", [{ ...old, urgency: "urgent" }]).status, "pending");
  assert.equal(criticalFindingState(true, "report-a", [{ ...old, reportId: null }]).status, "pending");
  assert.equal(criticalFindingState(true, "report-b", [old]).status, "pending");
  assert.equal(criticalFindingState(true, "report-recreated", [old]).status, "pending");
  assert.deepEqual(criticalFindingState(true, "report-a", [old, current]), { status: "confirmed", communication: current });
});

test("asigna workspace y visor por tipo de documento", () => {
  assert.equal(clinicalProfileForCategory("imaging").viewerMode, "dicom");
  assert.equal(clinicalProfileForCategory("consultation").viewerMode, "none");
  assert.equal(clinicalProfileForCategory("pathology").aiAnalysisProfile, "pathology");
  assert.notEqual(clinicalProfileForCategory("procedure").aiAnalysisProfile, "radiology");
});
