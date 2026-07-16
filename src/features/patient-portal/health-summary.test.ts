import assert from "node:assert/strict";
import test from "node:test";
import type { PhrLabResult } from "./labs.ts";
import { phrHealthItemFhirResource, phrReviewCounts, searchPhrRecords, validatePhrHealthItem, type PhrHealthItem } from "./health-summary.ts";

const item: PhrHealthItem = { id: "h1", ownerUserId: "u1", kind: "allergy", label: "Ácido acetilsalicílico", status: "active", eventDate: "", source: "patient", sourceDocumentId: "", notes: "Declarado", createdAt: "2026-01-01", updatedAt: "2026-01-01" };
const lab: PhrLabResult = { id: "l1", documentId: "d1", loincCode: "2345-7", analyte: "Glucosa", valueNum: 90, valueText: "", unit: "mg/dL", refLow: 70, refHigh: 99, refText: "", flag: "normal", observedAt: "2026-01-02", source: "ocr", reviewStatus: "suggested" };
const document = { id: "d1", filename: "informe.pdf", documentType: "laboratory", sourceInstitution: "Clínica", documentDate: "2026-01-02", createdAt: "2026-01-02T00:00:00Z", sizeBytes: 100 };

test("valida antecedentes y busca sin depender de tildes", () => {
  assert.ok("value" in validatePhrHealthItem({ kind: "medication", label: "Losartán", status: "active", source: "patient" }));
  const invalid = validatePhrHealthItem({ kind: "condition", label: "", status: "active", source: "patient" });
  assert.ok("error" in invalid); assert.match(invalid.error, /nombre/i);
  assert.ok("error" in validatePhrHealthItem({ kind: "condition", label: "Control", eventDate: "2026-02-30", status: "active", source: "patient" }));
  assert.equal(searchPhrRecords("acido", [document], [lab], [item])[0]?.id, "h1");
  assert.equal(searchPhrRecords("glucosa 90", [document], [lab], [item])[0]?.id, "l1");
});

test("resume sólo tareas accionables y posibles duplicados", () => {
  const counts = phrReviewCounts([document, { ...document, id: "d2" }, { ...document, id: "r1", filename: "rx.pdf", documentType: "imaging" }], [lab]);
  assert.deepEqual(counts, { suggestedLabs: 1, unmappedLabs: 0, unanalyzedLabs: 1, imagingWithoutText: 1, duplicateDocuments: 1 });
});

test("exporta antecedentes como recursos FHIR seguros y declarativos", () => {
  const allergy = phrHealthItemFhirResource(item, "patient-1");
  assert.equal(allergy.resourceType, "AllergyIntolerance");
  assert.deepEqual(allergy.patient, { reference: "Patient/patient-1" });
  const vaccine = phrHealthItemFhirResource({ ...item, kind: "immunization", eventDate: "2026-01-02" }, "patient-1");
  assert.equal(vaccine.resourceType, "Immunization"); assert.equal(vaccine.occurrenceDateTime, "2026-01-02");
});
