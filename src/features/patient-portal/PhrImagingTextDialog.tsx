"use client";

import { useEffect, useState } from "react";
import { extractPhrImagingText, savePhrImagingText, type PortalDocument } from "./repository";
import type { PhrImagingText } from "./imaging";

export function PhrImagingTextDialog({ document, onClose, onSaved }: { document: PortalDocument; onClose: () => void; onSaved: (text: PhrImagingText) => void }) {
  const [text, setText] = useState<PhrImagingText | null>(document.extractedText ?? null), [busy, setBusy] = useState(!document.extractedText), [error, setError] = useState("");
  async function extract() {
    setBusy(true); setError("");
    try { setText(await extractPhrImagingText(document.id)); }
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
  return <div className="appointment-info-backdrop" role="dialog" aria-modal="true" aria-label="Texto del informe radiológico" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><div className="appointment-info phr-imaging-text-dialog"><div className="card-heading"><div><p className="eyebrow">{image ? "Fotografía · reconocimiento visual con IA" : "PDF · extracción local sin IA"}</p><h2>Texto del informe radiológico</h2><p>{document.filename}</p></div><button className="text-button" type="button" disabled={busy} onClick={onClose}>Cerrar</button></div>{error && <p className="notice danger-text" role="alert">{error}</p>}{busy && !text ? <p>Extrayendo texto del informe…</p> : text && <div className="phr-imaging-review"><aside>{image ? <img src={document.url} alt="Fotografía original del informe" /> : <iframe src={`${document.url}#toolbar=1&navpanes=0`} title="PDF original del informe" />}</aside><div><p>Compara el original con cada campo. Nada se guarda hasta que confirmes.</p><label>Indicación clínica<textarea value={text.clinicalIndication} onChange={(event) => change("clinicalIndication", event.target.value)} /></label><label>Técnica<textarea value={text.technique} onChange={(event) => change("technique", event.target.value)} /></label><label>Hallazgos<textarea value={text.findings} onChange={(event) => change("findings", event.target.value)} /></label><label>Conclusión o impresión<textarea value={text.impression} onChange={(event) => change("impression", event.target.value)} /></label><details><summary>Ver texto completo extraído</summary><pre>{text.fullText}</pre></details><div className="phr-actions"><button className="button secondary" type="button" disabled={busy} onClick={() => void extract()}>Releer archivo</button><button className="button primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? "Guardando…" : "Confirmar y guardar"}</button></div></div></div>}</div></div>;
}
