"use client";

import {
  comparableLabTrend, labCategory, labCategoryLabels, labCategoryOrder, labFlagLabels, labTrendKey,
  type ComparableLabPoint, type LabObservation,
} from "../reports/lab-observations";

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

function LabTrendChart({ points }: { points: LabObservation[] }) {
  const trend = comparableLabTrend(points);
  if (!trend) return null;
  const width = 260, height = 76, padding = 8;
  const values = trend.points.map((point) => point.value);
  if (trend.refLow !== null) values.push(trend.refLow);
  if (trend.refHigh !== null) values.push(trend.refHigh);
  const rawMin = Math.min(...values), rawMax = Math.max(...values);
  const margin = Math.max((rawMax - rawMin) * 0.12, Math.abs(rawMax) * 0.03, 1);
  const min = rawMin - margin, max = rawMax + margin;
  const x = (index: number) => padding + index * ((width - 2 * padding) / (trend.points.length - 1));
  const y = (value: number) => height - padding - ((value - min) / (max - min)) * (height - 2 * padding);
  const path = trend.points.map((point, index) => `${x(index)},${y(point.value)}`).join(" ");
  const bandTop = trend.refHigh === null ? null : y(trend.refHigh);
  const bandBottom = trend.refLow === null ? null : y(trend.refLow);
  return <div className="lab-chart">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Tendencia de ${trend.points.length} mediciones comparables`}>
      <title>Tendencia histórica; no implica mejoría ni empeoramiento.</title>
      {bandTop !== null && bandBottom !== null && <rect className="lab-chart-range" x={padding} y={Math.min(bandTop, bandBottom)} width={width - 2 * padding} height={Math.abs(bandBottom - bandTop)} />}
      <polyline className="lab-chart-line" points={path} />
      {trend.points.map((point, index) => <circle className="lab-chart-point" key={point.id} cx={x(index)} cy={y(point.value)} r="3"><title>{new Date(point.observedAt).toLocaleDateString("es-CL")}: {point.value.toLocaleString("es-CL")} {trend.unit}</title></circle>)}
    </svg>
    <small>{trend.points.length} mediciones comparables{trend.unit ? ` · normalizadas a ${trend.unit}` : ""}</small>
  </div>;
}

function trendArrow(points: ComparableLabPoint[]) {
  const [previous, latest] = points.slice(-2);
  return latest.value > previous.value ? "↑" : latest.value < previous.value ? "↓" : "→";
}

function LabTrendCard({ points }: { points: LabObservation[] }) {
  const latest = points[0];
  const trend = comparableLabTrend(points);
  const arrow = trend ? trendArrow(trend.points) : "";
  const history = points.slice(1).filter((point, index, rest) => point.observedAt !== latest.observedAt && rest.findIndex((other) => other.observedAt === point.observedAt) === index).slice(0, 3);
  const reference = showReference(latest);
  const meta = latest.loincMetadata;
  return <article className={`lab-trend workflow-entry${isAlert(latest) ? " lab-trend-attention" : ""}`}>
    <header><strong>{latest.analyte}</strong>{latest.flag && <span className={`lab-status lab-flag-${latest.flag}`}>{labFlagLabels[latest.flag]}</span>}</header>
    <div className="lab-trend-value"><strong>{latest.valueNum ?? latest.valueText}</strong>{latest.unit && <span>{latest.unit}</span>}{arrow && <span className="lab-direction" title="Cambio respecto de la medición anterior comparable; no implica mejoría o empeoramiento.">{arrow}</span>}</div>
    <div className="lab-trend-meta"><span>{new Date(latest.observedAt).toLocaleDateString("es-CL")}</span>{reference && <span>Rango informado: {reference}</span>}</div>
    <LabTrendChart points={points} />
    {history.length > 0 && !trend && <div className="lab-history">{history.map((o) => <span className="lab-history-point" key={o.id}>{new Date(o.observedAt).toLocaleDateString("es-CL")}: {o.valueNum ?? o.valueText}{o.unit ? ` ${o.unit}` : ""}</span>)}</div>}
    {(latest.loincCode || meta?.specimen || points.length > 4) && <footer>{latest.loincCode && <span>LOINC {latest.loincCode}</span>}{meta?.specimen && <span>Muestra: {meta.specimen}</span>}{points.length > 4 && <span>+{points.length - 4} anteriores</span>}</footer>}
  </article>;
}

export function PatientLabTrendsSection({ observations, limit }: { observations: LabObservation[]; limit?: number }) {
  if (!observations.length) return <p className="empty-inline">Sin resultados de laboratorio estructurados.</p>;
  const series = trendSeries(observations);
  const shown = limit ? series.slice(0, limit) : series;
  const attention = shown.filter((points) => isAlert(points[0]));
  const critical = attention.filter((points) => points[0].flag === "critical_low" || points[0].flag === "critical_high").length;
  const latestDate = new Date(Math.max(...observations.map((o) => new Date(o.observedAt).getTime()))).toLocaleDateString("es-CL");
  const categories = labCategoryOrder.map((id) => ({
    id, series: shown.filter((points) => labCategory(points[0]) === id).sort((a, b) => Number(isAlert(b[0])) - Number(isAlert(a[0]))),
  })).filter((category) => category.series.length);

  return <div className="lab-results-summary">
    <div className="lab-summary-cards">
      <div><strong>{shown.length}</strong><span>Analitos</span></div>
      <div className={attention.length ? "warning" : ""}><strong>{attention.length}</strong><span>Fuera de rango</span></div>
      <div className={critical ? "danger" : ""}><strong>{critical}</strong><span>Críticos</span></div>
      <div><strong>{latestDate}</strong><span>Última muestra</span></div>
    </div>
    <div className="lab-categories">
      {categories.map((category, index) => {
        const alerts = category.series.filter((points) => isAlert(points[0])).length;
        return <details className="lab-category" key={category.id} open={alerts > 0 || (!attention.length && index === 0)}>
          <summary><span>{labCategoryLabels[category.id]}</span><span className="lab-category-count">{category.series.length} analito{category.series.length === 1 ? "" : "s"}{alerts ? ` · ${alerts} fuera de rango` : ""}</span></summary>
          <div className="lab-trends">{category.series.map((points) => <LabTrendCard key={labTrendKey(points[0])} points={points} />)}</div>
        </details>;
      })}
    </div>
  </div>;
}
