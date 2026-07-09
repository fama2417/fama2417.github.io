"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-client";

type Item = {
  id: string;
  findingText: string;
  normalizedText: string;
  status: string;
  importance: string;
  sourceSection: string;
  sourceSentence: string;
  bodySite: string | null;
  laterality: string | null;
  severity: string | null;
  confidence: number;
  extractionMethod: string;
  codingStatus: string;
  dictionary: { id: string; localCode: string; canonicalName: string } | null;
  candidate: { id: string; rawText: string; suggestedCanonicalName: string; status: string } | null;
};

const statusLabels: Record<string, string> = { present: "Presente", absent: "Ausente", uncertain: "Incierto", history: "Antecedente", recommendation: "Recomendacion" };
const importanceLabels: Record<string, string> = { principal: "Principal", secondary: "Secundario", incidental: "Incidental", negative: "Negativo", not_relevant: "No relevante" };
const lateralityLabels: Record<string, string> = { right: "Derecha", left: "Izquierda", bilateral: "Bilateral", midline: "Linea media", unknown: "No especificada" };
const severityLabels: Record<string, string> = { mild: "Leve", moderate: "Moderada", severe: "Severa", unknown: "No especificada" };
const reviewLabels: Record<string, string> = { suggested: "Sugerido", confirmed: "Confirmado", corrected: "Corregido", rejected: "Rechazado", not_required: "No requerido" };
const dictionaryLabels: Record<string, string> = { known: "Diccionario", new_candidate: "Nuevo termino", pending_dictionary: "Pendiente diccionario" };
const codeLabels: Record<string, string> = { unmapped: "Sin codificacion", suggested: "Codigo sugerido", confirmed: "Codigo confirmado", not_applicable: "No aplica" };
const groupLabels = { principal: "Hallazgos principales", secondary: "Hallazgos secundarios", incidental: "Hallazgos incidentales", negative: "Hallazgos negativos / ausentes", reviewed: "Hallazgos rechazados o corregidos" } as const;
type GroupKey = keyof typeof groupLabels;
type Derived = { reviewStatus: string; dictionaryStatus: string; codeStatus: string; clinicalBadges: string[] };

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${data.session?.access_token ?? ""}`, "Content-Type": "application/json" };
}

const apiMessage = (status: number, error?: string) => {
  if (status === 403) return "La extraccion con IA esta deshabilitada. Configura AI_EXTRACTION_ENABLED=true en el entorno.";
  if (status === 503) return "OpenAI no esta configurado. Falta OPENAI_API_KEY en el entorno del servidor.";
  if (status === 429) return "Se alcanzo el limite diario o mensual configurado para IA.";
  if (status === 400) return error?.toLowerCase().includes("accion") ? "No fue posible aplicar la accion solicitada." : "El informe no tiene texto suficiente en Hallazgos o Impresion para analizar.";
  return error || "No fue posible completar la accion.";
};

const titleOf = (item: Item) => item.dictionary?.canonicalName || item.candidate?.suggestedCanonicalName || (item.findingText.length > 92 ? `${item.findingText.slice(0, 89)}...` : item.findingText);
const pendingItems = (items: Item[]) => items.filter((item) => item.codingStatus === "suggested");
const derive = (item: Item): Derived => {
  const text = `${item.findingText} ${item.sourceSentence}`.toLowerCase();
  const clinicalBadges = [
    /neoplas|tumor|masa|metasta|adenopat|cancer|carcinoma|oncolo/.test(text) && "Oncologico",
    item.importance === "incidental" && "Incidental",
    /seguimiento|control|recomienda|recomendacion/.test(text) && "Seguimiento",
    /critico|urgente|inmediata|emergente/.test(text) && "Critico",
    /sin cambios|estable|similar al previo|respecto a estudio previo/.test(text) && "Estable",
    /progres|aument|crecim|mayor/.test(text) && "Progresion",
    /regres|disminu|reducc|menor/.test(text) && "Regresion",
  ].filter(Boolean) as string[];
  return {
    reviewStatus: item.codingStatus,
    dictionaryStatus: item.dictionary ? "known" : item.candidate ? "pending_dictionary" : "new_candidate",
    codeStatus: item.dictionary ? (item.codingStatus === "confirmed" ? "confirmed" : "suggested") : "unmapped",
    clinicalBadges,
  };
};
const groupOf = (item: Item): GroupKey => {
  if (item.codingStatus === "rejected" || item.codingStatus === "corrected") return "reviewed";
  if (item.status === "absent" || item.importance === "negative") return "negative";
  if (item.importance === "principal") return "principal";
  if (item.importance === "incidental") return "incidental";
  return "secondary";
};

export function AiFindingsPanel({ reportId, reportStatus, disabled }: { reportId?: string; reportStatus?: string; disabled?: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState("");
  const [error, setError] = useState("");
  const locked = disabled || reportStatus === "final";

  async function load() {
    if (!reportId) return;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(reportId)}/extracted-findings`, { headers: await authHeaders() });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiMessage(response.status, payload.error));
      setItems(payload.items ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cargar hallazgos sugeridos.");
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [reportId]);

  async function extract() {
    if (!reportId || locked) return;
    setActing("extract"); setError("");
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(reportId)}/ai/extract-findings`, { method: "POST", headers: await authHeaders(), body: JSON.stringify({ force: true }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiMessage(response.status, payload.error));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible analizar el informe.");
    } finally { setActing(""); }
  }

  async function patch(item: Item, body: Record<string, string>) {
    setActing(item.id); setError("");
    try {
      const response = await fetch(`/api/extracted-findings/${encodeURIComponent(item.id)}`, { method: "PATCH", headers: await authHeaders(), body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiMessage(response.status, payload.error));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible actualizar el hallazgo.");
    } finally { setActing(""); }
  }

  async function confirmAllPending() {
    const pending = pendingItems(items);
    if (locked || pending.length === 0 || !window.confirm(`Confirmar ${pending.length} hallazgos pendientes?`)) return;
    setActing("confirm-all"); setError("");
    try {
      for (const item of pending) {
        const response = await fetch(`/api/extracted-findings/${encodeURIComponent(item.id)}`, { method: "PATCH", headers: await authHeaders(), body: JSON.stringify({ action: "confirm" }) });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(apiMessage(response.status, payload.error));
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible confirmar hallazgos pendientes.");
    } finally { setActing(""); }
  }

  const summary = {
    total: items.length,
    confirmed: items.filter((item) => item.codingStatus === "confirmed").length,
    pending: pendingItems(items).length,
    pendingDictionary: items.filter((item) => derive(item).dictionaryStatus === "pending_dictionary").length,
    unmapped: items.filter((item) => derive(item).codeStatus === "unmapped").length,
  };
  const groups = (Object.keys(groupLabels) as GroupKey[]).map((key) => ({ key, items: items.filter((item) => groupOf(item) === key) })).filter((group) => group.items.length > 0);

  return <details className="report-clinical-panel collapsible ai-findings-panel" open>
    <summary><span className="collapsible-icon">IA</span>Hallazgos sugeridos<span className="collapsible-count">{items.length}</span></summary>
    <p className="empty-inline">Hallazgos sugeridos automaticamente. Deben ser revisados por el usuario.</p>
    {!reportId && <p className="notice">Guarda el borrador antes de ejecutar la extraccion con IA.</p>}
    {reportStatus === "final" && <p className="empty-inline">El informe esta firmado: los hallazgos quedan en solo lectura.</p>}
    <div className="ai-panel-actions">
      <button className="button secondary" type="button" onClick={extract} disabled={!reportId || locked || !!acting}>{acting === "extract" ? "Analizando informe..." : "Detectar hallazgos con IA"}</button>
      <button className="text-button" type="button" onClick={load} disabled={!reportId || loading}>Actualizar</button>
      {!locked && summary.pending > 0 && <button className="text-button" type="button" onClick={confirmAllPending} disabled={!!acting}>Confirmar todos los pendientes</button>}
    </div>
    {items.length > 0 && <p className="ai-finding-summary">Total {summary.total} - {summary.pending} pendientes de revision - {summary.confirmed} confirmados - {summary.pendingDictionary} pendientes diccionario - {summary.unmapped} sin codificacion</p>}
    {items.length > 0 && <p className="empty-inline">La codificacion SNOMED/CIE-11 se realizara en el diccionario, no en esta vista.</p>}
    {error && <p className="notice" role="alert">{error}</p>}
    {loading ? <p className="empty-inline">Cargando hallazgos sugeridos...</p> : items.length === 0 ? <p className="empty-inline">Sin hallazgos sugeridos todavia.</p> : <div className="ai-finding-list">
      {/* Future use: reviewed structured findings can feed advanced search, statistics, optional coding, follow-up, and dictionary admin without changing original report text. */}
      {groups.map((group) => <section className="ai-finding-group" key={group.key}>
        <h4>{groupLabels[group.key]} <span>{group.items.length}</span></h4>
        {group.items.map((item) => {
          const status = derive(item);
          return <article className="workflow-entry ai-finding-card" key={item.id}>
          <div className="ai-finding-card-header">
            <strong title={item.findingText}>{titleOf(item)}</strong>
            {item.candidate && <span className="ai-finding-term">Nuevo termino - Pendiente diccionario</span>}
          </div>
          <div className="ai-finding-badges">
            <span>{statusLabels[item.status] ?? item.status}</span>
            <span>{importanceLabels[item.importance] ?? item.importance}</span>
            <span>{reviewLabels[status.reviewStatus] ?? status.reviewStatus}</span>
            <span>{dictionaryLabels[status.dictionaryStatus]}</span>
            <span>{codeLabels[status.codeStatus]}</span>
            <span>{Math.round(Number(item.confidence) * 100)}%</span>
          </div>
          {status.clinicalBadges.length > 0 && <div className="ai-clinical-badges">{status.clinicalBadges.map((badge) => <span key={badge}>{badge}</span>)}</div>}
          <span>{[item.bodySite, item.laterality && lateralityLabels[item.laterality], item.severity && severityLabels[item.severity]].filter(Boolean).join(" - ") || "Sin localizacion especifica"}</span>
          {item.dictionary && <span>Diccionario: {item.dictionary.canonicalName} ({item.dictionary.localCode})</span>}
          <details className="ai-finding-source">
            <summary>Ver fuente</summary>
            <span>{item.sourceSection}: {item.sourceSentence}</span>
          </details>
          <button className="text-button disabled-link" type="button" disabled>Mapeo terminologico pendiente</button>
          {!locked && <div className="ai-finding-actions">
            {status.reviewStatus !== "confirmed" && status.reviewStatus !== "rejected" && <button className="text-button" type="button" disabled={acting === item.id || acting === "confirm-all"} onClick={() => patch(item, { action: "confirm" })}>Confirmar</button>}
            {status.reviewStatus !== "rejected" && <button className="text-button danger" type="button" disabled={acting === item.id || acting === "confirm-all"} onClick={() => patch(item, { action: "reject", reason: window.prompt("Motivo del rechazo (opcional)") ?? "" })}>Rechazar</button>}
            <button className="text-button" type="button" disabled={acting === item.id || acting === "confirm-all"} onClick={() => { const correctedText = window.prompt("Texto corregido", item.findingText)?.trim(); if (correctedText) patch(item, { action: "correct", correctedText }); }}>Corregir</button>
          </div>}
        </article>;
        })}
      </section>)}
    </div>}
  </details>;
}
