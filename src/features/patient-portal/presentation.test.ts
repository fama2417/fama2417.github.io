import assert from "node:assert/strict";
import test from "node:test";
import type { PhrLabResult } from "./labs.ts";
import { friendlyDocumentName, latestLaboratory, recentPhrActivity, suggestedResultCount, visiblePhrTabs } from "./presentation.ts";
import type { PortalDocument } from "./repository.ts";

const document = (id: string, date: string, type: PortalDocument["documentType"] = "laboratory"): PortalDocument => ({
  id, documentDate: date, createdAt: `${date}T12:00:00Z`, documentType: type, clinicalArea: type === "laboratory" || type === "imaging" ? type : "other", filename: `informe_tecnico_${id}.pdf`,
  mimeType: "application/pdf", sizeBytes: 1000, sourceInstitution: "Laboratorio", url: `/document/${id}`, sharedPatientIds: [], reviewByPatientId: {},
});
const result = (id: string, documentId: string, date: string, reviewStatus: PhrLabResult["reviewStatus"]): PhrLabResult => ({
  id, documentId, observedAt: date, reviewStatus, analyte: "Glucosa", loincCode: "", valueNum: 90, valueText: "", unit: "mg/dL",
  refLow: 70, refHigh: 99, refText: "", flag: "normal", source: "ocr",
});

test("presenta documentos con nombres humanos y selecciona el último laboratorio por fecha", () => {
  assert.equal(friendlyDocumentName("laboratory"), "Resultado de laboratorio");
  assert.doesNotMatch(friendlyDocumentName("other"), /informe_tecnico|\.pdf/i);
  assert.equal(latestLaboratory([document("nuevo", "2026-07-10"), document("otro", "2026-07-12", "imaging"), document("antiguo", "2025-01-01")])?.id, "nuevo");
});

test("resume pendientes y actividad sin inventar ni duplicar documentos", () => {
  const documents = [document("a", "2026-01-01"), document("b", "2026-06-01", "other")];
  const results = [result("1", "a", "2026-01-01", "suggested"), result("2", "a", "2026-01-01", "confirmed")];
  assert.equal(suggestedResultCount(results), 1);
  assert.deepEqual(recentPhrActivity(documents, results).map((event) => event.id), ["b", "a"]);
  assert.equal(recentPhrActivity(documents, results).filter((event) => event.id === "a").length, 1);
  assert.deepEqual(recentPhrActivity([], []), []);
});

test("solo lectura mantiene navegación segura", () => {
  assert.equal(visiblePhrTabs(true).some(([id]) => id === "compartir"), false);
  assert.equal(visiblePhrTabs(false).some(([id]) => id === "compartir"), true);
});
