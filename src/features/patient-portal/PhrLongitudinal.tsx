"use client";

import { useEffect, useMemo, useState } from "react";
import type { PhrHealthItem } from "./health-summary";
import { comparePhrPeriods, type PhrPeriod } from "./longitudinal";
import type { PhrLabResult } from "./labs";
import { PhrHomeTools } from "./PhrHomeTools";
import { documentDate, friendlyDocumentName, latestLaboratory, recentPhrActivity, suggestedResultCount } from "./presentation";
import { fetchPhrFavorites, fetchPhrLabResults, type PortalDocument, type PhrFavorite } from "./repository";

const shownDate = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
const fileSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const isoOffset = (days: number) => { const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); };

function PhrIcon({ name }: { name: "lab" | "review" | "document" | "trend" | "timeline" }) {
  const paths = {
    lab: <><path d="M9 3h6M10 3v5l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" /><path d="M8 14h8" /></>,
    review: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
    document: <><path d="M6 2.5h8l4 4v15H6Z" /><path d="M14 2.5v4h4M9 12h6M9 16h6" /></>,
    trend: <><path d="m4 17 5-5 3 3 7-8" /><path d="M15 7h4v4" /></>,
    timeline: <><circle cx="6" cy="6" r="1.5" /><circle cx="6" cy="12" r="1.5" /><circle cx="6" cy="18" r="1.5" /><path d="M10 6h9M10 12h9M10 18h9" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function useLongitudinal(ownerUserId: string) {
  const [results, setResults] = useState<PhrLabResult[]>([]), [favorites, setFavorites] = useState<PhrFavorite[]>([]), [loading, setLoading] = useState(true);
  useEffect(() => { setLoading(true); Promise.all([fetchPhrLabResults(ownerUserId), fetchPhrFavorites(ownerUserId)]).then(([nextResults, nextFavorites]) => { setResults(nextResults); setFavorites(nextFavorites); }).catch(() => undefined).finally(() => setLoading(false)); }, [ownerUserId]);
  return { results, confirmed: results.filter((result) => result.reviewStatus === "confirmed"), favorites, loading };
}

type DashboardTarget = "resumen" | "laboratorios" | "documentos" | "timeline";

export function PhrDashboard({ ownerUserId, documents, healthItems, onNavigate }: { ownerUserId: string; documents: PortalDocument[]; healthItems: PhrHealthItem[]; onNavigate: (target: DashboardTarget) => void }) {
  const { results, favorites, loading } = useLongitudinal(ownerUserId);
  const latestLab = latestLaboratory(documents);
  const pending = suggestedResultCount(results);
  const activity = useMemo(() => recentPhrActivity(documents, results), [documents, results]);
  const recentDocuments = useMemo(() => [...documents].sort((a, b) => documentDate(b).localeCompare(documentDate(a))).slice(0, 3), [documents]);
  const cards = [
    { label: "Último examen", value: latestLab ? friendlyDocumentName(latestLab.documentType) : "Sin exámenes", detail: latestLab ? `${shownDate(documentDate(latestLab))} · ${latestLab.sourceInstitution}` : "Sube tu primer resultado", icon: "lab" as const, tone: "mint", target: "documentos" as const },
    { label: "Resultados por revisar", value: loading ? "—" : String(pending), detail: pending ? "Revisar resultados" : "No tienes resultados pendientes", icon: "review" as const, tone: "peach", target: "laboratorios" as const },
    { label: "Documentos", value: String(documents.length), detail: "Ver documentos", icon: "document" as const, tone: "lavender", target: "documentos" as const },
    { label: "Biomarcadores", value: loading ? "—" : String(favorites.length), detail: "Ver biomarcadores", icon: "trend" as const, tone: "aqua", target: "laboratorios" as const },
  ];

  return <>
    <section className="phr-app-summary" aria-label="Resumen de Mi Salud">
      {cards.map((card) => <button className="phr-app-summary-card" type="button" key={card.label} onClick={() => onNavigate(card.target)}>
        <span className={`phr-app-icon ${card.tone}`}><PhrIcon name={card.icon} /></span>
        <span><small>{card.label}</small><strong>{card.value}</strong><span>{card.detail}</span></span>
      </button>)}
    </section>
    <PhrHomeTools documents={documents} labs={results} healthItems={healthItems} onNavigate={onNavigate} />
    <section className="phr-app-home-grid">
      <article className="phr-app-panel">
        <div className="phr-app-section-heading"><h2>Actividad reciente</h2>{activity.length > 0 && <button type="button" onClick={() => onNavigate("timeline")}>Ver todo</button>}</div>
        {activity.length ? <ul className="phr-app-feed">{activity.map((event) => <li key={event.id}>
          <span className="phr-app-row-icon"><PhrIcon name={event.target === "results" ? "review" : "document"} /></span>
          <div><strong>{event.title}</strong><span>{event.detail}</span></div><time>{shownDate(event.date)}</time>
          {event.target === "document" && event.document ? <a href={event.document.url} target="_blank" rel="noreferrer" aria-label={`Abrir ${event.document.filename}`} title={event.document.filename}>›</a> : <button type="button" onClick={() => onNavigate("laboratorios")} aria-label="Ver resultados">›</button>}
        </li>)}</ul> : <p className="phr-app-empty">Tu actividad aparecerá cuando agregues un documento.</p>}
        {activity.length > 0 && <button className="phr-app-panel-action" type="button" onClick={() => onNavigate("timeline")}><PhrIcon name="timeline" /> Ver toda la actividad</button>}
      </article>
      <article className="phr-app-panel">
        <div className="phr-app-section-heading"><h2>Documentos recientes</h2>{recentDocuments.length > 0 && <button type="button" onClick={() => onNavigate("documentos")}>Ver todos</button>}</div>
        {recentDocuments.length ? <ul className="phr-app-documents">{recentDocuments.map((document) => <li key={document.id}>
          <span className="phr-app-row-icon"><PhrIcon name="document" /></span><div><strong title={document.filename}>{friendlyDocumentName(document.documentType)}</strong><span>{document.sourceInstitution} · {shownDate(documentDate(document))} · {fileSize(document.sizeBytes)}</span></div>
          <a href={document.url} target="_blank" rel="noreferrer" aria-label={`Abrir ${document.filename}`} title={document.filename}>Abrir</a>
        </li>)}</ul> : <p className="phr-app-empty">Todavía no tienes documentos.</p>}
      </article>
    </section>
  </>;
}

export function PhrPeriodComparison({ results }: { results: PhrLabResult[] }) {
  const [first, setFirst] = useState<PhrPeriod>({ from: isoOffset(-365), to: isoOffset(-181) });
  const [second, setSecond] = useState<PhrPeriod>({ from: isoOffset(-180), to: isoOffset(0) });
  const comparison = useMemo(() => comparePhrPeriods(results, first, second), [results, first, second]);
  return <details className="card portal-card phr-period-comparison"><summary>Comparar períodos</summary><div className="phr-periods"><fieldset><legend>Período 1</legend><label>Desde<input type="date" value={first.from} onChange={(event) => setFirst({ ...first, from: event.target.value })} /></label><label>Hasta<input type="date" value={first.to} onChange={(event) => setFirst({ ...first, to: event.target.value })} /></label></fieldset><fieldset><legend>Período 2</legend><label>Desde<input type="date" value={second.from} onChange={(event) => setSecond({ ...second, from: event.target.value })} /></label><label>Hasta<input type="date" value={second.to} onChange={(event) => setSecond({ ...second, to: event.target.value })} /></label></fieldset></div>
    {comparison.length ? <div className="table-wrap"><table><thead><tr><th>Biomarcador</th><th>Período 1</th><th>Período 2</th><th>Diferencia</th></tr></thead><tbody>{comparison.map((row) => <tr key={row.key}><td>{row.analyte}</td><td>{row.first === null ? "—" : `${row.first.toLocaleString("es-CL")} ${row.unit}`}</td><td>{row.second === null ? "—" : `${row.second.toLocaleString("es-CL")} ${row.unit}`}</td><td>{row.change === null ? "No comparable" : `${row.change > 0 ? "+" : ""}${row.change.toLocaleString("es-CL")} ${row.unit}`}</td></tr>)}</tbody></table></div> : <p className="empty-state">No hay mediciones comparables en esos períodos.</p>}
  </details>;
}

export function PhrTimeline({ ownerUserId, documents }: { ownerUserId: string; documents: PortalDocument[] }) {
  const { confirmed } = useLongitudinal(ownerUserId);
  const samples = new Map<string, PhrLabResult[]>();
  for (const result of confirmed) samples.set(result.observedAt, [...(samples.get(result.observedAt) ?? []), result]);
  const events = [
    ...documents.map((document) => ({ id: `doc-${document.id}`, date: documentDate(document).slice(0, 10), kind: "Documento", title: friendlyDocumentName(document.documentType), detail: document.sourceInstitution })),
    ...[...samples].map(([date, rows]) => ({ id: `sample-${date}`, date, kind: "Muestra", title: `${rows.length} resultado(s) confirmado(s)`, detail: rows.slice(0, 4).map((row) => row.analyte).join(" · ") })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  return <section className="card portal-card"><p className="eyebrow">Documentos y muestras</p><h2>Línea de tiempo</h2>{events.length ? <ol className="phr-timeline">{events.map((event) => <li key={event.id}><time>{shownDate(event.date)}</time><div><span className="status-badge">{event.kind}</span><strong>{event.title}</strong><p>{event.detail}</p></div></li>)}</ol> : <p className="empty-state">La línea de tiempo aparecerá al cargar documentos o confirmar resultados.</p>}</section>;
}
