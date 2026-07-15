"use client";

import { labFlagLabels, labTrendKey, type LabObservation } from "../reports/lab-observations";

const showValue = (o: LabObservation) => `${o.valueNum ?? o.valueText}${o.unit ? ` ${o.unit}` : ""}`;

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

export function PatientLabTrendsSection({ observations, limit }: { observations: LabObservation[]; limit?: number }) {
  if (!observations.length) return <p className="empty-inline">Sin resultados de laboratorio estructurados.</p>;
  const series = trendSeries(observations);
  const shown = limit ? series.slice(0, limit) : series;
  return <div className="lab-trends">
    {shown.map((points) => {
      const latest = points[0];
      const previous = points.find((o) => o.valueNum !== null && o !== latest);
      const arrow = latest.valueNum !== null && previous?.valueNum != null
        ? latest.valueNum > previous.valueNum ? "↑" : latest.valueNum < previous.valueNum ? "↓" : "→" : "";
      return <div className="lab-trend workflow-entry" key={labTrendKey(latest)}>
        <strong>{latest.analyte}{latest.loincCode && <span className="lab-loinc"> · LOINC {latest.loincCode}</span>}</strong>
        <span>Último: {showValue(latest)} {arrow}{latest.flag && <span className={`lab-flag lab-flag-${latest.flag}`}> · {labFlagLabels[latest.flag]}</span>}</span>
        <div className="lab-history">
          {points.map((o) => <span className="lab-history-point" key={o.id}>{new Date(o.observedAt).toLocaleDateString("es-CL")}: {showValue(o)}{o.flag ? ` (${labFlagLabels[o.flag]})` : ""}</span>)}
        </div>
      </div>;
    })}
  </div>;
}
