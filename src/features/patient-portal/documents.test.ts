import test from "node:test";
import assert from "node:assert/strict";
import { clinicalAreaForDocumentType, documentTypeForSelection, hasValidPatientDocumentSignature, isAnalyzableLabDocument, labImageMime, patientPhotoQuality, PATIENT_DOCUMENT_MAX_BYTES, validatePatientDocument } from "./documents.ts";

test("acepta PDF, imágenes y DICOM de hasta 20 MB", () => {
  assert.equal(validatePatientDocument({ type: "application/pdf", size: 1 }), "");
  assert.equal(validatePatientDocument({ type: "image/jpeg", size: PATIENT_DOCUMENT_MAX_BYTES }), "");
  assert.equal(validatePatientDocument({ type: "application/dicom", size: 132 }), "");
});

test("rechaza tipos, archivos vacíos y archivos demasiado grandes", () => {
  assert.match(validatePatientDocument({ type: "text/plain", size: 10 }), /PDF/);
  assert.match(validatePatientDocument({ type: "image/png", size: 0 }), /20 MB/);
  assert.match(validatePatientDocument({ type: "image/png", size: PATIENT_DOCUMENT_MAX_BYTES + 1 }), /20 MB/);
});

test("comprueba la firma real y no solo el MIME declarado", () => {
  assert.equal(hasValidPatientDocumentSignature(new TextEncoder().encode("%PDF-1.7"), "application/pdf"), true);
  assert.equal(hasValidPatientDocumentSignature(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]), "image/jpeg"), true);
  assert.equal(hasValidPatientDocumentSignature(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"), true);
  const dicom = new Uint8Array(132); dicom.set(new TextEncoder().encode("DICM"), 128);
  assert.equal(hasValidPatientDocumentSignature(dicom, "application/dicom"), true);
  assert.equal(hasValidPatientDocumentSignature(new TextEncoder().encode("archivo falso"), "application/pdf"), false);
});

test("permite analizar laboratorios PDF o fotografiados, pero no DICOM", () => {
  assert.equal(isAnalyzableLabDocument("application/pdf"), true);
  assert.equal(isAnalyzableLabDocument("image/jpeg"), true);
  assert.equal(isAnalyzableLabDocument("image/png"), true);
  assert.equal(isAnalyzableLabDocument("application/dicom"), false);
  assert.equal(labImageMime("application/pdf"), "");
  assert.equal(labImageMime("image/jpeg"), "image/jpeg");
});

test("clasifica documentos clínicos y advierte fotos difíciles de leer", () => {
  assert.equal(documentTypeForSelection("cardiology"), "other");
  assert.equal(documentTypeForSelection("imaging"), "imaging");
  assert.equal(clinicalAreaForDocumentType("prescription"), "other");
  assert.match(patientPhotoQuality({ width: 600, height: 1200, size: 200_000 }), /resolución/);
  assert.match(patientPhotoQuality({ width: 1200, height: 1800, size: 200_000, edgeScore: 2 }), /borrosa/);
  assert.equal(patientPhotoQuality({ width: 1200, height: 1800, size: 200_000, edgeScore: 12 }), "");
});
