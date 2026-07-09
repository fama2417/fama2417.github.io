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
  candidate: { id: string; rawText: string; status: string } | null;
};

const statusLabels: Record<string, string> = { present: "Presente", absent: "Ausente", uncertain: "Incierto", history: "Antecedente", recommendation: "Recomendacion" };
const importanceLabels: Record<string, string> = { principal: "Principal", secondary: "Secundario", incidental: "Incidental", negative: "Negativo", not_relevant: "No relevante" };
const lateralityLabels: Record<string, string> = { right: "Derecha", left: "Izquierda", bilateral: "Bilateral", midline: "Linea media", unknown: "No especificada" };
const severityLabels: Record<string, string> = { mild: "Leve", moderate: "Moderada", severe: "Severa", unknown: "No especificada" };
const codingLabels: Record<string, string> = { suggested: "Sugerido", confirmed: "Confirmado", corrected: "Corregido", rejected: "Rechazado", not_required: "No requerido" };

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

  return <details className="report-clinical-panel collapsible ai-findings-panel" open>
    <summary><span className="collapsible-icon">IA</span>Hallazgos sugeridos<span className="collapsible-count">{items.length}</span></summary>
    <p className="empty-inline">Hallazgos sugeridos automaticamente. Deben ser revisados por el usuario.</p>
    {!reportId && <p className="notice">Guarda el borrador antes de ejecutar la extraccion con IA.</p>}
    {reportStatus === "final" && <p className="empty-inline">El informe esta firmado: los hallazgos quedan en solo lectura.</p>}
    <div className="ai-panel-actions">
      <button className="button secondary" type="button" onClick={extract} disabled={!reportId || locked || !!acting}>{acting === "extract" ? "Analizando informe..." : "Detectar hallazgos con IA"}</button>
      <button className="text-button" type="button" onClick={load} disabled={!reportId || loading}>Actualizar</button>
    </div>
    {error && <p className="notice" role="alert">{error}</p>}
    {loading ? <p className="empty-inline">Cargando hallazgos sugeridos...</p> : items.length === 0 ? <p className="empty-inline">Sin hallazgos sugeridos todavia.</p> : <div className="ai-finding-list">
      {items.map((item) => <article className="workflow-entry ai-finding-card" key={item.id}>
        <strong>{item.findingText}</strong>
        <span>{statusLabels[item.status] ?? item.status} · {importanceLabels[item.importance] ?? item.importance} · {codingLabels[item.codingStatus] ?? item.codingStatus} · {Math.round(Number(item.confidence) * 100)}%</span>
        <span>Fuente: {item.sourceSection} · {item.sourceSentence}</span>
        <span>{[item.bodySite, item.laterality && lateralityLabels[item.laterality], item.severity && severityLabels[item.severity]].filter(Boolean).join(" · ")}</span>
        {item.dictionary && <span>Diccionario: {item.dictionary.canonicalName} ({item.dictionary.localCode})</span>}
        {item.candidate && <span>Candidato: {item.candidate.rawText} · {item.candidate.status}</span>}
        {!locked && <div className="ai-finding-actions">
          <button className="text-button" type="button" disabled={acting === item.id} onClick={() => patch(item, { action: "confirm" })}>Confirmar</button>
          <button className="text-button danger" type="button" disabled={acting === item.id} onClick={() => patch(item, { action: "reject", reason: window.prompt("Motivo del rechazo (opcional)") ?? "" })}>Rechazar</button>
          <button className="text-button" type="button" disabled={acting === item.id} onClick={() => { const correctedText = window.prompt("Texto corregido", item.findingText)?.trim(); if (correctedText) patch(item, { action: "correct", correctedText }); }}>Corregir</button>
        </div>}
      </article>)}
    </div>}
  </details>;
}
