"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { phrLabDisplayName, phrLabTrendKey, type PhrLabResult } from "./labs";
import { createPhrShare, downloadPhrFile, fetchPhrLabResults, fetchPhrShares, revokePhrShare, type PortalDocument, type PhrShare } from "./repository";
import { friendlyDocumentName } from "./presentation";

export function PhrSharing({ ownerUserId, documents }: { ownerUserId: string; documents: PortalDocument[] }) {
  const [results, setResults] = useState<PhrLabResult[]>([]), [shares, setShares] = useState<PhrShare[]>([]);
  const [documentIds, setDocumentIds] = useState<string[]>([]), [trendKeys, setTrendKeys] = useState<string[]>([]);
  const [createdUrl, setCreatedUrl] = useState(""), [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState("");
  async function reload() { const [nextResults, nextShares] = await Promise.all([fetchPhrLabResults(ownerUserId), fetchPhrShares()]); setResults(nextResults); setShares(nextShares); }
  useEffect(() => { reload().catch(() => setError("No fue posible cargar las opciones para compartir.")); }, [ownerUserId]);
  const biomarkers = useMemo(() => {
    const seen = new Set<string>();
    return results.filter((result) => {
      const key = phrLabTrendKey(result);
      if (result.reviewStatus !== "confirmed" || seen.has(key)) return false;
      seen.add(key); return true;
    });
  }, [results]);
  const toggle = (value: string, values: string[], setValues: (next: string[]) => void) => setValues(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice(""); setCreatedUrl("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await createPhrShare({ title: String(form.get("title")), expiresInDays: Number(form.get("days")), documentIds, trendKeys, includeEmergency: form.get("emergency") === "on" });
      setCreatedUrl(response.url); setNotice("Enlace creado. Cópialo ahora: por seguridad no volveremos a mostrar el token."); await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible crear el enlace."); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) { if (!window.confirm("¿Revocar este enlace?")) return; await revokePhrShare(id); await reload(); setNotice("Enlace revocado."); }
  return <div className="phr-labs-stack">
    {error && <p className="notice danger-text" role="alert">{error}</p>}{notice && <p className="form-notice" role="status">{notice}</p>}
    <section className="card portal-card"><div className="card-heading"><div><p className="eyebrow">Consulta médica</p><h2>Resumen personal</h2><p>Genera un PDF descriptivo con perfil de emergencia, documentos recientes y resultados fuera del rango informado.</p></div><button className="button secondary" type="button" onClick={() => void downloadPhrFile("/api/portal/summary", "resumen-para-consulta.pdf")}>Descargar resumen PDF</button></div></section>
    <section className="card portal-card"><p className="eyebrow">Enlace temporal · Solo lectura</p><h2>Crear enlace para compartir</h2><p>Selecciona exactamente qué verá la otra persona. El acceso expira, puede revocarse y cada apertura queda registrada.</p>
      <form className="phr-share-form" onSubmit={create}><label>Título<input name="title" defaultValue="Resumen para consulta" maxLength={120} required /></label><label>Expiración<select name="days" defaultValue="7"><option value="1">1 día</option><option value="7">7 días</option><option value="30">30 días</option></select></label>
        <fieldset><legend>Documentos</legend>{documents.length ? documents.map((document) => <label className="phr-check-row" key={document.id} title={document.filename}><input type="checkbox" checked={documentIds.includes(document.id)} onChange={() => toggle(document.id, documentIds, setDocumentIds)} /><span><strong>{friendlyDocumentName(document.documentType)}</strong><small>{document.sourceInstitution} · {document.filename}</small></span></label>) : <p>No hay documentos.</p>}</fieldset>
        <fieldset><legend>Biomarcadores</legend>{biomarkers.length ? biomarkers.map((result) => { const key = phrLabTrendKey(result); return <label className="phr-check-row" key={key}><input type="checkbox" checked={trendKeys.includes(key)} onChange={() => toggle(key, trendKeys, setTrendKeys)} /><span><strong>{phrLabDisplayName(result)}</strong><small>Incluye sus mediciones confirmadas</small></span></label>; }) : <p>No hay biomarcadores confirmados.</p>}</fieldset>
        <label className="phr-consent"><input name="emergency" type="checkbox" /> <span>Incluir perfil de emergencia y resumen estructurado</span></label><button className="button primary" disabled={busy} type="submit">{busy ? "Creando…" : "Crear enlace"}</button>
      </form>
      {createdUrl && <div className="phr-created-link"><label>Enlace creado<input readOnly value={createdUrl} onFocus={(event) => event.currentTarget.select()} /></label><button className="button secondary" type="button" onClick={() => navigator.clipboard.writeText(createdUrl).then(() => setNotice("Enlace copiado."))}>Copiar</button></div>}
    </section>
    <section className="card portal-card"><p className="eyebrow">Auditoría</p><h2>Enlaces creados</h2>{shares.length ? <ul className="portal-list">{shares.map((share) => { const active = !share.revokedAt && share.expiresAt > new Date().toISOString(); return <li key={share.id}><div className="portal-document-detail"><strong>{share.title}</strong><span>{active ? `Expira ${new Date(share.expiresAt).toLocaleString("es-CL")}` : share.revokedAt ? "Revocado" : "Expirado"}</span><span>{share.accessCount} acceso(s){share.lastAccessedAt ? ` · último ${new Date(share.lastAccessedAt).toLocaleString("es-CL")}` : ""}</span></div>{active && <button className="text-button danger-text" type="button" onClick={() => void revoke(share.id)}>Revocar</button>}</li>; })}</ul> : <p className="empty-state">Todavía no has creado enlaces.</p>}</section>
  </div>;
}
