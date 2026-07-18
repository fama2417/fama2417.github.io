import assert from "node:assert/strict";
import test from "node:test";
import { phrImagingPlainLanguagePoints, structurePhrImagingText } from "./imaging.ts";

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

test("estructura informes de distintas especialidades con el mismo flujo", () => {
  const cardiology = structurePhrImagingText("MOTIVO DE CONSULTA: Palpitaciones. EXAMEN REALIZADO: Electrocardiograma de 12 derivaciones. INTERPRETACIÓN: Ritmo sinusal.");
  assert.deepEqual([cardiology.clinicalIndication, cardiology.technique, cardiology.impression], ["Palpitaciones.", "Electrocardiograma de 12 derivaciones.", "Ritmo sinusal."]);
  const pathology = structurePhrImagingText("PROCEDIMIENTO: Biopsia cutánea. DESCRIPCIÓN: Fragmento con epidermis conservada. DIAGNÓSTICO FINAL: Hallazgos benignos.");
  assert.deepEqual([pathology.technique, pathology.findings, pathology.impression], ["Biopsia cutánea.", "Fragmento con epidermis conservada.", "Hallazgos benignos."]);
  const pulmonology = structurePhrImagingText("ANTECEDENTES: Disnea. MÉTODO: Espirometría. RESULTADOS: Patrón ventilatorio conservado. CONCLUSIÓN: Examen dentro de límites informados.");
  assert.deepEqual([pulmonology.clinicalIndication, pulmonology.technique, pulmonology.findings, pulmonology.impression], ["Disnea.", "Espirometría.", "Patrón ventilatorio conservado.", "Examen dentro de límites informados."]);
});

test("reconoce encabezados capitalizados sin dos puntos en texto PDF continuo", () => {
  const text = structurePhrImagingText("CENTRO CLINICO Endoscopia digestiva Servicio Gastroenterologia Hallazgos Mucosa esofagica y gastrica sin lesiones focales. Conclusion Examen sin hallazgos relevantes. Documento sintetico.");
  assert.equal(text.findings, "Mucosa esofagica y gastrica sin lesiones focales.");
  assert.equal(text.impression, "Examen sin hallazgos relevantes. Documento sintetico.");
});

test("presenta la explicación simple como puntos legibles", () => {
  assert.deepEqual(phrImagingPlainLanguagePoints("1. Primer punto. 2. Segundo punto."), ["Primer punto.", "Segundo punto."]);
  assert.deepEqual(phrImagingPlainLanguagePoints("Primer punto. Segundo punto."), ["Primer punto.", "Segundo punto."]);
  assert.deepEqual(phrImagingPlainLanguagePoints("Primer punto.\n- Segundo punto.\n- Tercer punto."), ["Primer punto.", "Segundo punto.", "Tercer punto."]);
});
