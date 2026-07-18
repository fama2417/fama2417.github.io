"use client";

import { useEffect, useMemo, useState } from "react";
import { labCategory, labCategoryLabels, labCategoryOrder, labFlagLabels, type LabCategory } from "@/features/reports/lab-observations.ts";
import { buildPhrLabTrend, phrLabDisplayName, phrLabDraftOf, phrLabTrendKey, phrSpecimenLabel, type PhrLabDraft, type PhrLabResult } from "./labs";
import { measurementExplanation, reportedRangeLabel } from "./longitudinal";
import { PhrPeriodComparison } from "./PhrLongitudinal";
import { isAnalyzableLabDocument } from "./documents";
import { friendlyDocumentName } from "./presentation";
import { analyzePhrLabDocument, confirmPhrLabResults, discardPhrLabResult, downloadPhrFile, fetchPhrFavorites, fetchPhrLabResults, fetchPhrLabSource, fetchPhrLoincSuggestions, savePhrLabResult, savePhrLoincSelections, setPhrFavorite, type PortalDocument, type PhrFavorite, type PhrLoincSuggestion } from "./repository";

const resultValue = (result: PhrLabResult) => `${result.valueNum ?? result.valueText}${result.unit ? ` ${result.unit}` : ""}`;
const reference = (result: PhrLabResult) => result.refLow !== null || result.refHigh !== null ? `${result.refLow ?? "…"}–${result.refHigh ?? "…"}` : result.refText;
const shownDate = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
const resultCategory = (result: PhrLabResult) => labCategory({ analyte: phrLabDisplayName(result), loincMetadata: result.loincMetadata, sourceSentence: result.sourceSentence });
const outsideRange = (result: PhrLabResult) => ["low", "high", "critical_low", "critical_high", "abnormal"].includes(result.flag);

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
  const confidence = result.codingConfidence === null || result.codingConfidence === undefined ? "" : `${Math.round(result.codingConfidence * 100)} %`;
  return <article className={`phr-lab-review-card${selected ? " selected" : ""}`}>
    {result.canonicalAnalyte && result.canonicalAnalyte !== result.analyte && <p className={`phr-canonical-suggestion${result.loincCode ? " matched" : " pending"}`}><strong title={result.canonicalAnalyte}>{phrLabDisplayName(result)}</strong> <span>{result.loincCode ? "LOINC ✓" : "Posible homologación"}{confidence && ` · Confianza de extracción ${confidence}`}</span></p>}
    <div className="phr-lab-review-grid">
      <label>Analito<input value={draft.analyte} maxLength={160} onChange={(event) => change({ analyte: event.target.value })} /></label>
      <label>Resultado<input value={draft.value} maxLength={80} onChange={(event) => change({ value: event.target.value })} /></label>
      <label>Unidad<input value={draft.unit} maxLength={32} onChange={(event) => change({ unit: event.target.value })} /></label>
      <label>Referencia<input value={draft.reference} maxLength={120} onChange={(event) => change({ reference: event.target.value })} /></label>
      <label>Fecha<input type="date" value={draft.observedAt} onChange={(event) => change({ observedAt: event.target.value })} /></label>
    </div>
    <div className="phr-lab-review-meta"><span className={`lab-flag lab-flag-${result.flag || "none"}`}>{labFlagLabels[result.flag]}</span><span>{result.source === "ai" ? "Extracción automática" : "Lectura local del PDF"}</span><span className={`phr-loinc-badge${!result.loincCode ? " pending" : ""}`}>{result.loincCode ? `LOINC ${result.loincCode}` : result.suggestedLoincCode ? `Revisar LOINC ${result.suggestedLoincCode}` : "Sin homologar"}</span><span>{phrSpecimenLabel(result.loincMetadata, result.sourceSentence)}</span></div>
    <div className="phr-actions"><button className="button secondary" disabled={busy} type="button" onClick={() => void onSource(result)}>Ver original</button><button className="button secondary" disabled={busy} type="button" onClick={() => void save(false)}>Guardar corrección</button><button className="button primary" disabled={busy} type="button" onClick={() => void save(true)}>Confirmar</button><button className="text-button danger-text" disabled={busy} type="button" onClick={() => void discard()}>Descartar</button></div>
  </article>;
}

