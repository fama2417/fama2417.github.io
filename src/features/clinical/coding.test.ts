import assert from "node:assert/strict";
import test from "node:test";
import { codeHref, codingError } from "./coding.ts";

test("valida y enlaza códigos clínicos estándar", () => {
  assert.equal(codingError("LOCAL", "", "", "Prestación"), "");
  assert.match(codingError("LOINC", "", "", "Prestación"), /completa/);
  assert.match(codingError("BAD", "123", "Texto", "Prestación"), /inválido/);
  assert.match(codingError("SNOMEDCT", "123 456", "Texto", "Hallazgo"), /caracteres/);
  assert.equal(codingError("LOINC", "1234-5", "Glucose", "Prestación"), "");
  assert.equal(codeHref("LOINC", "1234-5"), "https://loinc.org/1234-5/");
});
