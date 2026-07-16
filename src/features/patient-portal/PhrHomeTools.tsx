"use client";

import { useMemo, useState } from "react";
import { phrReviewCounts, searchPhrRecords, type PhrHealthItem } from "./health-summary";
import type { PhrLabResult } from "./labs";
import type { PortalDocument } from "./repository";

type Target = "resumen" | "laboratorios" | "documentos";

export function PhrHomeTools({ documents, labs, healthItems, onNavigate }: { documents: PortalDocument[]; labs: PhrLabResult[]; healthItems: PhrHealthItem[]; onNavigate: (target: Target) => void }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchPhrRecords(query, documents, labs, healthItems), [query, documents, labs, healthItems]);
  const counts = useMemo(() => phrReviewCounts(documents, labs), [documents, labs]);
  const tasks = [
    { count: counts.suggestedLabs, label: "Resultados por confirmar", target: "laboratorios" as const },
    { count: counts.unmappedLabs, label: "Resultados pendientes de LOINC", target: "laboratorios" as const },
    { count: counts.unanalyzedLabs, label: "Laboratorios sin analizar", target: "laboratorios" as const },
    { count: counts.imagingWithoutText, label: "Informes radiológicos sin texto extraído", target: "documentos" as const },
    { count: counts.duplicateDocuments, label: "Posibles documentos duplicados", target: "documentos" as const },
  ].filter((task) => task.count > 0);
  const documentById = new Map(documents.map((document) => [document.id, document]));

  return <section className="phr-home-tools">
    <article className="phr-app-panel phr-global-search"><div className="phr-app-section-heading"><h2>Buscar en mi salud</h2><span>Privado</span></div><label><span className="sr-only">Buscar documentos, resultados o antecedentes</span><input type="search" value={query} placeholder="Ej: creatinina, rodilla o vacuna" onChange={(event) => setQuery(event.target.value)} /></label>{query.trim().length < 2 ? <p className="phr-app-empty">Busca en documentos, texto radiológico, laboratorios y antecedentes.</p> : results.length ? <ul>{results.map((result) => { const document = result.kind === "document" ? documentById.get(result.id) : undefined; return <li key={`${result.kind}-${result.id}`}><div><span className="status-badge">{result.kind === "document" ? "Documento" : result.kind === "lab" ? "Laboratorio" : "Resumen"}</span><strong>{result.title}</strong><small>{result.detail}</small></div>{document ? <a href={document.url} target="_blank" rel="noreferrer">Abrir</a> : <button type="button" onClick={() => onNavigate(result.kind === "lab" ? "laboratorios" : "resumen")}>Ver</button>}</li>; })}</ul> : <p className="phr-app-empty">No encontramos coincidencias.</p>}</article>
    <article className="phr-app-panel phr-review-inbox"><div className="phr-app-section-heading"><h2>Bandeja de revisión</h2><span>{tasks.length}</span></div>{tasks.length ? <ul>{tasks.map((task) => <li key={task.label}><button type="button" onClick={() => onNavigate(task.target)}><span>{task.count}</span><strong>{task.label}</strong><span aria-hidden="true">›</span></button></li>)}</ul> : <p className="phr-app-empty">Todo al día. No tienes elementos pendientes.</p>}</article>
  </section>;
}
