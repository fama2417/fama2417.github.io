"use client";

import { useEffect, useMemo, useState } from "react";
import { comparePhrPeriods, isOutsideReportedRange, reportedRangeLabel, type PhrPeriod } from "./longitudinal";
import { phrLabTrendKey, type PhrLabResult } from "./labs";
import { fetchPhrFavorites, fetchPhrLabResults, type PortalDocument, type PhrFavorite } from "./repository";

const shownDate = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
const resultValue = (result: PhrLabResult) => `${result.valueNum ?? result.valueText}${result.unit ? ` ${result.unit}` : ""}`;
const isoOffset = (days: number) => { const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); };

function useLongitudinal(ownerUserId: string) {
  const [results, setResults] = useState<PhrLabResult[]>([]), [favorites, setFavorites] = useState<PhrFavorite[]>([]);
  useEffect(() => { Promise.all([fetchPhrLabResults(ownerUserId), fetchPhrFavorites(ownerUserId)]).then(([nextResults, nextFavorites]) => { setResults(nextResults); setFavorites(nextFavorites); }).catch(() => undefined); }, [ownerUserId]);
  return { results: results.filter((result) => result.reviewStatus === "confirmed"), favorites };
}

export function PhrDashboard({ ownerUserId, documents }: { ownerUserId: string; documents: PortalDocument[] }) {
  const { results, favorites } = useLongitudinal(ownerUserId);
  const [first, setFirst] = useState<PhrPeriod>({ from: isoOffset(-365), to: isoOffset(-181) });
  const [second, setSecond] = useState<PhrPeriod>({ from: isoOffset(-180), to: isoOffset(0) });
  const latestLab = documents.find((document) => document.documentType === "laboratory");
  const outside = results.filter(isOutsideReportedRange).slice(0, 5);
  const favoriteKeys = new Set(favorites.map((favorite) => favorite.trendKey));
  const favoriteLatest = results.filter((result, index, all) => favoriteKeys.has(phrLabTrendKey(result)) && all.findIndex((item) => phrLabTrendKey(item) === phrLabTrendKey(result)) === index);
  const comparison = useMemo(() => comparePhrPeriods(results, first, second), [results, first, second]);
  return <>
    <section className="stats-grid portal-tiles phr-dashboard-tiles">
      <article className="stat-card"><span>Último laboratorio</span><strong>{latestLab ? shownDate(latestLab.documentDate ?? latestLab.createdAt) : "—"}</strong><small>{latestLab?.sourceInstitution ?? "Sin laboratorios"}</small></article>
      <article className="stat-card"><span>Fuera del rango informado</span><strong>{outside.length}</strong><small>Entre los resultados confirmados recientes</small></article>
      <article className="stat-card"><span>Biomarcadores favoritos</span><strong>{favorites.length}</strong><small>Seguimiento personal</small></article>
      <article className="stat-card"><span>Documentos</span><strong>{documents.length}</strong><small>{documents.slice(0, 3).map((document) => document.sourceInstitution).join(" · ") || "Sin documentos"}</small></article>
    </section>
    <section className="phr-dashboard-grid">
      <article className="card portal-card"><p className="eyebrow">Atención descriptiva</p><h2>Resultados fuera del rango informado</h2>{outside.length ? <ul className="phr-compact-results">{outside.map((result) => <li key={result.id}><div><strong>{result.analyte}</strong><span>{shownDate(result.observedAt)}</span></div><div><strong>{resultValue(result)}</strong><span>{reportedRangeLabel(result)}</span></div></li>)}</ul> : <p className="empty-state">No hay resultados confirmados fuera del rango informado por el laboratorio.</p>}</article>
      <article className="card portal-card"><p className="eyebrow">Favoritos</p><h2>Biomarcadores seguidos</h2>{favoriteLatest.length ? <ul className="phr-compact-results">{favoriteLatest.map((result) => <li key={result.id}><div><strong>{result.analyte}</strong><span>{shownDate(result.observedAt)}</span></div><strong>{resultValue(result)}</strong></li>)}</ul> : <p className="empty-state">Marca biomarcadores como favoritos desde Laboratorios.</p>}</article>
    </section>
    <section className="card portal-card"><p className="eyebrow">Comparación longitudinal</p><h2>Comparar períodos</h2><div className="phr-periods"><fieldset><legend>Período 1</legend><label>Desde<input type="date" value={first.from} onChange={(event) => setFirst({ ...first, from: event.target.value })} /></label><label>Hasta<input type="date" value={first.to} onChange={(event) => setFirst({ ...first, to: event.target.value })} /></label></fieldset><fieldset><legend>Período 2</legend><label>Desde<input type="date" value={second.from} onChange={(event) => setSecond({ ...second, from: event.target.value })} /></label><label>Hasta<input type="date" value={second.to} onChange={(event) => setSecond({ ...second, to: event.target.value })} /></label></fieldset></div>
      {comparison.length ? <div className="table-wrap"><table><thead><tr><th>Biomarcador</th><th>Período 1</th><th>Período 2</th><th>Diferencia</th></tr></thead><tbody>{comparison.map((row) => <tr key={row.key}><td>{row.analyte}</td><td>{row.first === null ? "—" : `${row.first.toLocaleString("es-CL")} ${row.unit}`}</td><td>{row.second === null ? "—" : `${row.second.toLocaleString("es-CL")} ${row.unit}`}</td><td>{row.change === null ? "No comparable" : `${row.change > 0 ? "+" : ""}${row.change.toLocaleString("es-CL")} ${row.unit}`}</td></tr>)}</tbody></table></div> : <p className="empty-state">No hay mediciones comparables en esos períodos.</p>}
    </section>
    <section className="card portal-card"><h2>Documentos recientes</h2>{documents.length ? <ul className="portal-list">{documents.slice(0, 4).map((document) => <li key={document.id}><div className="portal-document-detail"><strong>{document.filename}</strong><span>{document.sourceInstitution} · {shownDate(document.documentDate ?? document.createdAt)}</span></div><a className="button secondary" href={document.url} target="_blank" rel="noreferrer">Abrir</a></li>)}</ul> : <p className="empty-state">Todavía no tienes documentos.</p>}</section>
  </>;
}

export function PhrTimeline({ ownerUserId, documents }: { ownerUserId: string; documents: PortalDocument[] }) {
  const { results } = useLongitudinal(ownerUserId);
  const samples = new Map<string, PhrLabResult[]>();
  for (const result of results) samples.set(result.observedAt, [...(samples.get(result.observedAt) ?? []), result]);
  const events = [
    ...documents.map((document) => ({ id: `doc-${document.id}`, date: (document.documentDate ?? document.createdAt).slice(0, 10), kind: "Documento", title: document.filename, detail: document.sourceInstitution })),
    ...[...samples].map(([date, rows]) => ({ id: `sample-${date}`, date, kind: "Muestra", title: `${rows.length} resultado(s) confirmado(s)`, detail: rows.slice(0, 4).map((row) => row.analyte).join(" · ") })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  return <section className="card portal-card"><p className="eyebrow">Documentos y muestras</p><h2>Línea de tiempo</h2>{events.length ? <ol className="phr-timeline">{events.map((event) => <li key={event.id}><time>{shownDate(event.date)}</time><div><span className="status-badge">{event.kind}</span><strong>{event.title}</strong><p>{event.detail}</p></div></li>)}</ol> : <p className="empty-state">La línea de tiempo aparecerá al cargar documentos o confirmar resultados.</p>}</section>;
}
