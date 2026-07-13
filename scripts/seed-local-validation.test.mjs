import assert from "node:assert/strict";
import test from "node:test";
import { assertLocalUrl, syntheticDicom } from "./seed-local-validation.mjs";

test("el seed acepta solo servicios HTTP locales y genera DICOM válido", () => {
  assert.equal(assertLocalUrl("Supabase", "http://127.0.0.1:55321").port, "55321");
  assert.throws(() => assertLocalUrl("Supabase", "https://project.supabase.co"), /localhost/);
  const dicom = syntheticDicom(1);
  assert.equal(dicom.subarray(128, 132).toString("ascii"), "DICM");
  assert.ok(dicom.length > 4096);
});
