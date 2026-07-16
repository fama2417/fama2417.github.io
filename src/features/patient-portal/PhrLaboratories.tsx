"use client";

import { useEffect, useMemo, useState } from "react";
import { labCategory, labCategoryLabels, labCategoryOrder, labFlagLabels, type LabCategory } from "@/features/reports/lab-observations.ts";
import { buildPhrLabTrend, phrLabDraftOf, phrLabTrendKey, phrSpecimenLabel, type PhrLabDraft, type PhrLabResult } from "./labs";
import { measurementExplanation, reportedRangeLabel } from "./longitudinal";
import { PhrPeriodComparison } from "./PhrLongitudinal";
import { isAnalyzableLabDocument } from "./documents";
import { friendlyDocumentName } from "./presentation";
import { analyzePhrLabDocument, confirmPhrLabResults, discardPhrLabResult, downloadPhrFile, fetchPhrFavorites, fetchPhrLabResults, fetchPhrLabSource, fetchPhrLoincSuggestions, savePhrLabResult, savePhrLoincSelections, setPhrFavorite, type PortalDocument, type PhrFavorite, type PhrLoincSuggestion } from "./repository";

const resultValue = (result: PhrLabResult) => `${result.valueNum ?? result.valueText}${result.unit ? ` ${result.unit}` : ""}`;
const reference = (result: PhrLabResult) => result.refLow !== null || result.refHigh !== null ? `${result.refLow ?? "…"}–${result.refHigh ?? "…"}` : result.refText;
const shownDate = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
const resultCategory = (result: PhrLabResult) => phrSpecimenLabel(result.loincMetadata, result.sourceSentence) === "Orina" ? "urine" : labCategory({ analyte: result.analyte, loincMetadata: result.loincMetadata });

function SuggestedResult({ result, busy, selected, onSource, onDone, onError }: { result: PhrLabResult; busy: boolean; selected: boolean; onSource: (result: PhrLabResult) => Promise<void>; onDone: (message: string) => Promise<void>; onError: (message: string) => void }) {
  const [draft, setDraft] = useState<PhrLabDraft>(() => phrLabDraftOf(result));
  const change = (patch: Partial<PhrLabDraft>) => setDraft((current) => ({ ...current, ...patch }));
  async function save(confirm: boolean) {
    try { await savePhrLabResult(result.id, draft, confirm); await onDone(confirm ? "Resultado confirmado." : "Corrección guardada."); }
    catch (cause) { onError(cause instanceof Error ? cause.message : "No fue posible guardar el resultado."); }
  }
  async function discard() {
    if (!window.confirm(`¿Descartar la sugerencia «${result.analyte}»?`)) return;
    try { await discardPhrLabResult(result.id); await onDone("Sugerencia descartada."); }
    catch (cause) { onError(cause instanceof Error ? cause.message : "No fue posible descartar el resultado."); }
  }
  return <article className={`phr-lab-review-card${selected ? " selected" : ""}`}>
    <div className="phr-lab-review-grid">
      <label>Analito<input value={draft.analyte} maxLength={160} onChange={(event) => change({ analyte: event.target.value })} /></label>
      <label>Resultado<input value={draft.value} maxLength={80} onChange={(event) => change({ value: event.target.value })} /></label>
      <label>Unidad<input value={draft.unit} maxLength={32} onChange={(event) => change({ unit: event.target.value })} /></label>
      <label>Referencia<input value={draft.reference} maxLength={120} onChange={(event) => change({ reference: event.target.value })} /></label>
      <label>Fecha<input type="date" value={draft.observedAt} onChange={(event) => change({ observedAt: event.target.value })} /></label>
    </div>
    <div className="phr-lab-review-meta"><span className={`lab-flag lab-flag-${result.flag || "none"}`}>{labFlagLabels[result.flag]}</span><span>{result.source === "ai" ? "Extracción automática" : "Lectura local del PDF"}</span><span className="phr-loinc-badge">{result.loincCode ? `LOINC ${result.loincCode}` : "Sin LOINC"}</span><span>{phrSpecimenLabel(result.loincMetadata, result.sourceSentence)}</span></div>
    <div className="phr-actions"><button className="button secondary" disabled={busy} type="button" onClick={() => void onSource(result)}>Ver original</button><button className="button secondary" disabled={busy} type="button" onClick={() => void save(false)}>Guardar corrección</button><button className="button primary" disabled={busy} type="button" onClick={() => void save(true)}>Confirmar</button><button className="text-button danger-text" disabled={busy} type="button" onClick={() => void discard()}>Descartar</button></div>
  </article>;
}

