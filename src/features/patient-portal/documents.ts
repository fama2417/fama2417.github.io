export const PATIENT_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;
export const PATIENT_DOCUMENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "application/dicom"] as const;
const ANALYZABLE_LAB_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

export const isAnalyzableLabDocument = (mimeType: string) => ANALYZABLE_LAB_TYPES.has(mimeType);
export const labImageMime = (mimeType: string): "image/jpeg" | "image/png" | "" => mimeType === "image/jpeg" || mimeType === "image/png" ? mimeType : "";

export function validatePatientDocument(file: { size: number; type: string }) {
  if (!PATIENT_DOCUMENT_TYPES.includes(file.type as (typeof PATIENT_DOCUMENT_TYPES)[number])) return "Solo se permiten archivos PDF, JPG, PNG o DICOM.";
  if (file.size < 1 || file.size > PATIENT_DOCUMENT_MAX_BYTES) return "El archivo debe pesar menos de 20 MB.";
  return "";
}

export function hasValidPatientDocumentSignature(bytes: Uint8Array, type: string) {
  if (type === "application/pdf") return bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
  if (type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);
  // ponytail: exige preámbulo DICM; ampliar con parser DICOM si aparecen instancias legacy sin preámbulo.
  if (type === "application/dicom") return bytes.length >= 132 && String.fromCharCode(...bytes.slice(128, 132)) === "DICM";
  return false;
}
