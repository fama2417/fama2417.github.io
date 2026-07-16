export const PATIENT_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;
export const PATIENT_DOCUMENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "application/dicom"] as const;
const ANALYZABLE_LAB_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

export const PHR_CLINICAL_AREA_LABELS = {
  laboratory: "Laboratorio clínico",
  imaging: "Imagenología",
  pathology: "Anatomía patológica",
  cardiology: "Cardiología",
  gastroenterology: "Gastroenterología",
  gynecology: "Ginecología y obstetricia",
  neurology: "Neurología y neurofisiología",
  pulmonology: "Enfermedades respiratorias",
  ophthalmology: "Oftalmología",
  otolaryngology: "Otorrinolaringología y audiología",
  urology: "Urología",
  dermatology: "Dermatología",
  other: "Otros resultados",
} as const;
export type PhrClinicalArea = keyof typeof PHR_CLINICAL_AREA_LABELS;
export const PHR_CLINICAL_AREAS = Object.keys(PHR_CLINICAL_AREA_LABELS) as PhrClinicalArea[];

export const isPhrClinicalArea = (value: string): value is PhrClinicalArea => PHR_CLINICAL_AREAS.includes(value as PhrClinicalArea);
export const clinicalAreaForDocumentType = (type: string): PhrClinicalArea => type === "laboratory" || type === "imaging" ? type : "other";
export const documentTypeForSelection = (value: string) => value === "laboratory" || value === "imaging" || value === "prescription" ? value : "other";

export const isAnalyzableLabDocument = (mimeType: string) => ANALYZABLE_LAB_TYPES.has(mimeType);
export const labImageMime = (mimeType: string): "image/jpeg" | "image/png" | "" => mimeType === "image/jpeg" || mimeType === "image/png" ? mimeType : "";

export function patientPhotoQuality(input: { width: number; height: number; size: number; edgeScore?: number }) {
  if (Math.min(input.width, input.height) < 900) return "La foto tiene poca resolución. Acércate al documento y vuelve a tomarla.";
  if (input.size < 80 * 1024) return "La foto parece demasiado comprimida; el texto pequeño podría no reconocerse.";
  if (input.edgeScore !== undefined && input.edgeScore < 6) return "La foto parece borrosa o con poco contraste; revisa que el texto se vea nítido.";
  return "";
}

export async function inspectPatientPhoto(file: File) {
  if (!labImageMime(file.type)) return "";
  const bitmap = await createImageBitmap(file), canvas = document.createElement("canvas"), size = 64;
  const dimensions = { width: bitmap.width, height: bitmap.height, size: file.size };
  canvas.width = size; canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) { bitmap.close(); return patientPhotoQuality(dimensions); }
  context.drawImage(bitmap, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  let edges = 0, samples = 0;
  for (let y = 1; y < size; y++) for (let x = 1; x < size; x++) {
    const index = (y * size + x) * 4, left = index - 4, above = index - size * 4;
    const gray = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
    edges += Math.abs(gray - (pixels[left] + pixels[left + 1] + pixels[left + 2]) / 3) + Math.abs(gray - (pixels[above] + pixels[above + 1] + pixels[above + 2]) / 3);
    samples += 2;
  }
  const result = patientPhotoQuality({ ...dimensions, edgeScore: edges / samples });
  bitmap.close();
  return result;
}

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
