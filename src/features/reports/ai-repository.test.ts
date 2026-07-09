import assert from "node:assert/strict";
import test from "node:test";
import { canCreateDictionaryCandidate, nextCandidateOccurrence } from "./ai-repository.ts";

test("candidato repetido incrementa ocurrencias", () => {
  assert.equal(nextCandidateOccurrence({ occurrence_count: 3 }), 4);
  assert.equal(nextCandidateOccurrence({ occurrence_count: null }), 1);
});

test("no crea candidatos para negativos rutinarios", () => {
  const finding = { findingText: "No hay adenopatias.", canonicalName: "Adenopatias", status: "absent", importance: "negative", bodySite: null, laterality: null, severity: null, sourceSection: "findings", sourceSentence: "No hay adenopatias.", isNegated: true, isUncertain: false, isHistorical: false, shouldCreateDictionaryCandidate: true, confidence: 0.9 } as const;
  assert.equal(canCreateDictionaryCandidate(finding), false);
  assert.equal(canCreateDictionaryCandidate({ ...finding, status: "present", importance: "principal" }), true);
});
