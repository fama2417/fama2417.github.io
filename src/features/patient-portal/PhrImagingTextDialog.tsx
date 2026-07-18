"use client";

import { useEffect, useState } from "react";
import { PHR_CLINICAL_AREA_LABELS } from "./documents";
import { phrImagingPlainLanguagePoints, type PhrImagingText } from "./imaging";
import { extractPhrImagingText, savePhrImagingText, type PortalDocument } from "./repository";

export function PhrImagingTextDialog({ document, initialText, onClose, onSaved }: { document: PortalDocument; initialText?: PhrImagingText; onClose: () => void; onSaved: (text: PhrImagingText) => void }) {
  const [text, setText] = useState<PhrImagingText | null>(document.extractedText ?? initialText ?? null), [busy, setBusy] = useState(!document.extractedText && !initialText), [editing, setEditing] = useState(!document.extractedText), [error, setError] = useState("");
  const [operation, setOperation] = useState<"extract" | "save" | "">(document.extractedText || initialText ? "" : "extract");
  async function extract() {
    setBusy(true); setOperation("extract"); setError("");
    try { setText(await extractPhrImagingText(document.id)); setEditing(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible extraer el texto."); }
    finally { setBusy(false); setOperation(""); }
  }
  useEffect(() => { if (!document.extractedText && !initialText) void extract(); }, [document.id]);
  async function save() {
    if (!text) return;
    setBusy(true); setOperation("save"); setError("");
    try { await savePhrImagingText(document.id, text); setEditing(false); onSaved(text); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible guardar las correcciones."); }
    finally { setBusy(false); setOperation(""); }
  }
  const change = (field: keyof PhrImagingText, value: string) => setText((current) => current && ({ ...current, [field]: value }));

  const image = document.mimeType.startsWith("image/");
  const areaLabel = PHR_CLINICAL_AREA_LABELS[document.clinicalArea];
  const sections = text ? [["Motivo o indicación", text.clinicalIndication], ["Técnica o procedimiento", text.technique], ["Hallazgos o resultados", text.findings]] as const : [];
  return <div className="appointment-info-backdrop" role="dialog" aria-modal="true" aria-label="Informe clínico organizado" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="appointment-info phr-imaging-text-dialog">
      <div className="card-heading"><div><p className="eyebrow">{areaLabel} · {image ? "reconocimiento visual" : "lectura del PDF"}</p><h2>Informe clínico organizado</h2><p>{document.sourceInstitution || "Documento personal"} · {document.filename}</p></div><button className="text-button" type="button" disabled={busy} onClick={onClose}>Cerrar</button></div>
      {error && <p className="notice danger-text" role="alert">{error}</p>}
      {busy && <div className="ai-operation-status" role="status" aria-live="polite"><strong>{operation === "save" ? "Guardando el informe revisado" : image ? "Reconociendo y organizando la fotografía" : "Leyendo y organizando el PDF"}</strong><span>{operation === "save" ? "Conservamos el original y guardamos únicamente las secciones que confirmaste." : "Extraemos el texto, identificamos sus secciones y preparamos una explicación simple. Los documentos escaneados pueden tardar más."}</span><div className="ai-operation-progress" role="progressbar" aria-label="Procesamiento en curso"><span /></div></div>}
      {!busy && !text ? <div className="empty-state"><p>No hay texto organizado para revisar.</p><button className="button primary" type="button" onClick={() => void extract()}>Intentar nuevamente</button></div> : text && !editing ? <div className="phr-imaging-report">
        <p className="phr-imaging-disclaimer"><strong>Explicación redactada por IA.</strong> Simplifica el informe sin entregar un diagnóstico nuevo ni reemplazar la evaluación profesional.</p>
        {text.plainLanguage ? <section className="phr-imaging-plain"><span>En palabras simples</span><ul>{phrImagingPlainLanguagePoints(text.plainLanguage).map((point, index) => <li key={`${index}-${point}`}>{point}</li>)}</ul></section> : <p className="form-notice">Este informe aún no tiene una explicación simple.</p>}
        {text.impression && <section className="phr-imaging-impression"><span>Conclusión original del informe</span><p>{text.impression}</p></section>}
        <div className="phr-imaging-sections">{sections.map(([title, value]) => <section key={title}><h3>{title}</h3><p>{value || "No informado como sección separada en el documento."}</p></section>)}</div>
        <details className="phr-imaging-original"><summary>Ver documento original</summary>{image ? <img src={document.url} alt="Fotografía original del informe" /> : <iframe src={`${document.url}#toolbar=1&navpanes=0`} title="PDF original del informe" />}</details>
        <div className="phr-actions">{!text.plainLanguage && <button className="button primary" type="button" disabled={busy} onClick={() => void extract()}>Generar explicación simple</button>}<button className="button secondary" type="button" onClick={() => setEditing(true)}>Revisar extracción</button><button className="button secondary" type="button" onClick={onClose}>Listo</button></div>
      </div> : text && <div className="phr-imaging-review">
        <aside>{image ? <img src={document.url} alt="Fotografía original del informe" /> : <iframe src={`${document.url}#toolbar=1&navpanes=0`} title="PDF original del informe" />}</aside>
        <div className="phr-imaging-fields"><p><strong>Paso 2 de 3 · Revisar.</strong> Compara las secciones extraídas con el original. Puedes corregir la transcripción; la explicación simple fue redactada por IA y no se edita.</p>
          {text.plainLanguage && <section className="phr-imaging-plain"><span>En palabras simples · redactado por IA</span><ul>{phrImagingPlainLanguagePoints(text.plainLanguage).map((point, index) => <li key={`${index}-${point}`}>{point}</li>)}</ul></section>}
          <label><span>Motivo o indicación</span><textarea value={text.clinicalIndication} onChange={(event) => change("clinicalIndication", event.target.value)} /></label><label><span>Técnica o procedimiento</span><textarea value={text.technique} onChange={(event) => change("technique", event.target.value)} /></label><label><span>Hallazgos o resultados</span><textarea value={text.findings} onChange={(event) => change("findings", event.target.value)} /></label><label><span>Conclusión, interpretación o diagnóstico informado</span><textarea value={text.impression} onChange={(event) => change("impression", event.target.value)} /></label>
          <details><summary>Texto completo extraído</summary><pre>{text.fullText}</pre></details>
          <div className="phr-actions"><button className="button secondary" type="button" disabled={busy} onClick={() => void extract()}>Releer y reorganizar</button>{document.extractedText && <button className="button secondary" type="button" disabled={busy} onClick={() => { setText(document.extractedText ?? null); setEditing(false); }}>Cancelar cambios</button>}<button className="button primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? "Guardando…" : "Confirmar y guardar"}</button></div>
        </div>
      </div>}
    </div>
  </div>;
}
