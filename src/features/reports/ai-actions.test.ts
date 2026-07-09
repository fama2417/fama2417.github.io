import assert from "node:assert/strict";
import test from "node:test";
import { PatchExtractedFindingActionSchema } from "./ai-actions.ts";

test("valida acciones PATCH de hallazgos extraidos", () => {
  assert.equal(PatchExtractedFindingActionSchema.safeParse({ action: "confirm" }).success, true);
  assert.equal(PatchExtractedFindingActionSchema.safeParse({ action: "reject", reason: "No corresponde" }).success, true);
  assert.equal(PatchExtractedFindingActionSchema.safeParse({ action: "correct", correctedText: "Colelitiasis" }).success, true);
  assert.equal(PatchExtractedFindingActionSchema.safeParse({ action: "correct", correctedText: "" }).success, false);
  assert.equal(PatchExtractedFindingActionSchema.safeParse({ action: "delete" }).success, false);
});