function TrendChart({ result, all }: { result: PhrLabResult; all: PhrLabResult[] }) {
  const history = all.filter((item) => phrLabTrendKey(item) === phrLabTrendKey(result)).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const trend = buildPhrLabTrend(history);
  if (!trend) return null;
  const values = trend.points.map((point) => point.value), rawMin = Math.min(...values), rawMax = Math.max(...values), padding = Math.max((rawMax - rawMin) * .5, Math.abs((rawMax + rawMin) / 2) * .05, .1);
  const min = rawMin - padding, max = rawMax + padding, spread = max - min;
  const coordinates = trend.points.map((point, index) => ({ ...point, x: 24 + index * (272 / (trend.points.length - 1)), y: 100 - ((point.value - min) / spread) * 72 })), latest = coordinates.at(-1)!, first = coordinates[0];
  const difference = latest.value - first.value, percent = first.value ? Math.abs(difference / first.value * 100) : null;
  const change = difference === 0 ? "Se mantuvo sin cambios entre ambas mediciones." : `${difference > 0 ? "Subió" : "Bajó"} ${Math.abs(difference).toLocaleString("es-CL", { maximumFractionDigits: 2 })} ${trend.unit}${percent === null ? "" : ` (${percent.toLocaleString("es-CL", { maximumFractionDigits: 1 })} %)`} entre la primera y la última medición.`;
  const latestResult = history.at(-1), range = latestResult && outsideRange(latestResult) ? "El último valor está fuera del rango informado por ese laboratorio." : latestResult?.flag === "normal" ? "El último valor está dentro del rango informado por ese laboratorio." : "El laboratorio no informó un rango comparable para el último valor.";
  return <article className="phr-trend-card">
    <div><strong>{trend.analyte}</strong><span>{latest.value.toLocaleString("es-CL")} {trend.unit}</span></div>
    <svg viewBox="0 0 320 136" role="img" aria-label={`Tendencia de ${trend.analyte}`}><title>Tendencia de {trend.analyte}</title><g className="phr-trend-grid"><line x1="24" y1="28" x2="296" y2="28" /><line x1="24" y1="64" x2="296" y2="64" /><line x1="24" y1="100" x2="296" y2="100" /></g><polyline points={coordinates.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />{coordinates.map((point) => <circle key={point.id} cx={point.x} cy={point.y} r="5"><title>{shownDate(point.date)}: {point.value} {trend.unit}</title></circle>)}<text x={first.x} y="124" textAnchor="start">{first.value.toLocaleString("es-CL")}</text><text x={latest.x} y="124" textAnchor="end">{latest.value.toLocaleString("es-CL")}</text></svg>
    <p className="phr-trend-explanation"><strong>{change}</strong><span>{range}</span></p>
    <small>{shownDate(first.date)} → {shownDate(latest.date)} · {trend.points.length} mediciones</small>
  </article>;
}

export function PhrLaboratories({ documents, ownerUserId, readOnly, onUpload, hideHeading = false }: { documents: PortalDocument[]; ownerUserId: string; readOnly: boolean; onUpload: () => void; hideHeading?: boolean }) {
  const [results, setResults] = useState<PhrLabResult[]>([]), [loading, setLoading] = useState(true), [busyId, setBusyId] = useState("");
  const [favorites, setFavorites] = useState<PhrFavorite[]>([]), [filter, setFilter] = useState<LabCategory | "all">("all");
  const [query, setQuery] = useState(""), [onlyOutside, setOnlyOutside] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [warnings, setWarnings] = useState<string[]>([]);
  const [processing, setProcessing] = useState<{ title: string; detail: string; startedAt: number }>(), [elapsed, setElapsed] = useState(0);
  const [source, setSource] = useState<{ resultId: string; url: string; contentType: string; highlighted: boolean; page: number }>();
  const [loincDialog, setLoincDialog] = useState<{ documentId: string; suggestions: PhrLoincSuggestion[]; warnings: string[] }>();
  const [loincSelections, setLoincSelections] = useState<Record<string, string>>({});
  const labs = documents.filter((document) => document.documentType === "laboratory");
  const analyzedDocuments = new Set(results.map((result) => result.documentId));
  const pendingLabs = labs.filter((document) => !analyzedDocuments.has(document.id)), processedLabs = labs.filter((document) => analyzedDocuments.has(document.id));
  async function reload() { const [nextResults, nextFavorites] = await Promise.all([fetchPhrLabResults(ownerUserId), fetchPhrFavorites(ownerUserId)]); setResults(nextResults); setFavorites(nextFavorites); setLoading(false); }
  useEffect(() => { reload().catch(() => { setError("No fue posible cargar los resultados."); setLoading(false); }); }, [ownerUserId, documents.map((document) => document.id).join("|")]);
  useEffect(() => () => { if (source?.url) URL.revokeObjectURL(source.url); }, [source?.url]);
  useEffect(() => { if (!processing) { setElapsed(0); return; } const update = () => setElapsed(Math.floor((Date.now() - processing.startedAt) / 1000)); update(); const timer = window.setInterval(update, 1000); return () => window.clearInterval(timer); }, [processing]);

  async function analyze(document: PortalDocument, rematch = false, rescan = false) {
    setBusyId(document.id); setError(""); setNotice(""); setWarnings([]);
    setProcessing({ title: rematch ? "Revisando la homologación LOINC" : rescan ? "Volviendo a leer el laboratorio" : "Procesando el laboratorio", detail: rematch ? "Buscamos candidatos en español e inglés y validamos nombre, unidad y muestra." : "Leemos el documento, estructuramos los resultados y después los homologamos con LOINC.", startedAt: Date.now() });
    try {
      const response = await analyzePhrLabDocument(document.id, rematch, rescan); await reload();
      setNotice(rescan ? `Relectura completada: ${response.created} resultado(s) nuevo(s).` : rematch ? `Agrupación actualizada: ${response.loincMapped} resultado(s) con LOINC.` : response.duplicate ? "Este archivo ya estaba analizado." : `${response.created} resultado(s) listos para revisión. Confirma abajo los que quieras guardar.`);
      setWarnings(response.warnings);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible analizar el laboratorio."); }
    finally { setBusyId(""); setProcessing(undefined); }
  }
  async function changed(message: string) { setBusyId("refresh"); await reload(); setBusyId(""); setNotice(message); setError(""); }
  async function openLoinc(document: PortalDocument) {
    setBusyId(document.id); setError(""); setNotice("");
    try {
      const result = await fetchPhrLoincSuggestions(document.id);
      if (!result.suggestions.length) { setNotice(result.warnings[0] ?? "No se detectaron homologaciones pendientes."); return; }
      setLoincDialog({ documentId: document.id, ...result });
      setLoincSelections(Object.fromEntries(result.suggestions.filter((item) => item.recommendedCode).map((item) => [item.resultId, item.recommendedCode])));
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
    try { await setPhrFavorite(trendKey, phrLabDisplayName(result), favorite); await reload(); setNotice(favorite ? "Biomarcador agregado a favoritos." : "Biomarcador quitado de favoritos."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible actualizar el favorito."); }
  }

  const suggested = results.filter((result) => result.reviewStatus === "suggested");
  const confirmed = results.filter((result) => result.reviewStatus === "confirmed");
  const suggestedCategories = labCategoryOrder.map((key) => ({ key, items: suggested.filter((result) => resultCategory(result) === key) })).filter((group) => group.items.length);
  const visibleConfirmed = confirmed.filter((result) => (!query.trim() || `${phrLabDisplayName(result)} ${result.analyte}`.toLocaleLowerCase("es-CL").includes(query.trim().toLocaleLowerCase("es-CL"))) && (!onlyOutside || outsideRange(result)));
  const categories = labCategoryOrder.map((key) => ({ key, items: visibleConfirmed.filter((result) => resultCategory(result) === key && (filter === "all" || filter === key)) })).filter((group) => group.items.length);
  const profiles = categories.map((group) => {
    const byMarker = new Map<string, PhrLabResult[]>();
    group.items.forEach((result) => byMarker.set(phrLabTrendKey(result), [...(byMarker.get(phrLabTrendKey(result)) ?? []), result]));
    return { ...group, markers: [...byMarker.values()].map((items) => items.sort((a, b) => b.observedAt.localeCompare(a.observedAt))) };
  });
  const trends = useMemo(() => {
    const seen = new Set<string>();
    return confirmed.filter((result) => { const key = phrLabTrendKey(result); if (seen.has(key)) return false; seen.add(key); return !!buildPhrLabTrend(confirmed.filter((item) => phrLabTrendKey(item) === key)); });
  }, [confirmed]);
  const favoriteTrendKeys = new Set(favorites.map((favorite) => favorite.trendKey));
  const favoriteTrends = trends.filter((result) => favoriteTrendKeys.has(phrLabTrendKey(result)));

  return <div className="phr-labs-stack">
    {error && <p className="notice danger-text" role="alert">{error}</p>}{notice && <p className="form-notice" role="status">{notice}</p>}
    <section className="card portal-card"><div className="card-heading"><div><p className="eyebrow">Extracción segura</p><h2>Laboratorios por procesar</h2><p>Todos los PDF se leen localmente, incluso si son escaneados. Sólo las fotos JPG/PNG usan reconocimiento visual asistido. Nada cuenta como resultado hasta que lo confirmas.</p></div>{!hideHeading && !readOnly && <button className="button primary" type="button" onClick={onUpload}>Subir laboratorio</button>}</div>
      {!labs.length ? <p className="empty-state">Todavía no tienes laboratorios.</p> : pendingLabs.length ? <ul className="portal-list">{pendingLabs.map((document) => <li key={document.id}><div className="portal-document-detail"><strong title={document.filename}>{friendlyDocumentName(document.documentType)}</strong><span>{document.sourceInstitution} · {shownDate(document.documentDate ?? document.createdAt)} · {document.filename}</span></div><div className="portal-document-actions"><a className="button secondary" href={document.url} target="_blank" rel="noreferrer">Abrir archivo</a>{!isAnalyzableLabDocument(document.mimeType) ? <span>Análisis disponible para PDF, JPG o PNG</span> : !readOnly && <button className="button primary" disabled={!!busyId} type="button" onClick={() => void analyze(document)}>{busyId === document.id ? "Analizando…" : "Analizar resultados"}</button>}</div></li>)}</ul> : <p className="phr-processed-summary">✓ Todos tus archivos están procesados. Revisa abajo sólo si necesitas abrirlos o volver a analizarlos.</p>}
      {processing && <div className="ai-operation-status" role="status" aria-live="polite"><strong>{processing.title} · {elapsed} s</strong><span>{processing.detail}</span></div>}
      {!!processedLabs.length && <details className="phr-processed-documents"><summary><span>Archivos procesados</span><span>{processedLabs.length}</span></summary><ul className="portal-list">{processedLabs.map((document) => <li key={document.id}><div className="portal-document-detail"><strong title={document.filename}>{friendlyDocumentName(document.documentType)}</strong><span>{document.sourceInstitution} · {shownDate(document.documentDate ?? document.createdAt)}</span></div><div className="portal-document-actions"><a className="button secondary" href={document.url} target="_blank" rel="noreferrer">Abrir original</a>{!readOnly && <button className="text-button" disabled={!!busyId} type="button" onClick={() => void analyze(document, false, true)}>{busyId === document.id ? "Releyendo…" : "Volver a procesar"}</button>}{!readOnly && <button className="text-button" disabled={!!busyId} type="button" onClick={() => void openLoinc(document)}>{busyId === document.id ? "Buscando…" : "Revisar LOINC"}</button>}</div></li>)}</ul></details>}
    </section>

    {!readOnly && suggested.length > 0 && <section className="card portal-card">
      <div className="card-heading"><div><p className="eyebrow">Revisión obligatoria</p><h2>{suggested.length} resultado(s) por revisar</h2><p>Compara con el documento original, corrige lo necesario y confirma en conjunto.</p></div><button className="button primary" disabled={!!busyId} type="button" onClick={() => void confirmAll()}>{busyId === "confirm-all" ? "Confirmando…" : `Confirmar los ${suggested.length}`}</button></div>
      {!!warnings.length && <details className="phr-processed-documents phr-review-warnings"><summary><span>Detalles de la lectura</span><span>{warnings.length}</span></summary><ul className="portal-list">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}
      <div className="phr-lab-review-workspace">
        <aside className="phr-lab-source-viewer" aria-label="Documento fuente">{source ? <>{source.contentType.startsWith("image/") ? <img src={source.url} alt="Fotografía fuente del laboratorio" /> : <iframe key={`${source.resultId}-${source.page}`} src={`${source.url}#page=${source.page}&toolbar=1&navpanes=0`} title="PDF fuente del resultado seleccionado" />}<p>{source.contentType.startsWith("image/") ? "Fotografía original visible para comparación." : source.highlighted ? `Página ${source.page}: el valor seleccionado está resaltado en amarillo.` : `Página ${source.page}: PDF visible sin resaltado exacto.`}</p></> : <p className="empty-state">Selecciona <strong>Ver original</strong> en un resultado para contrastarlo con el documento fuente.</p>}</aside>
        <div className="phr-lab-review-groups">{suggestedCategories.map((group, index) => <details className="phr-lab-review-group" key={group.key} open={index === 0}><summary>{labCategoryLabels[group.key]} <span>{group.items.length} resultado(s)</span></summary><div className="phr-lab-review-list">{group.items.map((result) => <SuggestedResult key={result.id} result={result} busy={!!busyId} selected={source?.resultId === result.id} onSource={openSource} onDone={changed} onError={setError} />)}</div></details>)}</div>
      </div>
    </section>}

    {confirmed.length > 0 && <section className="card portal-card"><div className="card-heading"><div><p className="eyebrow">Resultados confirmados</p><h2>Historial de laboratorio</h2><p>Cada biomarcador aparece una vez. Ábrelo sólo cuando quieras ver sus mediciones anteriores y detalles técnicos.</p></div>{!readOnly && <div className="phr-actions"><button className="button secondary" type="button" onClick={() => void downloadPhrFile("/api/portal/trends", "tendencias-laboratorio.csv", "csv")}>Descargar CSV</button><button className="button secondary" type="button" onClick={() => void downloadPhrFile("/api/portal/trends", "tendencias-laboratorio.pdf", "pdf")}>Descargar PDF</button></div>}</div>
      <div className="phr-lab-overview"><div><strong>{new Set(confirmed.map(phrLabTrendKey)).size}</strong><span>Biomarcadores</span></div><div><strong>{confirmed.filter(outsideRange).length}</strong><span>Fuera del rango informado</span></div><div><strong>{trends.length}</strong><span>Con tendencia comparable</span></div></div>
      <div className="phr-lab-toolbar"><label><span>Buscar biomarcador</span><input type="search" value={query} placeholder="Ej. ferritina o TSH" onChange={(event) => setQuery(event.target.value)} /></label><button className={`filter-chip${onlyOutside ? " active" : ""}`} type="button" aria-pressed={onlyOutside} onClick={() => setOnlyOutside((value) => !value)}>Sólo fuera de rango</button></div>
      <div className="phr-filter-row"><button className={`filter-chip${filter === "all" ? " active" : ""}`} type="button" onClick={() => setFilter("all")}>Todos</button>{labCategoryOrder.filter((key) => confirmed.some((result) => resultCategory(result) === key)).map((key) => <button className={`filter-chip${filter === key ? " active" : ""}`} key={key} type="button" onClick={() => setFilter(key)}>{labCategoryLabels[key]}</button>)}</div>
      {profiles.length ? <div className="phr-lab-profiles">{profiles.map((group) => <details className="phr-lab-profile" key={group.key} open={filter !== "all" || !!query.trim() || onlyOutside}><summary><span><strong>{labCategoryLabels[group.key]}</strong><small>{measurementExplanation(group.items[0])}</small></span><span>{group.markers.length} biomarcador(es) · {group.items.filter(outsideRange).length} fuera de rango</span></summary><div className="phr-lab-marker-list">{group.markers.map((history) => { const latest = history[0], displayName = phrLabDisplayName(latest), favorite = favorites.some((item) => item.trendKey === phrLabTrendKey(latest)); return <details className="phr-lab-marker" key={phrLabTrendKey(latest)}><summary><span className="phr-result-title"><strong>{displayName}</strong>{!readOnly && <button className="favorite-button" type="button" aria-label={favorite ? `Quitar ${displayName} de favoritos` : `Agregar ${displayName} a favoritos`} aria-pressed={favorite} onClick={(event) => { event.preventDefault(); event.stopPropagation(); void toggleFavorite(latest); }}>{favorite ? "★" : "☆"}</button>}</span><span className="phr-lab-latest"><strong>{resultValue(latest)}</strong><small>{shownDate(latest.observedAt)} · {history.length === 1 ? "1 medición" : `${history.length} mediciones`}</small></span><span className={`lab-flag lab-flag-${latest.flag || "none"}`}>{labFlagLabels[latest.flag]}</span></summary><div className="phr-lab-history">{history.map((result) => <article key={result.id}><div><strong>{shownDate(result.observedAt)}</strong><span>{phrSpecimenLabel(result.loincMetadata, result.sourceSentence)}{result.loincCode && ` · LOINC ${result.loincCode}`}{result.analyte !== phrLabDisplayName(result) && ` · original: ${result.analyte}`}</span></div><div><strong>{resultValue(result)}</strong><span>{[reference(result), reportedRangeLabel(result)].filter(Boolean).join(" · ")}</span></div></article>)}</div></details>; })}</div></details>)}</div> : <p className="empty-state">No encontramos resultados con esos filtros.</p>}
      <p className="phr-measurement-help">La aplicación describe el rango informado por cada laboratorio; no interpreta diagnósticos ni reemplaza una consulta profesional.</p>
    </section>}

    {confirmed.length > 0 && <section className="card portal-card"><p className="eyebrow">Evolución</p><h2>Mis tendencias favoritas</h2><p>Para mantener esta vista simple, aquí sólo aparecen los biomarcadores que marcas con una estrella.</p>{favoriteTrends.length ? <div className="phr-trends-grid">{favoriteTrends.map((result) => <TrendChart key={phrLabTrendKey(result)} result={result} all={confirmed} />)}</div> : <p className="empty-state">Marca ☆ junto a un biomarcador con dos o más mediciones para ver su gráfico aquí.</p>}</section>}
    {!loading && <PhrPeriodComparison results={confirmed.filter((result) => favoriteTrendKeys.has(phrLabTrendKey(result)))} />}
    {loading && <p className="empty-state">Cargando resultados…</p>}
    {loincDialog && <div className="appointment-info-backdrop" role="dialog" aria-modal="true" aria-label="Sugerencias LOINC" onClick={(event) => { if (event.target === event.currentTarget && !busyId) setLoincDialog(undefined); }}><div className="appointment-info phr-loinc-dialog"><div className="card-heading"><div><p className="eyebrow">Homologación segura</p><h2>Revisar códigos LOINC</h2><p>El PDF no se envía en este paso. La IA compara únicamente analito, unidad, muestra y candidatos existentes en el catálogo; una confianza intermedia siempre requiere tu revisión.</p></div><button className="text-button" type="button" disabled={!!busyId} onClick={() => setLoincDialog(undefined)}>Cerrar</button></div>{loincDialog.warnings.map((warning) => <p className="form-notice" key={warning}>{warning}</p>)}<div className="phr-loinc-review-list">{loincDialog.suggestions.map((suggestion) => <label key={suggestion.resultId}><span><strong>{suggestion.analyte}</strong><small>{suggestion.currentCode ? `Actual: ${suggestion.currentCode}` : "Sin código actual"}{suggestion.confidence !== null && ` · Confianza de extracción ${Math.round(suggestion.confidence * 100)} %`}</small></span><select value={loincSelections[suggestion.resultId] ?? ""} disabled={!suggestion.options.length || !!busyId} onChange={(event) => setLoincSelections((current) => ({ ...current, [suggestion.resultId]: event.target.value }))}><option value="">Mantener sin asignar</option>{suggestion.options.map((option) => <option value={option.code} key={option.code}>{option.code} · {option.display}</option>)}</select></label>)}</div><button className="button primary" type="button" disabled={!!busyId || !Object.values(loincSelections).some(Boolean)} onClick={() => void applyLoinc()}>{busyId === "loinc" ? "Guardando…" : "Guardar equivalencias revisadas"}</button></div></div>}
  </div>;
}