function TrendChart({ result, all }: { result: PhrLabResult; all: PhrLabResult[] }) {
  const trend = buildPhrLabTrend(all.filter((item) => phrLabTrendKey(item) === phrLabTrendKey(result)));
  if (!trend) return null;
  const values = trend.points.map((point) => point.value), min = Math.min(...values), max = Math.max(...values), spread = max - min || 1;
  const points = trend.points.map((point, index) => `${20 + index * (280 / (trend.points.length - 1))},${100 - ((point.value - min) / spread) * 75}`).join(" ");
  const latest = trend.points[trend.points.length - 1];
  return <article className="phr-trend-card">
    <div><strong>{trend.analyte}</strong><span>{latest.value.toLocaleString("es-CL")} {trend.unit}</span></div>
    <svg viewBox="0 0 320 120" role="img" aria-label={`Tendencia de ${trend.analyte}`}><title>Tendencia de {trend.analyte}</title><polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />{trend.points.map((point, index) => <circle key={point.id} cx={20 + index * (280 / (trend.points.length - 1))} cy={100 - ((point.value - min) / spread) * 75} r="4"><title>{shownDate(point.date)}: {point.value} {trend.unit}</title></circle>)}</svg>
    <small>{shownDate(trend.points[0].date)} → {shownDate(latest.date)} · {trend.points.length} mediciones</small>
  </article>;
}

