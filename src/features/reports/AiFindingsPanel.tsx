"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase-client";
import { isAiOperationActive, runAiExtractionWorkflow, type AiOperationState } from "./ai-extraction-workflow";

type Item = {
  id: string; findingText: string; status: string; importance: string; sourceSection: string; sourceSentence: string;
  bodySite: string | null; laterality: string | null; severity: string | null; confidence: number; codingStatus: string;
  dictionary: { id: string; localCode: string; canonicalName: string } | null;
  candidate: { id: string; rawText: string; suggestedCanonicalName: string; status: string } | null;
};

type SummaryItem = {
  title: string; summary: string; category: string; sites: string[]; trend: string; sourceSection: string;
  sourceSentences: string[]; confidence: number;
};

type ClinicalSummary = {
  reportingProfile: string; modalityContext: string; clinicalContext: string | null;
  oncologyContext: { disease: string | null; priorStudyDate: string | null; treatmentContext: string | null } | null;
  globalResponse: { status: string; explanation: string; confidence: number } | null;
  globalAssessment: { status: string; text: string; confidence: number };
  scores: { name: string; value: string; sourceSentence: string; confidence: number }[];
  primarySummaryItems: SummaryItem[];
  activeDiseaseSites: string[]; resolvedSites: string[]; stableSites: string[]; incidentalFindings: string[];
  qualityWarnings: { type: string; message: string }[]; clinicalTags: string[];
  lesionTracking: { label: string; site: string; currentSize: string | null; priorSize: string | null; currentSuv: string | null; priorSuv: string | null; sizeTrend: string; metabolicTrend: string; sourceSentence: string }[];
  warnings: string[];
};

