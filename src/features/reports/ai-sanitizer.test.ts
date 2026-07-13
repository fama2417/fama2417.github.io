import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeReportForAi, sanitizeTextForAi } from "./ai-sanitizer.ts";

test("remueve PHI comun antes de enviar a IA", () => {
  const text = sanitizeTextForAi("Paciente 12.345.678-9, mail test@example.com, fono +56 9 1234 5678.");
  assert.equal(text.includes("12.345.678-9"), false);
  assert.equal(text.includes("test@example.com"), false);
  assert.equal(text.includes("+56 9 1234 5678"), false);
});

test("remueve nombre estructurado del paciente", () => {
  const input = sanitizeReportForAi({ comparison: "Control de Juan Perez.", findings: "Juan Perez con neumonia.", impression: "" }, { patientName: "Juan Perez" });
  assert.match(input.findings ?? "", /\[PATIENT\]/);
  assert.match(input.comparison ?? "", /\[PATIENT\]/);
});
