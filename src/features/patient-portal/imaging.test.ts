import assert from "node:assert/strict";
import test from "node:test";
import { structurePhrImagingText } from "./imaging.ts";

test("separa un informe radiológico local sin interpretar su contenido", () => {
  const text = structurePhrImagingText("INDICACIÓN CLÍNICA: Dolor.\nTÉCNICA\nTC sin contraste.\nHALLAZGOS:\nTexto descriptivo.\nCONCLUSIÓN: Sin cambios.");
  assert.deepEqual({ clinicalIndication: text.clinicalIndication, technique: text.technique, findings: text.findings, impression: text.impression }, {
    clinicalIndication: "Dolor.", technique: "TC sin contraste.", findings: "Texto descriptivo.", impression: "Sin cambios.",
  });
});
