import type { PhrLabResult } from "./labs.ts";
import type { PortalDocument } from "./repository.ts";

export const phrTabs = [["inicio", "Inicio"], ["laboratorios", "Resultados"], ["documentos", "Documentos"], ["timeline", "Línea de tiempo"], ["compartir", "Compartir"], ["perfil", "Perfil y seguridad"]] as const;
export type PhrTab = (typeof phrTabs)[number][0];
export const visiblePhrTabs = (readOnly: boolean) => readOnly ? phrTabs.filter(([id]) => id !== "compartir") : [...phrTabs];

export const friendlyDocumentName = (type: PortalDocument["documentType"]) => ({
  laboratory: "Resultado de laboratorio",
  imaging: "Informe de radiología o imagenología",
  prescription: "Receta u orden médica",
  other: "Documento de salud",
})[type];

export const documentDate = (document: PortalDocument) => document.documentDate ?? document.createdAt;

export function latestLaboratory(documents: PortalDocument[]) {
  return documents.filter((document) => document.documentType === "laboratory")
    .sort((a, b) => documentDate(b).localeCompare(documentDate(a)))[0];
}

export const suggestedResultCount = (results: PhrLabResult[]) =>
  results.filter((result) => result.reviewStatus === "suggested").length;

export type PhrActivity = {
  id: string;
  date: string;
  title: string;
  detail: string;
  document?: PortalDocument;
  target: "document" | "results";
};

export function recentPhrActivity(documents: PortalDocument[], results: PhrLabResult[], limit = 4): PhrActivity[] {
  const resultsByDocument = new Map<string, PhrLabResult[]>();
  for (const result of results) resultsByDocument.set(result.documentId, [...(resultsByDocument.get(result.documentId) ?? []), result]);

  return documents.map((document): PhrActivity => {
    const rows = resultsByDocument.get(document.id) ?? [];
    const confirmed = rows.filter((result) => result.reviewStatus === "confirmed").length;
    const suggested = rows.filter((result) => result.reviewStatus === "suggested").length;
    return {
      id: document.id,
      date: documentDate(document),
      title: confirmed ? "Resultados de laboratorio confirmados" : document.documentType === "laboratory" ? "Resultado de laboratorio incorporado" : "Documento agregado",
      detail: confirmed ? `${confirmed} resultado${confirmed === 1 ? "" : "s"} · ${document.sourceInstitution}`
        : suggested ? `${suggested} resultado${suggested === 1 ? "" : "s"} por revisar · ${document.sourceInstitution}` : document.sourceInstitution,
      document,
      target: confirmed || suggested ? "results" : "document",
    };
  }).sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}
