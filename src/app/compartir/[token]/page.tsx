import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { reportedRangeLabel } from "@/features/patient-portal/longitudinal";
import { serviceDatabase } from "@/lib/server-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Resumen compartido · Mi Salud", robots: { index: false, follow: false } };

const shownDate = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("es-CL");
const unavailable = <main className="portal-shell phr-public-share"><section className="card portal-card"><p className="eyebrow">Mi Salud</p><h1>Enlace no disponible</h1><p>El enlace expiró, fue revocado o no existe. Solicita uno nuevo a la persona que lo compartió.</p></section></main>;

export default async function SharedPhrPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return unavailable;
  const db = serviceDatabase(), tokenHash = createHash("sha256").update(token).digest("hex");
  const share = await db.from("phr_share_links").select("id, owner_user_id, title, include_emergency, expires_at, revoked_at").eq("token_hash", tokenHash).maybeSingle();
  if (!share.data || share.data.revoked_at || share.data.expires_at <= new Date().toISOString()) return unavailable;
  const [profile, selectedDocuments, selectedResults] = await Promise.all([
    db.from("phr_profiles").select("full_name, birth_date, blood_type, allergies, conditions, medications, emergency_contact_name, emergency_contact_phone, emergency_notes").eq("user_id", share.data.owner_user_id).single(),
    db.from("phr_share_documents").select("document_id").eq("share_id", share.data.id),
    db.from("phr_share_results").select("result_id").eq("share_id", share.data.id),
  ]);
  if (!profile.data) return unavailable;
  const documentIds = (selectedDocuments.data ?? []).map((row) => row.document_id), resultIds = (selectedResults.data ?? []).map((row) => row.result_id);
  const [documents, results] = await Promise.all([
    documentIds.length ? db.from("patient_documents").select("id, original_filename, storage_path, mime_type, document_date, source_institution, created_at").in("id", documentIds) : Promise.resolve({ data: [] }),
    resultIds.length ? db.from("phr_lab_results").select("id, analyte, value_num, value_text, unit, ref_low, ref_high, ref_text, flag, observed_at").in("id", resultIds).eq("review_status", "confirmed").order("observed_at", { ascending: false }) : Promise.resolve({ data: [] }),
  ]);
  const signedDocuments = await Promise.all((documents.data ?? []).map(async (document) => {
    const signed = await db.storage.from("patient-documents").createSignedUrl(document.storage_path, 600);
    return { ...document, url: signed.data?.signedUrl ?? "" };
  }));
  const requestHeaders = await headers(), ip = requestHeaders.get("x-forwarded-for")?.split(",")[0].trim() ?? "";
  const ipHash = createHash("sha256").update(`${tokenHash}:${ip}`).digest("hex");
  await db.rpc("log_phr_share_access", { p_share_id: share.data.id, p_ip_hash: ipHash, p_user_agent: requestHeaders.get("user-agent") ?? "" });
  const p = profile.data;
  return <main className="portal-shell phr-public-share"><header className="portal-header"><div><p className="eyebrow">Mi Salud · Solo lectura</p><strong>{share.data.title}</strong></div><span>Expira el {new Date(share.data.expires_at).toLocaleString("es-CL")}</span></header>
    <section className="card portal-card"><h1>Resumen compartido por {p.full_name}</h1><p>Datos seleccionados por la persona. No sustituyen una evaluación clínica ni entregan diagnósticos.</p></section>
    {share.data.include_emergency && <section className="card portal-card"><p className="eyebrow">Perfil de emergencia</p><h2>Información declarada</h2><dl className="phr-summary-grid"><div><dt>Grupo sanguíneo</dt><dd>{p.blood_type || "No informado"}</dd></div><div><dt>Alergias</dt><dd>{p.allergies || "No informadas"}</dd></div><div><dt>Condiciones</dt><dd>{p.conditions || "No informadas"}</dd></div><div><dt>Medicamentos</dt><dd>{p.medications || "No informados"}</dd></div><div><dt>Contacto</dt><dd>{[p.emergency_contact_name, p.emergency_contact_phone].filter(Boolean).join(" · ") || "No informado"}</dd></div>{p.emergency_notes && <div><dt>Notas</dt><dd>{p.emergency_notes}</dd></div>}</dl></section>}
    {!!results.data?.length && <section className="card portal-card"><p className="eyebrow">Biomarcadores seleccionados</p><h2>Resultados confirmados</h2><ul className="phr-shared-results">{results.data.map((result) => <li key={result.id}><div><strong>{result.analyte}</strong><span>{shownDate(result.observed_at)}</span></div><div><strong>{result.value_num ?? result.value_text} {result.unit}</strong><span>{reportedRangeLabel(result)}</span></div></li>)}</ul></section>}
    {!!signedDocuments.length && <section className="card portal-card"><p className="eyebrow">Documentos seleccionados</p><h2>Originales compartidos</h2><ul className="portal-list">{signedDocuments.map((document) => <li key={document.id}><div className="portal-document-detail"><strong>{document.original_filename}</strong><span>{document.source_institution} · {shownDate(document.document_date ?? document.created_at)}</span></div>{document.url && <a className="button secondary" href={document.url} target="_blank" rel="noreferrer">Abrir</a>}</li>)}</ul></section>}
  </main>;
}
