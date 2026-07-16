"use client";

import { useEffect, useState } from "react";
import { extractPhrImagingText, savePhrImagingText, type PortalDocument } from "./repository";
import type { PhrImagingText } from "./imaging";

export function PhrImagingTextDialog({ document, onClose, onSaved }: { document: PortalDocument; onClose: () => void; onSaved: (text: PhrImagingText) => void }) {
  const [text, setText] = useState<PhrImagingText | null>(document.extractedText ?? null), [busy, setBusy] = useState(!document.extractedText), [editing, setEditing] = useState(!document.extractedText), [error, setError] = useState("");
  async function extract() {
    setBusy(true); setError("");
    try { setText(await extractPhrImagingText(document.id)); setEditing(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible extraer el texto."); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (!document.extractedText) void extract(); }, [document.id]);
  async function save() {
    if (!text) return;
    setBusy(true); setError("");
    try { await savePhrImagingText(document.id, text); onSaved(text); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible guardar las correcciones."); }
    finally { setBusy(false); }
  }
  const change = (field: keyof PhrImagingText, value: string) => setText((current) => current && ({ ...current, [field]: value }));

  const image = document.mimeType.startsWith("image/");
  const sections = text ? [["Indicación clínica", text.clinicalIndication], ["Técnica", text.technique], ["Hallazgos", text.findings]] as const : [];
  return <div className="appointment-info-backdrop" role="dialog" aria-modal="true" aria-label="Informe radiológico estructurado" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="appointment-info phr-imaging-text-dialog">
      <div className="card-heading"><div><p className="eyebrow">{image ? "Fotografía · reconocimiento visual" : "PDF · lectura local y explicación asistida"}</p><h2>Informe radiológico estructurado</h2><p>{document.sourceInstitution || "Documento personal"} · {document.filename}</p></div><button className="text-button" type="button" disabled={busy} onClick={onClose}>Cerrar</button></div>
      {error && <p className="notice danger-text" role="alert">{error}</p>}
      {busy && !text ? <p className="empty-state">Organizando el contenido del informe…</p> : text && !editing ? <div className="phr-imaging-report">
        <p className="phr-imaging-disclaimer">La explicación simplifica el texto del informe sin entregar un diagnóstico nuevo ni reemplazar la evaluación profesional.</p>
        {text.plainLanguage ? <section className="phr-imaging-plain"><span>En palabras simples</span><p>{text.plainLanguage}</p></section> : <p className="form-notice">Este informe aún no tiene una explicación simple.</p>}
        {text.impression && <section className="phr-imaging-impression"><span>Conclusión original del informe</span><p>{text.impression}</p></section>}
        <div className="phr-imaging-sections">{sections.map(([title, value]) => <section key={title}><h3>{title}</h3><p>{value || "No informado como sección separada en el documento."}</p></section>)}</div>
        <details className="phr-imaging-original"><summary>Ver documento original</summary>{image ? <img src={document.url} alt="Fotografía original del informe" /> : <iframe src={`${document.url}#toolbar=1&navpanes=0`} title="PDF original del informe" />}</details>
        <div className="phr-actions">{!text.plainLanguage && <button className="button primary" type="button" disabled={busy} onClick={() => void extract()}>Generar explicación simple</button>}<button className="button secondary" type="button" onClick={() => setEditing(true)}>Revisar extracción</button><button className="button secondary" type="button" onClick={onClose}>Listo</button></div>
      </div> : text && <div className="phr-imaging-review">
        <aside>{image ? <img src={document.url} alt="Fotografía original del informe" /> : <iframe src={`${document.url}#toolbar=1&navpanes=0`} title="PDF original del informe" />}</aside>
        <div className="phr-imaging-fields"><p>Compara cada sección con el original. La explicación asistida también debe ser confirmada antes de guardarse.</p>
          <label><span>Explicación en palabras simples</span><textarea value={text.plainLanguage} onChange={(event) => change("plainLanguage", event.target.value)} /></label>
          <label><span>Indicación clínica</span><textarea value={text.clinicalIndication} onChange={(event) => change("clinicalIndication", event.target.value)} /></label><label><span>Técnica</span><textarea value={text.technique} onChange={(event) => change("technique", event.target.value)} /></label><label><span>Hallazgos</span><textarea value={text.findings} onChange={(event) => change("findings", event.target.value)} /></label><label><span>Conclusión o impresión</span><textarea value={text.impression} onChange={(event) => change("impression", event.target.value)} /></label>
          <details><summary>Texto completo extraído</summary><pre>{text.fullText}</pre></details>
          <div className="phr-actions"><button className="button secondary" type="button" disabled={busy} onClick={() => void extract()}>Releer y reorganizar</button>{document.extractedText && <button className="button secondary" type="button" disabled={busy} onClick={() => { setText(document.extractedText ?? null); setEditing(false); }}>Cancelar cambios</button>}<button className="button primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? "Guardando…" : "Confirmar y guardar"}</button></div>
        </div>
      </div>}
    </div>
  </div>;
}
