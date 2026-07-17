import { NextRequest, NextResponse } from "next/server";
import { phrHealthItemFhirResource, type PhrHealthItem } from "@/features/patient-portal/health-summary";
import { requirePhrApi } from "@/lib/server-auth";

export async function GET(request: NextRequest) {
  const auth = await requirePhrApi(request);
  if (auth instanceof NextResponse) return auth;
  const [documents, labResults, healthItems] = await Promise.all([
    auth.db.from("patient_documents")
      .select("id, original_filename, storage_path, mime_type, size_bytes, document_date, document_type, clinical_area, source_institution, created_at")
      .eq("owner_user_id", auth.user.id),
    auth.db.from("phr_lab_results")
      .select("id, document_id, loinc_code, analyte, canonical_analyte, value_num, value_text, unit, ref_low, ref_high, ref_text, flag, observed_at")
      .eq("owner_user_id", auth.user.id).eq("review_status", "confirmed"),
    auth.db.from("phr_health_items")
      .select("id, kind, label, status, event_date, source, source_document_id, notes, created_at")
      .eq("owner_user_id", auth.user.id),
  ]);
  if (documents.error || labResults.error || healthItems.error) return NextResponse.json({ error: "No fue posible generar la exportación." }, { status: 500 });
  const ownerId = auth.user.id;
  const entries: { fullUrl: string; resource: Record<string, unknown> }[] = [];
  const signedByDocument = new Map<string, string>();
  entries.push({ fullUrl: `urn:uuid:${ownerId}`, resource: {
    resourceType: "Patient", id: ownerId, active: true,
    identifier: auth.profile.identifier ? [{ system: "urn:phr:identifier:local", value: auth.profile.identifier }] : undefined,
    name: [{ text: auth.profile.full_name }], birthDate: auth.profile.birth_date,
  }});
  for (const document of documents.data ?? []) {
    const signed = await auth.db.storage.from("patient-documents").createSignedUrl(document.storage_path, 300);
    if (signed.data?.signedUrl) signedByDocument.set(document.id, signed.data.signedUrl);
    entries.push({ fullUrl: `urn:uuid:${document.id}`, resource: {
      resourceType: "DocumentReference", id: document.id, status: "current", subject: { reference: `Patient/${ownerId}` },
      date: document.created_at, description: `${document.source_institution} · ${document.document_type}`,
      category: [{ text: document.clinical_area }],
      author: [{ display: document.source_institution }],
      content: [{ attachment: { contentType: document.mime_type, url: signed.data?.signedUrl, size: document.size_bytes, title: document.original_filename, creation: document.document_date } }],
    }});
  }
  for (const result of labResults.data ?? []) {
    const display = result.canonical_analyte || result.analyte;
    const referenceRange = result.ref_low !== null || result.ref_high !== null || result.ref_text
      ? [{ low: result.ref_low !== null ? { value: result.ref_low, unit: result.unit } : undefined, high: result.ref_high !== null ? { value: result.ref_high, unit: result.unit } : undefined, text: result.ref_text || undefined }]
      : undefined;
    entries.push({ fullUrl: `urn:uuid:${result.id}`, resource: {
      resourceType: "Observation", id: result.id, status: "final", subject: { reference: `Patient/${ownerId}` },
      code: { coding: result.loinc_code ? [{ system: "http://loinc.org", code: result.loinc_code, display }] : undefined, text: display },
      effectiveDateTime: `${result.observed_at}T00:00:00Z`,
      ...(result.value_num !== null ? { valueQuantity: { value: result.value_num, unit: result.unit } } : { valueString: result.value_text }),
      referenceRange, interpretation: result.flag ? [{ text: result.flag }] : undefined,
      derivedFrom: [{ reference: `DocumentReference/${result.document_id}` }],
    }});
  }
  const healthReferences = new Map<string, { reference: string }[]>();
  for (const item of healthItems.data ?? []) {
    const normalized = { id: item.id, kind: item.kind, label: item.label, status: item.status, eventDate: item.event_date ?? "", source: item.source, sourceDocumentId: item.source_document_id ?? "", notes: item.notes, createdAt: item.created_at } as PhrHealthItem;
    const resource = phrHealthItemFhirResource(normalized, ownerId);
    const reference = `${resource.resourceType}/${item.id}`;
    healthReferences.set(item.kind, [...(healthReferences.get(item.kind) ?? []), { reference }]);
    entries.push({ fullUrl: `urn:uuid:${item.id}`, resource });
  }
  type LabResultRow = NonNullable<typeof labResults.data>[number];
  const resultsByDocument = new Map<string, LabResultRow[]>();
  for (const result of labResults.data ?? []) resultsByDocument.set(result.document_id, [...(resultsByDocument.get(result.document_id) ?? []), result]);
  for (const document of documents.data ?? []) {
    const results = resultsByDocument.get(document.id) ?? [];
    if (!results.length) continue;
    entries.push({ fullUrl: `urn:uuid:${crypto.randomUUID()}`, resource: {
      resourceType: "DiagnosticReport", id: `lab-${document.id}`, status: "final",
      code: { text: "Informe de laboratorio" }, subject: { reference: `Patient/${ownerId}` },
      effectiveDateTime: `${document.document_date ?? results[0].observed_at}T00:00:00Z`, issued: document.created_at,
      performer: [{ display: document.source_institution }],
      result: results.map((result) => ({ reference: `Observation/${result.id}` })),
      presentedForm: [{ contentType: document.mime_type, url: signedByDocument.get(document.id), title: document.original_filename }],
    }});
  }
  const compositionId = crypto.randomUUID(), now = new Date().toISOString();
  const sections = [
    ["Alergias", healthReferences.get("allergy")], ["Condiciones", healthReferences.get("condition")],
    ["Medicamentos", healthReferences.get("medication")], ["Vacunas", healthReferences.get("immunization")],
    ["Procedimientos", healthReferences.get("procedure")],
    ["Resultados de laboratorio", (labResults.data ?? []).map((result) => ({ reference: `Observation/${result.id}` }))],
    ["Documentos", (documents.data ?? []).map((document) => ({ reference: `DocumentReference/${document.id}` }))],
  ].filter(([, references]) => references?.length).map(([title, references]) => ({ title, entry: references }));
  entries.unshift({ fullUrl: `urn:uuid:${compositionId}`, resource: {
    resourceType: "Composition", id: compositionId, status: "final", type: { coding: [{ system: "http://loinc.org", code: "60591-5", display: "Patient summary Document" }], text: "Resumen personal de salud" },
    subject: { reference: `Patient/${ownerId}` }, date: now, author: [{ reference: `Patient/${ownerId}` }], title: "Resumen personal de salud", section: sections,
  }});
  const bundle = { resourceType: "Bundle", type: "document", identifier: { system: "urn:phr:summary", value: compositionId }, timestamp: now, total: entries.length, entry: entries };
  return new NextResponse(JSON.stringify(bundle, null, 2), { headers: { "Content-Type": "application/fhir+json", "Content-Disposition": "attachment; filename=mi-registro-fhir.json", "Cache-Control": "no-store" } });
}
