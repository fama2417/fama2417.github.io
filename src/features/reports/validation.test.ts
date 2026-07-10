import assert from "node:assert/strict";
import test from "node:test";
import { clinicalProfileForCategory } from "../clinical-workspace/profiles.ts";
import { validateFinalReport } from "./validation.ts";

const valid = {
  findings: "Sin hallazgos agudos.", impression: "Examen sin alteraciones.", identityConfirmed: true,
  clinicalQuestionAnswered: true, criticalFinding: false, criticalFindingType: "",
};

test("valida los requisitos de un informe definitivo", () => {
  assert.equal(validateFinalReport(valid, false), "");
  assert.match(validateFinalReport({ ...valid, findings: "" }, false), /Hallazgos/);
  assert.match(validateFinalReport({ ...valid, criticalFinding: true, criticalFindingType: "Hemorragia intracraneal" }, false), /comunicación/);
  assert.equal(validateFinalReport({ ...valid, criticalFinding: true, criticalFindingType: "Hemorragia intracraneal" }, true), "");
});

test("asigna workspace y visor por tipo de documento", () => {
  assert.equal(clinicalProfileForCategory("imaging").viewerMode, "dicom");
  assert.equal(clinicalProfileForCategory("consultation").viewerMode, "none");
  assert.equal(clinicalProfileForCategory("pathology").aiAnalysisProfile, "pathology");
  assert.notEqual(clinicalProfileForCategory("procedure").aiAnalysisProfile, "radiology");
});
