"use client";

import { useEffect, useState } from "react";
import { labFlagLabels, type LabObservation } from "./lab-observations";
import { confirmLabObservation, deleteLabObservation, fetchLabObservations, ingestLabPdf } from "./lab-repository";

const showValue = (o: LabObservation) => `${o.valueNum ?? o.valueText}${o.unit ? ` ${o.unit}` : ""}`;
const refText = (o: LabObservation) => o.refLow !== null || o.refHigh !== null ? `Ref ${o.refLow ?? "…"}–${o.refHigh ?? "…"}` : o.refText;

export function LabObservationsPanel({ reportId, appointmentCompleted, disabled }: {
  reportId?: string; appointmentId: string; patientId: string; defaultObservedAt: string; disabled: boolean; appointmentCompleted: boolean;
}) {
  const [items, setItems] = useState<LabObservation[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (reportId) fetchLabObservations(reportId).then(setItems).catch(() => setError("No fue posible cargar los resultados."));
  }, [reportId]);

  // Los resultados solo se cargan una vez que el paciente fue atendido (cita = Atendida).
  const gateMessage = !appointmentCompleted
    ? "Marca la cita como «Atendida» para cargar resultados."
    : !reportId ? "Guarda el borrador para cargar resultados." : "";

  async function upload(file: File | undefined) {
    if (!file || !reportId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await ingestLabPdf(reportId, file);
      setItems(await fetchLabObservations(reportId));
      setNotice(result.created ? `${result.created} resultado(s) extraído(s) para revisión.${result.warnings.length ? " " + result.warnings.join(" ") : ""}` : "No se detectaron resultados en el PDF." + (result.warnings.length ? " " + result.warnings.join(" ") : ""));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible procesar el PDF.");
    } finally { setBusy(false); }
  }

  async function confirm(id: string) {
    setError("");
    try { setItems((current) => current.map((o) => o.id === id ? { ...o, reviewStatus: "confirmed" } : o)); await confirmLabObservation(id); }
    catch { setError("No fue posible confirmar el resultado."); if (reportId) setItems(await fetchLabObservations(reportId)); }
  }

  async function remove(id: string) {
    setError("");
    try { await deleteLabObservation(id); setItems((current) => current.filter((o) => o.id !== id)); }
    catch { setError("No fue posible eliminar el resultado."); }
  }

  const suggested = items.filter((o) => o.reviewStatus === "suggested");
  const confirmed = items.filter((o) => o.reviewStatus === "confirmed");

  const row = (o: LabObservation, review: boolean) => <div className="workflow-entry lab-observation" key={o.id}>
    <strong>{o.analyte}{o.loincCode && <span className="lab-loinc"> · LOINC {o.loincCode}</span>}</strong>
    <span>{showValue(o)}{refText(o) && ` · ${refText(o)}`}{o.flag && <span className={`lab-flag lab-flag-${o.flag}`}> · {labFlagLabels[o.flag]}</span>} · {new Date(o.observedAt).toLocaleDateString("es-CL")}</span>
    {o.sourceSentence && <span className="empty-inline">{o.sourceSentence}</span>}
    {!disabled && <div className="lab-observation-actions">
      {review && <button className="text-button" type="button" onClick={() => confirm(o.id)}>Confirmar</button>}
      <button className="text-button danger" type="button" onClick={() => remove(o.id)}>{review ? "Descartar" : "Quitar"}</button>
    </div>}
  </div>;

  return <details className="report-clinical-panel collapsible" open>
    <summary><span className="collapsible-icon">🧪</span>Resultados de laboratorio{items.length > 0 && <span className="collapsible-count">{items.length}</span>}</summary>
    {gateMessage ? <p className="empty-inline">{gateMessage}</p> : <>
      {error && <p className="notice" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}
      {!disabled && <label className="key-image-dropzone">
        <input type="file" accept="application/pdf" hidden disabled={busy} onChange={(event) => { upload(event.target.files?.[0]); event.target.value = ""; }} />
        <strong>{busy ? "Procesando PDF…" : "Sube el PDF de resultados para extraerlos con IA"}</strong>
        <span className="empty-inline">Se extrae el texto del PDF y se estructura como resultados sugeridos para tu revisión. No reemplaza tu criterio: confirma cada valor.</span>
      </label>}
      {suggested.length > 0 && <section className="lab-review-group">
        <h4>Sugeridos por IA — revisa y confirma <span className="collapsible-count">{suggested.length}</span></h4>
        {suggested.map((o) => row(o, true))}
      </section>}
      {confirmed.length > 0 && <section className="lab-review-group">
        <h4>Confirmados <span className="collapsible-count">{confirmed.length}</span></h4>
        {confirmed.map((o) => row(o, false))}
      </section>}
      {!items.length && <p className="empty-inline">Aún no hay resultados. Sube un PDF para extraerlos.</p>}
    </>}
  </details>;
}