export function PhrLaboratories({ documents, ownerUserId, readOnly, onUpload }: { documents: PortalDocument[]; ownerUserId: string; readOnly: boolean; onUpload: () => void }) {
  const [results, setResults] = useState<PhrLabResult[]>([]), [loading, setLoading] = useState(true), [busyId, setBusyId] = useState("");
  const [favorites, setFavorites] = useState<PhrFavorite[]>([]), [filter, setFilter] = useState<LabCategory | "all">("all");
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [source, setSource] = useState<{ resultId: string; url: string; contentType: string; highlighted: boolean; page: number }>();
  const [loincDialog, setLoincDialog] = useState<{ documentId: string; suggestions: PhrLoincSuggestion[]; warnings: string[] }>();
  const [loincSelections, setLoincSelections] = useState<Record<string, string>>({});
  const labs = documents.filter((document) => document.documentType === "laboratory");
  async function reload() { const [nextResults, nextFavorites] = await Promise.all([fetchPhrLabResults(ownerUserId), fetchPhrFavorites(ownerUserId)]); setResults(nextResults); setFavorites(nextFavorites); setLoading(false); }
  useEffect(() => { reload().catch(() => { setError("No fue posible cargar los resultados."); setLoading(false); }); }, [ownerUserId, documents.map((document) => document.id).join("|")]);
  useEffect(() => () => { if (source?.url) URL.revokeObjectURL(source.url); }, [source?.url]);

  async function analyze(document: PortalDocument, rematch = false, rescan = false) {
    setBusyId(document.id); setError(""); setNotice("");
    try {
      const response = await analyzePhrLabDocument(document.id, rematch, rescan); await reload();
      setNotice(`${rescan ? `Relectura completada: ${response.created} resultado(s) nuevo(s).` : rematch ? `Agrupación actualizada: ${response.loincMapped} resultado(s) con LOINC.` : response.duplicate ? "Este archivo ya estaba analizado." : `${response.created} resultado(s) listos para revisión.`}${response.warnings.length ? ` ${response.warnings.join(" ")}` : ""}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible analizar el laboratorio."); }
    finally { setBusyId(""); }
  }
  async function changed(message: string) { setBusyId("refresh"); await reload(); setBusyId(""); setNotice(message); setError(""); }
  async function openLoinc(document: PortalDocument) {
    setBusyId(document.id); setError(""); setNotice("");
    try {
      const result = await fetchPhrLoincSuggestions(document.id);
      setLoincDialog({ documentId: document.id, ...result });
      setLoincSelections(Object.fromEntries(result.suggestions.filter((item) => item.options[0]).map((item) => [item.resultId, item.options[0].code])));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible obtener sugerencias LOINC."); }
    finally { setBusyId(""); }
  }
  async function applyLoinc() {
    const selections = Object.entries(loincSelections).filter(([, code]) => code).map(([resultId, loincCode]) => ({ resultId, loincCode }));
    if (!selections.length) return;
    setBusyId("loinc"); setError("");
    try { const response = await savePhrLoincSelections(selections); await reload(); setLoincDialog(undefined); setNotice(`${response.updated} código(s) LOINC guardados después de tu revisión.`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible guardar los códigos LOINC."); }
    finally { setBusyId(""); }
  }
  async function openSource(result: PhrLabResult) {
    setBusyId(result.id); setError("");
    try { const next = await fetchPhrLabSource(result.id); setSource({ resultId: result.id, ...next }); if (!next.highlighted) setNotice(next.contentType.startsWith("image/") ? "Se abrió la fotografía original para contrastar el resultado." : "Se abrió el PDF original, pero este resultado no tiene coordenadas de texto para resaltarlo."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible abrir el documento fuente."); }
    finally { setBusyId(""); }
  }
  async function confirmAll() {
    if (!window.confirm(`¿Confirmar los ${suggested.length} resultados tal como fueron extraídos? Las correcciones que no hayas guardado no se aplicarán.`)) return;
    setBusyId("confirm-all"); setError("");
    try { const response = await confirmPhrLabResults(suggested.map((result) => result.id)); await reload(); setNotice(`${response.confirmed} resultados confirmados.`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible confirmar los resultados."); }
    finally { setBusyId(""); }
  }
  async function toggleFavorite(result: PhrLabResult) {
    const trendKey = phrLabTrendKey(result), favorite = !favorites.some((item) => item.trendKey === trendKey);
    try { await setPhrFavorite(trendKey, result.analyte, favorite); await reload(); setNotice(favorite ? "Biomarcador agregado a favoritos." : "Biomarcador quitado de favoritos."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible actualizar el favorito."); }
  }

  const suggested = results.filter((result) => result.reviewStatus === "suggested");
  const confirmed = results.filter((result) => result.reviewStatus === "confirmed");
  const analyzedDocuments = new Set(results.map((result) => result.documentId));
  const unmappedDocuments = new Set(results.filter((result) => !result.loincCode).map((result) => result.documentId));
  const suggestedCategories = labCategoryOrder.map((key) => ({ key, items: suggested.filter((result) => resultCategory(result) === key) })).filter((group) => group.items.length);
  const categories = labCategoryOrder.map((key) => ({ key, items: confirmed.filter((result) => resultCategory(result) === key && (filter === "all" || filter === key)) })).filter((group) => group.items.length);
  const trends = useMemo(() => {
    const seen = new Set<string>();
    return confirmed.filter((result) => { const key = phrLabTrendKey(result); if (seen.has(key)) return false; seen.add(key); return !!buildPhrLabTrend(confirmed.filter((item) => phrLabTrendKey(item) === key)); });
  }, [confirmed]);

  return <div className="phr-labs-stack">
    {error && <p className="notice danger-text" role="alert">{error}</p>}{notice && <p className="form-notice" role="status">{notice}</p>}
    <section className="card portal-card"><div className="card-heading"><div><p className="eyebrow">Extracción segura</p><h2>Mis laboratorios</h2><p>Los PDF se leen sólo localmente y las fotos JPG/PNG usan reconocimiento visual. El archivo original no cambia y ningún resultado cuenta hasta que lo confirmas.</p></div>{!readOnly && <button className="button primary" type="button" onClick={onUpload}>Subir laboratorio</button>}</div>
      {!labs.length ? <p className="empty-state">Todavía no tienes laboratorios.</p> : <ul className="portal-list">{labs.map((document) => <li key={document.id}><div className="portal-document-detail"><strong title={document.filename}>{friendlyDocumentName(document.documentType)}</strong><span>{document.sourceInstitution} · {shownDate(document.documentDate ?? document.createdAt)} · {document.filename}</span></div><div className="portal-document-actions"><a className="button secondary" href={document.url} target="_blank" rel="noreferrer">Abrir archivo</a>{!isAnalyzableLabDocument(document.mimeType) ? <span>Análisis disponible para PDF, JPG o PNG</span> : analyzedDocuments.has(document.id) ? <span className="phr-lab-document-status"><span className="status-badge">Analizado</span>{!readOnly && <button className="button secondary" disabled={!!busyId} type="button" onClick={() => void analyze(document, false, true)}>{busyId === document.id ? "Releyendo…" : "Releer archivo"}</button>}{unmappedDocuments.has(document.id) && !readOnly && <button className="button secondary" disabled={!!busyId} type="button" onClick={() => void openLoinc(document)}>{busyId === document.id ? "Buscando…" : "Resolver LOINC con IA"}</button>}</span> : !readOnly && <button className="button primary" disabled={!!busyId} type="button" onClick={() => void analyze(document)}>{busyId === document.id ? "Analizando…" : "Analizar resultados"}</button>}</div></li>)}</ul>}
    </section>

    {!readOnly && suggested.length > 0 && <section className="card portal-card">
      <div className="card-heading"><div><p className="eyebrow">Revisión obligatoria</p><h2>{suggested.length} resultado(s) por revisar</h2><p>Compara con el documento original, corrige lo necesario y confirma en conjunto.</p></div><button className="button primary" disabled={!!busyId} type="button" onClick={() => void confirmAll()}>{busyId === "confirm-all" ? "Confirmando…" : `Confirmar los ${suggested.length}`}</button></div>
      <div className="phr-lab-review-workspace">
        <aside className="phr-lab-source-viewer" aria-label="Documento fuente">{source ? <>{source.contentType.startsWith("image/") ? <img src={source.url} alt="Fotografía fuente del laboratorio" /> : <iframe key={`${source.resultId}-${source.page}`} src={`${source.url}#page=${source.page}&toolbar=1&navpanes=0`} title="PDF fuente del resultado seleccionado" />}<p>{source.contentType.startsWith("image/") ? "Fotografía original visible para comparación." : source.highlighted ? `Página ${source.page}: el valor seleccionado está resaltado en amarillo.` : `Página ${source.page}: PDF visible sin resaltado exacto.`}</p></> : <p className="empty-state">Selecciona <strong>Ver original</strong> en un resultado para contrastarlo con el documento fuente.</p>}</aside>
        <div className="phr-lab-review-groups">{suggestedCategories.map((group, index) => <details className="phr-lab-review-group" key={group.key} open={index === 0}><summary>{labCategoryLabels[group.key]} <span>{group.items.length} resultado(s)</span></summary><div className="phr-lab-review-list">{group.items.map((result) => <SuggestedResult key={result.id} result={result} busy={!!busyId} selected={source?.resultId === result.id} onSource={openSource} onDone={changed} onError={setError} />)}</div></details>)}</div>
      </div>
    </section>}

    {confirmed.length > 0 && <section className="card portal-card"><div className="card-heading"><div><p className="eyebrow">Resultados confirmados</p><h2>Historial de laboratorio</h2></div>{!readOnly && <div className="phr-actions"><button className="button secondary" type="button" onClick={() => void downloadPhrFile("/api/portal/trends", "tendencias-laboratorio.csv", "csv")}>Descargar CSV</button><button className="button secondary" type="button" onClick={() => void downloadPhrFile("/api/portal/trends", "tendencias-laboratorio.pdf", "pdf")}>Descargar PDF</button></div>}</div>
      <div className="phr-filter-row"><button className={`filter-chip${filter === "all" ? " active" : ""}`} type="button" onClick={() => setFilter("all")}>Todos</button>{(["hematology", "lipids", "metabolic", "renal", "hepatic", "hormones"] as LabCategory[]).map((key) => <button className={`filter-chip${filter === key ? " active" : ""}`} key={key} type="button" onClick={() => setFilter(key)}>{labCategoryLabels[key]}</button>)}</div>
      {categories.length ? categories.map((group) => <div className="phr-lab-category" key={group.key}><h3>{labCategoryLabels[group.key]}</h3><p className="phr-measurement-help">{group.items[0] && measurementExplanation(group.items[0])} No interpreta lo que el resultado significa para una persona.</p><ul>{group.items.map((result) => { const favorite = favorites.some((item) => item.trendKey === phrLabTrendKey(result)); return <li key={result.id}><div><span className="phr-result-title"><strong>{result.analyte}</strong>{!readOnly && <button className="favorite-button" type="button" aria-label={favorite ? `Quitar ${result.analyte} de favoritos` : `Agregar ${result.analyte} a favoritos`} aria-pressed={favorite} onClick={() => void toggleFavorite(result)}>{favorite ? "★" : "☆"}</button>}</span><span>{shownDate(result.observedAt)}{result.loincCode && ` · LOINC ${result.loincCode}`} · {phrSpecimenLabel(result.loincMetadata, result.sourceSentence)}</span></div><div><strong>{resultValue(result)}</strong><span>{reference(result)} · {reportedRangeLabel(result)}</span></div></li>; })}</ul></div>) : <p className="empty-state">No hay resultados en este perfil.</p>}
    </section>}

    {confirmed.length > 0 && <section className="card portal-card"><p className="eyebrow">Evolución</p><h2>Tendencias</h2>{trends.length ? <div className="phr-trends-grid">{trends.map((result) => <TrendChart key={phrLabTrendKey(result)} result={result} all={confirmed} />)}</div> : <p className="empty-state">Las tendencias aparecerán al confirmar dos mediciones comparables del mismo analito.</p>}</section>}
    {!loading && <PhrPeriodComparison results={confirmed} />}
    {loading && <p className="empty-state">Cargando resultados…</p>}
    {loincDialog && <div className="appointment-info-backdrop" role="dialog" aria-modal="true" aria-label="Sugerencias LOINC" onClick={(event) => { if (event.target === event.currentTarget && !busyId) setLoincDialog(undefined); }}><div className="appointment-info phr-loinc-dialog"><div className="card-heading"><div><p className="eyebrow">Revisión humana</p><h2>Resolver LOINC pendientes</h2><p>La IA ordenó alternativas existentes en el catálogo; el PDF no fue enviado. Revisa antes de guardar.</p></div><button className="text-button" type="button" disabled={!!busyId} onClick={() => setLoincDialog(undefined)}>Cerrar</button></div>{loincDialog.warnings.map((warning) => <p className="form-notice" key={warning}>{warning}</p>)}<div className="phr-loinc-review-list">{loincDialog.suggestions.map((suggestion) => <label key={suggestion.resultId}><span><strong>{suggestion.analyte}</strong><small>{suggestion.options.length ? `${suggestion.options.length} alternativa(s)` : "Sin coincidencia segura"}</small></span><select value={loincSelections[suggestion.resultId] ?? ""} disabled={!suggestion.options.length || !!busyId} onChange={(event) => setLoincSelections((current) => ({ ...current, [suggestion.resultId]: event.target.value }))}><option value="">Sin asignar</option>{suggestion.options.map((option) => <option value={option.code} key={option.code}>{option.code} · {option.display}</option>)}</select></label>)}</div><button className="button primary" type="button" disabled={!!busyId || !Object.values(loincSelections).some(Boolean)} onClick={() => void applyLoinc()}>{busyId === "loinc" ? "Guardando…" : "Guardar sugerencias seleccionadas"}</button></div></div>}
  </div>;
}
