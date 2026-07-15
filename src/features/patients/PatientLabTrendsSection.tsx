"use client";

import { labFlagLabels, labTrendKey, type LabObservation } from "../reports/lab-observations";

const alertFlags = new Set(["low", "high", "critical_low", "critical_high", "abnormal"]);
const isAlert = (o: LabObservation) => alertFlags.has(o.flag);
const showReference = (o: LabObservation) => o.refLow !== null || o.refHigh !== null
  ? `${o.refLow ?? "…"}–${o.refHigh ?? "…"}${o.unit ? ` ${o.unit}` : ""}`
  : o.refText;

// Agrupa por analito (clave LOINC o nombre); cada serie ya llega ordenada desc por fecha desde la query.
function trendSeries(items: LabObservation[]) {
  const map = new Map<string, LabObservation[]>();
  for (const o of items) {
    const key = labTrendKey(o);
    const series = map.get(key);
    if (series) series.push(o); else map.set(key, [o]);
  }
  return [...map.values()];
}

function LabTrendCard({ points }: { points: LabObservation[] }) {
  const latest = points[0];
  const previous = points.slice(1).find((o) => o.valueNum !== null);
  const arrow = latest.valueNum !== null && previous?.valueNum != null
    ? latest.valueNum > previous.valueNum ? "↑" : latest.valueNum < previous.valueNum ? "↓" : "→" : "";
  const history = points.slice(1, 4);
  const reference = showReference(latest);
  return <article className={`lab-trend workflow-entry${isAlert(latest) ? " lab-trend-attention" : ""}`}>
    <header><strong>{latest.analyte}</strong>{latest.flag && <span className={`lab-status lab-flag-${latest.flag}`}>{labFlagLabels[latest.flag]}</span>}</header>
    <div className="lab-trend-value"><strong>{latest.valueNum ?? latest.valueText}</strong>{latest.unit && <span>{latest.unit}</span>}{arrow && <span className="lab-direction" title="Cambio respecto de la medición anterior; no implica mejoría o empeoramiento.">{arrow}</span>}</div>
    <div className="lab-trend-meta"><span>{new Date(latest.observedAt).toLocaleDateString("es-CL")}</span>{reference && <span>Rango informado: {reference}</span>}</div>
    {history.length > 0 && <div className="lab-history">{history.map((o) => <span className="lab-history-point" key={o.id}>{new Date(o.observedAt).toLocaleDateString("es-CL")}: {o.valueNum ?? o.valueText}{o.unit ? ` ${o.unit}` : ""}</span>)}</div>}
    {(latest.loincCode || points.length > 4) && <footer>{latest.loincCode && <span>LOINC {latest.loincCode}</span>}{points.length > 4 && <span>+{points.length - 4} mediciones anteriores</span>}</footer>}
  </article>;
}

export function PatientLabTrendsSection({ observations, limit }: { observations: LabObservation[]; limit?: number }) {
  if (!observations.length) return <p className="empty-inline">Sin resultados de laboratorio estructurados.</p>;
  const series = trendSeries(observations);
  const shown = limit ? series.slice(0, limit) : series;
  const attention = shown.filter((points) => isAlert(points[0]));
  const routine = shown.filter((points) => !isAlert(points[0]));
  const critical = attention.filter((points) => points[0].flag === "critical_low" || points[0].flag === "critical_high").length;
  const latestDate = new Date(Math.max(...observations.map((o) => new Date(o.observedAt).getTime()))).toLocaleDateString("es-CL");

  return <div className="lab-results-summary">
    <div className="lab-summary-cards">
      <div><strong>{shown.length}</strong><span>Analitos</span></div>
      <div className={attention.length ? "warning" : ""}><strong>{attention.length}</strong><span>Fuera de rango</span></div>
      <div className={critical ? "danger" : ""}><strong>{critical}</strong><span>Críticos</span></div>
      <div><strong>{latestDate}</strong><span>Última muestra</span></div>
    </div>
    {attention.length > 0 && <section className="lab-result-group"><h4>Fuera del rango informado</h4><div className="lab-trends">{attention.map((points) => <LabTrendCard key={labTrendKey(points[0])} points={points} />)}</div></section>}
    {routine.length > 0 && <details className="lab-routine" open={!attention.length}><summary>Dentro de rango y otros resultados <span className="collapsible-count">{routine.length}</span></summary><div className="lab-trends">{routine.map((points) => <LabTrendCard key={labTrendKey(points[0])} points={points} />)}</div></details>}
  </div>;
}
