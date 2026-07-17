"use client";

import { useState } from "react";
import { PHR_CLINICAL_AREAS, PHR_CLINICAL_AREA_LABELS, type PhrClinicalArea } from "./documents";
import { PhrLaboratories } from "./PhrLaboratories";
import type { PortalDocument } from "./repository";

const shownDate = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
const imagingMime = (document: PortalDocument) => ["application/pdf", "image/jpeg", "image/png"].includes(document.mimeType);

function ImagingResults({ documents, readOnly, onImaging }: { documents: PortalDocument[]; readOnly: boolean; onImaging: (document: PortalDocument) => void }) {
  const pending = documents.filter((document) => !document.extractedText), organized = documents.filter((document) => document.extractedText);
  return <div className="phr-labs-stack">
    <section className="card portal-card"><div className="card-heading"><div><p className="eyebrow">Paso 1 · Extraer y revisar</p><h2>Informes por organizar</h2><p>Leemos el documento, separamos indicación, técnica, hallazgos y conclusión. Nada se guarda hasta que lo confirmas.</p></div></div>
      {!documents.length ? <p className="empty-state">Todavía no tienes informes de imagenología.</p> : pending.length ? <ul className="portal-list">{pending.map((document) => <li key={document.id}><div className="portal-document-detail"><strong>Informe de imagenología</strong><span>{document.sourceInstitution || "Institución no informada"} · {shownDate(document.documentDate ?? document.createdAt)}</span></div><div className="portal-document-actions"><a className="button secondary" href={document.url} target="_blank" rel="noreferrer">Abrir original</a>{!readOnly && imagingMime(document) && <button className="button primary" type="button" onClick={() => onImaging(document)}>Extraer y organizar</button>}</div></li>)}</ul> : <p className="phr-processed-summary">✓ Todos tus informes están organizados.</p>}
    </section>

    {!!organized.length && <section className="card portal-card"><p className="eyebrow">Paso 2 · Consultar</p><h2>Mis informes organizados</h2><p>La conclusión se conserva tal como fue informada. La explicación simple aclara términos sin agregar diagnósticos.</p><div className="phr-imaging-list">{organized.map((document) => <article key={document.id}><div className="phr-imaging-card-heading"><div><h3>Informe de imagenología</h3><span>{document.sourceInstitution || "Institución no informada"} · {shownDate(document.documentDate ?? document.createdAt)}</span></div><span className="status-badge">{document.extractedText?.plainLanguage ? "Explicación lista" : "Texto organizado"}</span></div>{document.extractedText?.impression ? <div className="phr-imaging-card-impression"><span>Conclusión original</span><p>{document.extractedText.impression}</p></div> : <p className="phr-measurement-help">El documento fue organizado, pero no traía una conclusión separada.</p>}<div className="phr-actions"><a className="button secondary" href={document.url} target="_blank" rel="noreferrer">Abrir original</a>{!readOnly && imagingMime(document) && <button className="button primary" type="button" onClick={() => onImaging(document)}>{document.extractedText?.plainLanguage ? "Ver explicación simple" : "Completar explicación"}</button>}</div></article>)}</div></section>}
  </div>;
}

export function PhrResults({ documents, ownerUserId, readOnly, onUpload, onImaging }: { documents: PortalDocument[]; ownerUserId: string; readOnly: boolean; onUpload: () => void; onImaging: (document: PortalDocument) => void }) {
  const [area, setArea] = useState<PhrClinicalArea>("laboratory");
  const results = documents.filter((document) => document.documentType !== "prescription");
  const counts = new Map(PHR_CLINICAL_AREAS.map((key) => [key, results.filter((document) => document.clinicalArea === key).length]));
  const selected = results.filter((document) => document.clinicalArea === area);

  return <div className="phr-results-stack">
    <section className="card portal-card"><div className="card-heading"><div><p className="eyebrow">Resultados por área clínica</p><h2>Mis resultados</h2><p>Laboratorio, imagenología y otros informes quedan separados por el área que los emitió.</p></div>{!readOnly && <button className="button primary" type="button" onClick={onUpload}>Subir resultado</button>}</div>
      <div className="phr-result-area-nav" role="tablist" aria-label="Áreas clínicas">{PHR_CLINICAL_AREAS.map((key) => <button key={key} type="button" role="tab" aria-selected={area === key} className={`filter-chip${area === key ? " active" : ""}`} onClick={() => setArea(key)}>{PHR_CLINICAL_AREA_LABELS[key]} <span>{counts.get(key) ?? 0}</span></button>)}</div>
    </section>

    {area === "laboratory" ? <PhrLaboratories documents={documents} ownerUserId={ownerUserId} readOnly={readOnly} onUpload={onUpload} hideHeading /> : area === "imaging" ? <ImagingResults documents={selected} readOnly={readOnly} onImaging={onImaging} /> : <section className="card portal-card"><p className="eyebrow">{PHR_CLINICAL_AREA_LABELS[area]}</p><h2>Informes y documentos</h2>{selected.length ? <ul className="portal-list">{selected.map((document) => <li key={document.id}><div className="portal-document-detail"><strong>{document.filename}</strong><span>{document.sourceInstitution} · {shownDate(document.documentDate ?? document.createdAt)}</span></div><div className="portal-document-actions"><a className="button secondary" href={document.url} target="_blank" rel="noreferrer">Abrir archivo</a></div></li>)}</ul> : <p className="empty-state">Todavía no tienes resultados de {PHR_CLINICAL_AREA_LABELS[area].toLocaleLowerCase("es-CL")}.</p>}</section>}
  </div>;
}
