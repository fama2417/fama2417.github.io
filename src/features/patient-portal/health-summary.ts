import { phrLabDisplayName, type PhrLabResult } from "./labs.ts";

export const healthItemKinds = ["allergy", "condition", "medication", "immunization", "procedure"] as const;
export type PhrHealthItemKind = (typeof healthItemKinds)[number];
export type PhrHealthItemStatus = "active" | "inactive" | "completed";
export type PhrHealthItemSource = "patient" | "document";

export const healthItemKindLabels: Record<PhrHealthItemKind, string> = {
  allergy: "Alergias",
  condition: "Condiciones",
  medication: "Medicamentos",
  immunization: "Vacunas",
  procedure: "Procedimientos",
};
export const healthItemStatusLabels: Record<PhrHealthItemStatus, string> = { active: "Activo", inactive: "Inactivo", completed: "Completado" };

export type PhrHealthItem = {
  id: string;
  ownerUserId: string;
  kind: PhrHealthItemKind;
  label: string;
  status: PhrHealthItemStatus;
  eventDate: string;
  source: PhrHealthItemSource;
  sourceDocumentId: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type PhrHealthItemDraft = Omit<PhrHealthItem, "id" | "ownerUserId" | "createdAt" | "updatedAt">;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validDate = (value: string) => {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export function validatePhrHealthItem(input: Partial<PhrHealthItemDraft>): { value: PhrHealthItemDraft } | { error: string } {
  const value: PhrHealthItemDraft = {
    kind: input.kind ?? "condition",
    label: input.label?.trim() ?? "",
    status: input.status ?? "active",
    eventDate: input.eventDate?.trim() ?? "",
    source: input.source ?? "patient",
    sourceDocumentId: input.source === "document" ? input.sourceDocumentId?.trim() ?? "" : "",
    notes: input.notes?.trim() ?? "",
  };
  if (!healthItemKinds.includes(value.kind) || !["active", "inactive", "completed"].includes(value.status) || !["patient", "document"].includes(value.source)) return { error: "Tipo, estado u origen inválido." } as const;
  if (!value.label || value.label.length > 1000) return { error: "El nombre debe tener entre 1 y 1000 caracteres." } as const;
  if (!validDate(value.eventDate)) return { error: "La fecha no es válida." } as const;
  if (value.notes.length > 1000) return { error: "Las notas no pueden superar 1000 caracteres." } as const;
  if (value.source === "document" && !uuid.test(value.sourceDocumentId)) return { error: "Selecciona el documento de origen." } as const;
  return { value } as const;
}

type SearchDocument = {
  id: string; filename: string; documentType: string; sourceInstitution: string; documentDate: string | null; createdAt: string;
  sizeBytes?: number;
  extractedText?: { clinicalIndication: string; technique: string; findings: string; impression: string; fullText: string } | null;
};
export type PhrSearchResult = { id: string; kind: "document" | "lab" | "health"; title: string; detail: string };
const plain = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// ponytail: búsqueda local privada; migrar a PostgreSQL FTS cuando un PHR tenga miles de registros.
export function searchPhrRecords(query: string, documents: SearchDocument[], labs: PhrLabResult[], items: PhrHealthItem[], limit = 20): PhrSearchResult[] {
  const tokens = plain(query).split(" ").filter(Boolean);
  if (!tokens.length || plain(query).length < 2) return [];
  const matches = (text: string) => { const normalized = plain(text); return tokens.every((token) => normalized.includes(token)); };
  const results: PhrSearchResult[] = [];
  for (const item of items) if (matches(`${healthItemKindLabels[item.kind]} ${item.label} ${item.notes} ${item.status}`)) results.push({ id: item.id, kind: "health", title: item.label, detail: `${healthItemKindLabels[item.kind]} · ${healthItemStatusLabels[item.status]}` });
  for (const lab of labs) if (matches(`${phrLabDisplayName(lab)} ${lab.analyte} ${lab.valueNum ?? lab.valueText} ${lab.unit} ${lab.loincCode} ${lab.observedAt}`)) results.push({ id: lab.id, kind: "lab", title: phrLabDisplayName(lab), detail: `${lab.valueNum ?? lab.valueText} ${lab.unit} · ${lab.observedAt}` });
  for (const document of documents) if (matches(`${document.filename} ${document.documentType} ${document.sourceInstitution} ${document.documentDate ?? document.createdAt} ${document.extractedText?.fullText ?? ""}`)) results.push({ id: document.id, kind: "document", title: document.filename, detail: `${document.sourceInstitution} · ${(document.documentDate ?? document.createdAt).slice(0, 10)}` });
  return results.slice(0, limit);
}

export function phrReviewCounts(documents: SearchDocument[], labs: PhrLabResult[]) {
  const analyzed = new Set(labs.map((result) => result.documentId));
  const duplicateGroups = new Map<string, number>();
  for (const document of documents) {
    const key = plain(`${document.filename}|${document.sizeBytes ?? ""}`);
    duplicateGroups.set(key, (duplicateGroups.get(key) ?? 0) + 1);
  }
  return {
    suggestedLabs: labs.filter((result) => result.reviewStatus === "suggested").length,
    unmappedLabs: labs.filter((result) => result.reviewStatus === "suggested" && !result.loincCode).length,
    unanalyzedLabs: documents.filter((document) => document.documentType === "laboratory" && !analyzed.has(document.id)).length,
    imagingWithoutText: documents.filter((document) => document.documentType === "imaging" && !document.extractedText?.fullText).length,
    duplicateDocuments: [...duplicateGroups.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0),
  };
}

export function phrHealthItemFhirResource(item: Pick<PhrHealthItem, "id" | "kind" | "label" | "status" | "eventDate" | "source" | "sourceDocumentId" | "notes" | "createdAt">, ownerId: string): Record<string, unknown> {
  const common = { id: item.id, note: [{ text: [item.source === "patient" ? "Declarado por la persona" : "Vinculado a documento", item.notes].filter(Boolean).join(". ") }] };
  if (item.kind === "allergy") return { resourceType: "AllergyIntolerance", ...common, patient: { reference: `Patient/${ownerId}` }, clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: item.status === "active" ? "active" : "inactive" }] }, code: { text: item.label }, recordedDate: item.eventDate || undefined };
  if (item.kind === "condition") return { resourceType: "Condition", ...common, subject: { reference: `Patient/${ownerId}` }, clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: item.status === "completed" ? "resolved" : item.status }] }, code: { text: item.label }, onsetDateTime: item.eventDate || undefined };
  if (item.kind === "medication") return { resourceType: "MedicationStatement", ...common, subject: { reference: `Patient/${ownerId}` }, status: item.status === "inactive" ? "stopped" : item.status, medicationCodeableConcept: { text: item.label }, effectiveDateTime: item.eventDate || undefined, derivedFrom: item.sourceDocumentId ? [{ reference: `DocumentReference/${item.sourceDocumentId}` }] : undefined };
  if (item.kind === "immunization") return { resourceType: "Immunization", ...common, patient: { reference: `Patient/${ownerId}` }, status: item.status === "inactive" ? "not-done" : "completed", statusReason: item.status === "inactive" ? { text: "Marcada como inactiva por la persona" } : undefined, vaccineCode: { text: item.label }, occurrenceDateTime: item.eventDate || item.createdAt };
  return { resourceType: "Procedure", ...common, subject: { reference: `Patient/${ownerId}` }, status: item.status === "active" ? "in-progress" : item.status === "inactive" ? "stopped" : "completed", code: { text: item.label }, performedDateTime: item.eventDate || undefined };
}
