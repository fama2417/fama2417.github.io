import assert from "node:assert/strict";
import test from "node:test";
import { clinicalDocumentProfiles, clinicalProfileForCategory, supportsRadiologyAi } from "../clinical-workspace/profiles.ts";
import { criticalFindingState, criticalFindingTypeError, validateFinalReport } from "./validation.ts";

const valid = {
  clinicalIndication: "Control.", technique: "Técnica habitual.", comparison: "Sin comparación.",
  findings: "Sin hallazgos agudos.", impression: "Examen sin alteraciones.", identityConfirmed: true,
  clinicalQuestionAnswered: true, criticalFinding: false, criticalFindingType: "",
};

test("valida los requisitos de un informe definitivo", () => {
  assert.equal(validateFinalReport(valid, false), "");
  assert.match(validateFinalReport({ ...valid, findings: "" }, false), /Hallazgos/);
  assert.match(validateFinalReport({ ...valid, criticalFinding: true }, false), /tipo de hallazgo crítico/);
  assert.match(validateFinalReport({ ...valid, criticalFinding: true, criticalFindingType: "Hemorragia intracraneal" }, false), /comunicación/);
  assert.equal(validateFinalReport({ ...valid, criticalFinding: true, criticalFindingType: "Hemorragia intracraneal" }, true), "");
  assert.equal(validateFinalReport({ ...valid, findings: "", impression: "" }, false, "laboratory"), "Completa Resultados antes de firmar.");
  assert.equal(validateFinalReport({ ...valid, findings: "", impression: "Diagnóstico" }, false, "pathology"), "");
  assert.equal(validateFinalReport({ ...valid, technique: "", findings: "", impression: "Plan" }, false, "procedure"), "Completa Técnica / procedimiento antes de firmar.");
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
  assert.deepEqual(Object.keys(clinicalDocumentProfiles).sort(), ["consultation", "imaging", "laboratory", "pathology", "procedure"]);
  for (const profile of Object.values(clinicalDocumentProfiles)) assert.deepEqual(profile.sections.map((section) => section.name), ["clinicalIndication", "comparison", "technique", "findings", "impression"]);
  assert.equal(clinicalProfileForCategory("imaging").viewerMode, "dicom");
  assert.equal(clinicalProfileForCategory("imaging").sections.at(-1)?.label, "Impresión diagnóstica");
  assert.equal(clinicalProfileForCategory("consultation").viewerMode, "none");
  assert.equal(clinicalProfileForCategory("pathology").viewerMode, "attachments");
  assert.equal(clinicalProfileForCategory("pathology").aiAnalysisProfile, "none");
  assert.equal(clinicalProfileForCategory("pathology").sections.find((section) => section.name === "impression")?.label, "Diagnóstico");
  assert.equal(clinicalProfileForCategory("procedure").sections.find((section) => section.name === "comparison")?.label, "Incidentes / limitaciones");
  assert.match(criticalFindingTypeError("laboratory"), /resultado crítico/);
  assert.equal(supportsRadiologyAi("imaging"), true);
  assert.equal(supportsRadiologyAi("consultation"), false);
  assert.equal(supportsRadiologyAi("laboratory"), false);
  assert.equal(supportsRadiologyAi("pathology"), false);
  assert.equal(supportsRadiologyAi("procedure"), false);
});
