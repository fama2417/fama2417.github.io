"use client";

import { useEffect, useState } from "react";
import { labFlag, labFlagLabels, parseLabNumber, parseLabReference, type LabObservation } from "./lab-observations";
import { confirmLabObservation, deleteLabObservation, fetchLabObservations, ingestLabPdf, updateLabObservation } from "./lab-repository";

type Draft = { analyte: string; value: string; unit: string; reference: string; observedAt: string };
const showValue = (o: LabObservation) => `${o.valueNum ?? o.valueText}${o.unit ? ` ${o.unit}` : ""}`;
const showReference = (o: LabObservation) => o.refLow !== null || o.refHigh !== null ? `${o.refLow ?? "…"}–${o.refHigh ?? "…"}` : o.refText;
const draftOf = (o: LabObservation): Draft => ({ analyte: o.analyte, value: String(o.valueNum ?? o.valueText), unit: o.unit, reference: showReference(o), observedAt: o.observedAt.slice(0, 10) });

export function LabObservationsPanel({ appointmentId, appointmentCompleted, disabled }: {
  appointmentId: string; disabled: boolean; appointmentCompleted: boolean;
}) {
  const [items, setItems] = useState<LabObservation[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    const next = await fetchLabObservations(appointmentId);
    setItems(next);
    setDrafts(Object.fromEntries(next.filter((item) => item.reviewStatus === "suggested").map((item) => [item.id, draftOf(item)])));
  }

  useEffect(() => { reload().catch(() => setError("No fue posible cargar los resultados.")); }, [appointmentId]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await ingestLabPdf(appointmentId, file);
      await reload();
      const message = result.duplicate ? "El PDF ya estaba importado; no se duplicaron resultados." : `${result.created} resultado(s) extraído(s) para revisión.`;
      setNotice(`${message}${result.warnings.length ? ` ${result.warnings.join(" ")}` : ""}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible procesar el PDF.");
    } finally { setBusy(false); }
  }

  function change(id: string, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  async function persist(id: string) {
    const draft = drafts[id];
    if (!draft?.analyte.trim() || !draft.value.trim()) throw new Error("Analito y resultado son obligatorios.");
    const valueNum = parseLabNumber(draft.value);
    const reference = parseLabReference(draft.reference);
    const currentFlag = items.find((item) => item.id === id)?.flag;
    const flag = currentFlag && ["abnormal", "critical_low", "critical_high"].includes(currentFlag) ? currentFlag : labFlag(valueNum, reference.refLow, reference.refHigh);
    return updateLabObservation(id, {
      analyte: draft.analyte.trim(), valueNum, valueText: valueNum === null ? draft.value.trim() : "", unit: draft.unit.trim(),
      ...reference, flag, observedAt: draft.observedAt,
    });
  }

  async function save(id: string) {
    setError("");
    try {
      const saved = await persist(id);
      setItems((current) => current.map((item) => item.id === id ? saved : item));
      setNotice("Cambios guardados; el resultado sigue pendiente de confirmación.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible guardar el resultado."); }
  }

  async function confirm(id: string) {
    setError("");
    try {
      await persist(id);
      const confirmed = await confirmLabObservation(id);
      setItems((current) => current.map((item) => item.id === id ? confirmed : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible confirmar el resultado."); }
  }

  async function remove(id: string) {
    setError("");
    try { await deleteLabObservation(id); setItems((current) => current.filter((item) => item.id !== id)); }
    catch { setError("No fue posible descartar el resultado."); }
  }

  const suggested = disabled ? [] : items.filter((item) => item.reviewStatus === "suggested");
  const confirmed = items.filter((item) => item.reviewStatus === "confirmed");

  return <section className="report-clinical-panel lab-results-workspace" aria-label="Resultados de laboratorio">
    <div className="card-heading"><div><p className="eyebrow">Resultados discretos</p><h3>Analitos del laboratorio</h3></div><span className="collapsible-count">{items.length}</span></div>
    {!appointmentCompleted ? <p className="empty-inline">Marca la cita como «Atendida» para cargar resultados.</p> : <>
      {error && <p className="notice" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}
      {!disabled && <label className="key-image-dropzone">
        <input type="file" accept="application/pdf" hidden disabled={busy} onChange={(event) => { upload(event.target.files?.[0]); event.target.value = ""; }} />
        <strong>{busy ? "Procesando PDF…" : "Subir PDF de resultados"}</strong>
        <span className="empty-inline">Primero se leen tablas localmente. Nano se usa sólo si el texto es ambiguo y la lectura visual queda como respaldo para PDFs escaneados.</span>
      </label>}

      {suggested.length > 0 && <section className="lab-review-group">
        <h4>Pendientes de validación <span className="collapsible-count">{suggested.length}</span></h4>
        {suggested.map((item) => {
          const draft = drafts[item.id] ?? draftOf(item);
          return <form className="workflow-entry report-inline-form lab-observation" key={item.id} onSubmit={(event) => { event.preventDefault(); confirm(item.id); }}>
            <label className="span-2">Analito<input value={draft.analyte} onChange={(event) => change(item.id, { analyte: event.target.value })} /></label>
            <label>Resultado<input value={draft.value} onChange={(event) => change(item.id, { value: event.target.value })} /></label>
            <label>Unidad<input value={draft.unit} onChange={(event) => change(item.id, { unit: event.target.value })} /></label>
            <label className="span-2">Referencia<input value={draft.reference} onChange={(event) => change(item.id, { reference: event.target.value })} /></label>
            <label>Fecha de muestra<input type="date" value={draft.observedAt} onChange={(event) => change(item.id, { observedAt: event.target.value })} /></label>
            {item.sourceSentence && <span className="empty-inline span-2">Origen: {item.sourceSentence}</span>}
            <div className="lab-observation-actions span-2">
              <button className="text-button" type="button" onClick={() => save(item.id)}>Guardar cambios</button>
              <button className="button secondary" type="submit">Confirmar resultado</button>
              <button className="text-button danger" type="button" onClick={() => remove(item.id)}>Descartar</button>
            </div>
          </form>;
        })}
      </section>}

      {confirmed.length > 0 && <section className="lab-review-group">
        <h4>Confirmados <span className="collapsible-count">{confirmed.length}</span></h4>
        {confirmed.map((item) => <div className="workflow-entry lab-observation" key={item.id}>
          <strong>{item.analyte}{item.loincCode && <span className="lab-loinc"> · LOINC {item.loincCode}</span>}</strong>
          <span>{showValue(item)}{showReference(item) && ` · Ref ${showReference(item)}`}{item.flag && <span className={`lab-flag lab-flag-${item.flag}`}> · {labFlagLabels[item.flag]}</span>} · {new Date(item.observedAt).toLocaleDateString("es-CL")}</span>
        </div>)}
      </section>}
      {!items.length && <p className="empty-inline">Aún no hay resultados para esta atención.</p>}
    </>}
  </section>;
}
