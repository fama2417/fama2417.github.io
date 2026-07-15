import test from "node:test";
import assert from "node:assert/strict";
import { hasValidPatientDocumentSignature, PATIENT_DOCUMENT_MAX_BYTES, validatePatientDocument } from "./documents.ts";

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
