import assert from "node:assert/strict";
import test from "node:test";
import { structurePhrImagingText } from "./imaging.ts";

test("separa un informe radiológico local sin interpretar su contenido", () => {
  const text = structurePhrImagingText("INDICACIÓN CLÍNICA: Dolor.\nTÉCNICA\nTC sin contraste.\nHALLAZGOS:\nTexto descriptivo.\nCONCLUSIÓN: Sin cambios.");
  assert.deepEqual({ clinicalIndication: text.clinicalIndication, technique: text.technique, findings: text.findings, impression: text.impression }, {
    clinicalIndication: "Dolor.", technique: "TC sin contraste.", findings: "Texto descriptivo.", impression: "Sin cambios.",
  });
});

test("separa encabezados aunque el PDF entregue todo en una sola línea", () => {
  const text = structurePhrImagingText("Paciente: Prueba Hallazgos: ATM derecha conservada. ATM izquierda con derrame. Impresión: Cambios en ambas articulaciones. Atentamente, Pag 1 de 2 Paciente: Prueba");
  assert.equal(text.findings, "ATM derecha conservada. ATM izquierda con derrame.");
  assert.equal(text.impression, "Cambios en ambas articulaciones.");
});