const statusLabels: Record<string, string> = { present: "Presente", absent: "Ausente", uncertain: "Incierto", history: "Antecedente", recommendation: "Recomendacion" };
const importanceLabels: Record<string, string> = { principal: "Principal", secondary: "Secundario", incidental: "Incidental", negative: "Negativo", not_relevant: "No relevante" };
const reviewLabels: Record<string, string> = { suggested: "Sugerido", confirmed: "Confirmado", corrected: "Corregido", rejected: "Rechazado", not_required: "No requerido" };
const lateralityLabels: Record<string, string> = { right: "Derecha", left: "Izquierda", bilateral: "Bilateral", midline: "Linea media", unknown: "No especificada" };
const severityLabels: Record<string, string> = { mild: "Leve", moderate: "Moderada", severe: "Severa", unknown: "No especificada" };
const assessmentLabels: Record<string, string> = { progression: "Progresión", stable: "Estable", partial_response: "Respuesta parcial", complete_response: "Respuesta completa", mixed_response: "Respuesta mixta", indeterminate: "Indeterminado", not_applicable: "No aplica", unknown: "No determinado" };
const trendLabels: Record<string, string> = { new: "Nuevo", progression: "Progresión", stable: "Estable", decreased: "En disminución", resolved: "Resuelto", unknown: "No determinado", not_applicable: "No aplica" };
const categoryLabels: Record<string, string> = { active_disease: "Enfermedad activa", progression: "Progresión", stable_disease: "Enfermedad estable", resolved: "Lesiones resueltas", incidental: "Incidental relevante", negative_relevant: "Negativos relevantes", recommendation: "Recomendaciones", quality_warning: "Alertas" };
const profileLabels: Record<string, string> = { PET_CT_ONCOLOGY: "PET-CT oncológico", CT_ABDOMEN_PELVIS: "TC abdomen y pelvis", CT_CHEST: "TC tórax", MR_BRAIN: "RM cerebro", MR_SPINE: "RM columna", BREAST_IMAGING: "Imagen mamaria", US_GENERAL: "Ecografía general", DX_GENERAL: "Radiografía general", UNKNOWN: "No determinado" };
const tagLabels: Record<string, string> = { oncology: "Oncología", progression: "Progresión", stable: "Estable", resolved_lesions: "Lesiones resueltas", deauville_5: "Deauville 5", incidental_findings: "Hallazgos incidentales", follow_up_relevant: "Seguimiento relevante", report_quality_warning: "Alerta de calidad", procedure_content_mismatch: "Discordancia prestación/contenido", missing_impression: "Sin impresión" };
const lesionTrendLabels: Record<string, string> = { increased: "Aumentó", decreased: "Disminuyó", stable: "Estable", unknown: "No determinado" };
const groupLabels = { principal: "Hallazgos principales", secondary: "Hallazgos secundarios", incidental: "Hallazgos incidentales", negative: "Hallazgos negativos", reviewed: "Rechazados o corregidos" } as const;
type GroupKey = keyof typeof groupLabels;

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${data.session?.access_token ?? ""}`, "Content-Type": "application/json" };
}

const apiMessage = (status: number, error?: string) => {
  if (status === 403) return "La extraccion con IA esta deshabilitada.";
  if (status === 503) return "OpenAI no esta configurado en el servidor.";
  if (status === 429) return "Se alcanzo el limite configurado para IA.";
  return error || "No fue posible completar la accion.";
};

const titleOf = (item: Item) => item.dictionary?.canonicalName || item.candidate?.suggestedCanonicalName || (item.findingText.length > 92 ? `${item.findingText.slice(0, 89)}...` : item.findingText);
const plainText = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const formatClinicalContext = (value: string) => value.replace(/^(.+?)\s*\(seg[uú]n nombre de prestaci[oó]n\)/i, "Prestación registrada: $1");
const isRoutineNegative = (item: Item) => item.status === "absent" || ["negative", "not_relevant"].includes(item.importance) || /^(sin|no (se |hay|presenta|observa|identifica)|normal|conservad|permeable)/i.test(item.findingText.trim());
const confirmableItems = (items: Item[]) => items.filter((item) => item.codingStatus === "suggested" && Number(item.confidence) >= 0.75 && !isRoutineNegative(item));
const groupOf = (item: Item): GroupKey => {
  if (["rejected", "corrected"].includes(item.codingStatus)) return "reviewed";
  if (isRoutineNegative(item)) return "negative";
  if (item.importance === "principal") return "principal";
  if (item.importance === "incidental") return "incidental";
  return "secondary";
};

function CompactClinicalText({ text }: { text: string }) {
  if (text.length <= 220) return <strong>{text}</strong>;
  return <><strong>{text.slice(0, 217)}...</strong><details className="ai-finding-source"><summary>Ver explicación completa</summary><span>{text}</span></details></>;
}

export function AiFindingsPanel({ reportId, reportStatus, disabled, ensureDraftSaved, onOperationActiveChange }: {
  reportId?: string;
  reportStatus?: string;
  disabled?: boolean;
  ensureDraftSaved: () => Promise<void>;
  onOperationActiveChange?: (active: boolean) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [clinicalSummary, setClinicalSummary] = useState<ClinicalSummary | null>(null);
  const [mode, setMode] = useState<"summary" | "detail">("summary");
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState("");
  const [error, setError] = useState("");
  const [operationState, setOperationState] = useState<AiOperationState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const mountedRef = useRef(true);
  const runningRef = useRef(false);
  const runIdRef = useRef(0);
  const locked = disabled || reportStatus === "final";
  const operationActive = isAiOperationActive(operationState);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; runIdRef.current += 1; };
  }, []);

  useEffect(() => { onOperationActiveChange?.(operationActive); }, [onOperationActiveChange, operationActive]);
  useEffect(() => () => onOperationActiveChange?.(false), [onOperationActiveChange]);

  useEffect(() => {
    if (operationState !== "analyzing") { setElapsedSeconds(0); return; }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (mountedRef.current) setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [operationState]);

  async function fetchResults() {
    if (!reportId) return { items: [] as Item[], clinicalSummary: null as ClinicalSummary | null };
    const response = await fetch(`/api/reports/${encodeURIComponent(reportId)}/extracted-findings`, { headers: await authHeaders() });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(apiMessage(response.status, payload.error));
    if (!Array.isArray(payload.items) || !("clinicalSummary" in payload)) throw new Error("No fue posible completar el análisis.");
    return { items: payload.items as Item[], clinicalSummary: (payload.clinicalSummary ?? null) as ClinicalSummary | null };
  }

  async function load() {
    if (!reportId) return;
    setLoading(true); setError("");
    try {
      const result = await fetchResults();
      if (mountedRef.current) { setItems(result.items); setClinicalSummary(result.clinicalSummary); }
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : "No fue posible cargar la extraccion IA.");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    runIdRef.current += 1;
    runningRef.current = false;
    setOperationState("idle");
    load();
  }, [reportId]);

  async function extract() {
    if (!reportId || locked || runningRef.current) return;
    const force = items.length > 0 || clinicalSummary !== null;
    if (force && !window.confirm("Ya existen hallazgos IA para este informe. Deseas recalcularlos?")) return;
    runningRef.current = true;
    const runId = ++runIdRef.current;
    const isCurrent = () => mountedRef.current && runIdRef.current === runId;
    setError("");
    try {
      const result = await runAiExtractionWorkflow({
        saveDraft: async () => {
          await ensureDraftSaved();
          if (!isCurrent()) throw new Error("Obsolete extraction");
        },
        analyze: async () => {
          const response = await fetch(`/api/reports/${encodeURIComponent(reportId)}/ai/extract-findings`, { method: "POST", headers: await authHeaders(), body: JSON.stringify({ force }) });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(apiMessage(response.status, payload.error));
          if (!isCurrent()) throw new Error("Obsolete extraction");
        },
        refresh: async () => {
          const refreshed = await fetchResults();
          if (!isCurrent()) throw new Error("Obsolete extraction");
          return refreshed;
        },
      }, (state) => { if (isCurrent()) setOperationState(state); });
      if (!isCurrent()) return;
      if (result.ok) {
        setItems(result.value.items);
        setClinicalSummary(result.value.clinicalSummary);
      } else {
        setError(result.phase === "saving" ? "No fue posible guardar el borrador. El análisis no se inició." : "No fue posible completar el análisis.");
      }
    } finally {
      if (runIdRef.current === runId) runningRef.current = false;
    }
  }

  async function patch(item: Item, body: Record<string, string>) {
    if (operationActive) return;
    setActing(item.id); setError("");
    try {
      const response = await fetch(`/api/extracted-findings/${encodeURIComponent(item.id)}`, { method: "PATCH", headers: await authHeaders(), body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiMessage(response.status, payload.error));
      await load();
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : "No fue posible actualizar el hallazgo.");
    } finally {
      if (mountedRef.current) setActing("");
    }
  }

  async function confirmAll() {
    const pending = confirmableItems(items);
    if (locked || operationActive || !pending.length || !window.confirm(`Confirmar ${pending.length} hallazgos? Se excluyen negativos rutinarios y confianza menor a 75%.`)) return;
    setActing("confirm-all"); setError("");
    try {
      for (const item of pending) {
        const response = await fetch(`/api/extracted-findings/${encodeURIComponent(item.id)}`, { method: "PATCH", headers: await authHeaders(), body: JSON.stringify({ action: "confirm" }) });
        if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(apiMessage(response.status, payload.error)); }
      }
      await load();
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : "No fue posible confirmar los hallazgos.");
    } finally {
      if (mountedRef.current) setActing("");
    }
  }

  const pendingReview = items.filter((item) => item.codingStatus === "suggested").length;
  const pendingDictionary = items.filter((item) => item.candidate).length;
  const extractedSummaryItems = clinicalSummary?.primarySummaryItems ?? [];
  const isMainSummaryItem = (item: SummaryItem) => ["active_disease", "progression", "stable_disease"].includes(item.category);
  const summaryItems = [...extractedSummaryItems.filter(isMainSummaryItem).slice(0, 3), ...extractedSummaryItems.filter((item) => !isMainSummaryItem(item))].slice(0, 8);
  const summaryGroups = Object.entries(categoryLabels).map(([key, label]) => ({ key, label, items: summaryItems.filter((item) => item.category === key) })).filter((group) => group.items.length);
  const visibleItems = showAll ? items : items.slice(0, 10);
  const technicalGroups = (Object.keys(groupLabels) as GroupKey[]).map((key) => ({ key, items: visibleItems.filter((item) => groupOf(item) === key) })).filter((group) => group.items.length);
  const qaWarnings = clinicalSummary?.qualityWarnings.map((warning) => warning.message) ?? [];
  const qualityTypes = new Set(clinicalSummary?.qualityWarnings.map((warning) => warning.type) ?? []);
  const discordanceWarnings = qualityTypes.has("procedure_content_mismatch") ? [] : clinicalSummary?.warnings.filter((warning) => plainText(warning).includes("discordancia")) ?? [];
  const sourceWarnings = qualityTypes.has("missing_impression") ? [] : clinicalSummary?.warnings.filter((warning) => plainText(warning).includes("resumen generado desde hallazgos")) ?? [];
  const bannerWarnings = [...new Set([...qaWarnings, ...discordanceWarnings, ...sourceWarnings])];
  const otherWarnings = clinicalSummary?.warnings.filter((warning) => !bannerWarnings.includes(warning)) ?? [];
  const assessment = clinicalSummary?.globalResponse
    ? { status: clinicalSummary.globalResponse.status, text: clinicalSummary.globalResponse.explanation, confidence: clinicalSummary.globalResponse.confidence }
    : clinicalSummary?.globalAssessment;
  const lowAssessmentConfidence = Number(assessment?.confidence ?? 1) < 0.6;
  const assessmentText = assessment ? (lowAssessmentConfidence ? `Evaluación orientativa: ${assessment.text}` : assessment.text) : "";
  const trackedLesions = clinicalSummary?.lesionTracking.filter((lesion) => /^LT[1-3]$/i.test(lesion.label) && lesion.site && lesion.sourceSentence && (lesion.currentSize || lesion.priorSize || lesion.currentSuv || lesion.priorSuv)) ?? [];
  const operationMessage: Record<AiOperationState, string> = {
    idle: "",
    saving: "Guardando borrador antes del análisis…",
    analyzing: "Analizando el informe…",
    refreshing: "Actualizando resultados…",
    success: "Resumen actualizado.",
    error: error || "No fue posible completar el análisis.",
  };

  return <details className="report-clinical-panel collapsible ai-findings-panel" open>
    <summary><span className="collapsible-icon">IA</span>Resumen IA<span className="collapsible-count">{summaryItems.length || items.length}</span></summary>
    <p className="empty-inline">Resumen sugerido automaticamente. Debe ser revisado por el usuario.</p>
    {!reportId && <p className="notice">Guarda el borrador antes de ejecutar la extraccion con IA.</p>}
    {reportStatus === "final" && <p className="empty-inline">El informe esta firmado: la extraccion queda en solo lectura.</p>}
    <div className="ai-panel-actions">
      <button className="button secondary" type="button" onClick={extract} disabled={!reportId || locked || !!acting || operationActive}>{clinicalSummary || items.length ? "Recalcular resumen IA" : "Detectar hallazgos con IA"}</button>
      <button className="text-button" type="button" onClick={load} disabled={!reportId || loading || operationActive}>Actualizar</button>
    </div>
    {operationState !== "idle" && <div className={`ai-operation-status ${operationState}`} role={operationState === "error" ? "alert" : "status"} aria-live={operationState === "error" ? "assertive" : "polite"} aria-busy={operationActive}>
      <strong>{operationMessage[operationState]}</strong>
      {operationState === "analyzing" && <>
        <div className="ai-operation-progress" role="progressbar" aria-label="Análisis IA en curso"><span /></div>
        <span>{elapsedSeconds} s transcurridos</span>
        {elapsedSeconds >= 15 && <span>El análisis está tomando más de lo habitual. Puedes continuar revisando las imágenes.</span>}
      </>}
      {operationState === "error" && <button className="text-button" type="button" disabled={locked || !!acting} onClick={extract}>Reintentar</button>}
    </div>}
    {error && operationState !== "error" && <p className="notice" role="alert">{error}</p>}
    <div className="ai-view-switch" role="group" aria-label="Vista de extraccion IA">
      <button type="button" aria-pressed={mode === "summary"} onClick={() => setMode("summary")}>Resumen clinico</button>
      <button type="button" aria-pressed={mode === "detail"} onClick={() => setMode("detail")}>Detalle tecnico / diccionario</button>
    </div>
    {loading ? <p className="empty-inline">Cargando extraccion IA...</p> : mode === "summary" ? <div className="ai-clinical-summary">
      {clinicalSummary ? <>
        {bannerWarnings.map((warning) => <p className="notice" role="alert" key={warning}>{warning}</p>)}
        <header className="ai-summary-header">
          <div><span>Perfil detectado</span><strong>{profileLabels[clinicalSummary.reportingProfile] ?? clinicalSummary.reportingProfile}</strong></div>
          <div><span>Contexto</span><strong>{formatClinicalContext(clinicalSummary.clinicalContext || clinicalSummary.modalityContext)}</strong></div>
          {assessment && <div className="ai-summary-assessment"><span>Evaluación global</span><CompactClinicalText text={assessmentText} /><small>{assessmentLabels[assessment.status] ?? assessment.status} - {lowAssessmentConfidence ? "Baja confianza - " : ""}{Math.round(assessment.confidence * 100)}%</small></div>}
          {clinicalSummary.scores.map((score) => <div key={`${score.name}-${score.value}`}><span>Score</span><strong>{score.name} {score.value}</strong></div>)}
          <div><span>Detalle</span><strong>{items.length} hallazgos</strong><small>{pendingReview} pendientes - {pendingDictionary} en diccionario</small></div>
          {clinicalSummary.clinicalTags.length > 0 && <div><span>Etiquetas clínicas</span><div className="ai-finding-badges">{clinicalSummary.clinicalTags.map((tag) => <span key={tag}>{tagLabels[tag] ?? tag}</span>)}</div></div>}
        </header>
        {summaryGroups.map((group) => <section className="ai-summary-group" key={group.key}>
          <h4>{group.label}</h4>
          {group.items.map((item, index) => <article key={`${group.key}-${index}`}>
            <div><strong>{item.title}</strong><span>{item.summary}</span></div>
            <div className="ai-finding-badges"><span>{trendLabels[item.trend] ?? item.trend}</span><span>{Math.round(item.confidence * 100)}%</span></div>
            <details className="ai-finding-source"><summary>Ver fuente</summary>{item.sourceSentences.map((source) => <span key={source}>{source}</span>)}</details>
          </article>)}
        </section>)}
        {trackedLesions.length > 0 && <details className="ai-finding-group">
          <summary>Seguimiento de lesiones ({trackedLesions.length})</summary>
          {trackedLesions.map((lesion) => <article className="ai-finding-row" key={lesion.label}>
            <div><strong>{lesion.label} - {lesion.site}</strong><span>Tamaño: {lesion.currentSize || "No determinado"} (previo: {lesion.priorSize || "No determinado"})</span><span>SUV: {lesion.currentSuv || "No determinado"} (previo: {lesion.priorSuv || "No determinado"})</span></div>
            <div className="ai-finding-badges"><span>Tamaño {lesionTrendLabels[lesion.sizeTrend] ?? lesion.sizeTrend}</span><span>Metabolismo {lesionTrendLabels[lesion.metabolicTrend] ?? lesion.metabolicTrend}</span></div>
            <details className="ai-finding-source"><summary>Ver fuente</summary><span>{lesion.sourceSentence}</span></details>
          </article>)}
        </details>}
        {items.length > 10 && <button className="text-button" type="button" onClick={() => setMode("detail")}>{items.length} hallazgos técnicos extraídos. Ver detalle.</button>}
        {otherWarnings.length > 0 && <details className="ai-summary-warnings"><summary>{otherWarnings.length} alertas de extracción</summary>{otherWarnings.map((warning) => <p key={warning}>{warning}</p>)}</details>}
      </> : <p className="empty-inline">{items.length ? "Este informe tiene detalle tecnico previo. Recalcula para generar el resumen clinico." : "Sin extraccion IA todavia."}</p>}
    </div> : <div className="ai-technical-detail">
      <p className="ai-finding-summary">{items.length} hallazgos tecnicos extraidos. {items.length > 10 && !showAll ? "Se muestran los 10 de mayor prioridad." : ""}</p>
      <p className="empty-inline">La codificacion SNOMED/CIE-11 se realizara en el diccionario, no en esta vista.</p>
      {!locked && confirmableItems(items).length > 0 && <button className="text-button" type="button" onClick={confirmAll} disabled={!!acting || operationActive}>Confirmar {confirmableItems(items).length} revisables</button>}
      {technicalGroups.map((group) => {
        const content = group.items.map((item) => <article className="ai-finding-row" key={item.id}>
          <div><strong title={item.findingText}>{titleOf(item)}</strong><span>{[item.bodySite, item.laterality && lateralityLabels[item.laterality], item.severity && severityLabels[item.severity]].filter(Boolean).join(" - ")}</span></div>
          <div className="ai-finding-badges"><span>{statusLabels[item.status] ?? item.status}</span><span>{importanceLabels[item.importance] ?? item.importance}</span><span>{reviewLabels[item.codingStatus] ?? item.codingStatus}</span>{item.candidate && <span>Pendiente diccionario</span>}{!item.dictionary && !item.candidate && <span>Sin codificacion</span>}<span>{Math.round(Number(item.confidence) * 100)}%</span></div>
          <details className="ai-finding-source"><summary>Ver fuente</summary><span>{item.sourceSentence}</span></details>
          {!locked && <div className="ai-finding-actions">
            {item.codingStatus === "suggested" && <button className="text-button" type="button" disabled={!!acting || operationActive} onClick={() => patch(item, { action: "confirm" })}>Confirmar</button>}
            {item.codingStatus !== "rejected" && <button className="text-button danger" type="button" disabled={!!acting || operationActive} onClick={() => patch(item, { action: "reject", reason: window.prompt("Motivo del rechazo (opcional)") ?? "" })}>Rechazar</button>}
            <button className="text-button" type="button" disabled={!!acting || operationActive} onClick={() => { const correctedText = window.prompt("Texto corregido", item.findingText)?.trim(); if (correctedText) patch(item, { action: "correct", correctedText }); }}>Corregir</button>
          </div>}
        </article>);
        return group.key === "negative" ? <details className="ai-finding-group" key={group.key}><summary>{groupLabels[group.key]} ({group.items.length})</summary>{content}</details> : <section className="ai-finding-group" key={group.key}><h4>{groupLabels[group.key]} <span>{group.items.length}</span></h4>{content}</section>;
      })}
      {items.length > 10 && <button className="text-button" type="button" onClick={() => setShowAll((value) => !value)}>{showAll ? "Mostrar menos" : `Ver los ${items.length} hallazgos tecnicos`}</button>}
    </div>}
  </details>;
}
