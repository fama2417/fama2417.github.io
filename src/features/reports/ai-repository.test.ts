import assert from "node:assert/strict";
import test from "node:test";
import { nextCandidateOccurrence } from "./ai-repository.ts";

test("candidato repetido incrementa ocurrencias", () => {
  assert.equal(nextCandidateOccurrence({ occurrence_count: 3 }), 4);
  assert.equal(nextCandidateOccurrence({ occurrence_count: null }), 1);
});
