import { NextRequest, NextResponse } from "next/server";
import { requirePhrApi } from "@/lib/server-auth";

export async function GET(request: NextRequest) {
  const auth = await requirePhrApi(request);
  if (auth instanceof NextResponse) return auth;
  const [documents, labResults] = await Promise.all([
    auth.db.from("patient_documents")
      .select("id, original_filename, storage_path, mime_type, size_bytes, document_date, document_type, source_institution, created_at")
      .eq("owner_user_id", auth.user.id),
    auth.db.from("phr_lab_results")
      .select("id, document_id, loinc_code, analyte, value_num, value_text, unit, ref_low, ref_high, ref_text, flag, observed_at")
      .eq("owner_user_id", auth.user.id).eq("review_status", "confirmed"),
  ]);
  if (documents.error || labResults.error) return NextResponse.json({ error: "No fue posible generar la exportación." }, { status: 500 });
  const ownerId = auth.user.id;
  const entries: { fullUrl: string; resource: Record<string, unknown> }[] = [];
  entries.push({ fullUrl: `urn:uuid:${ownerId}`, resource: {
    resourceType: "Patient", id: ownerId, active: true,
    identifier: auth.profile.identifier ? [{ system: "urn:phr:identifier:local", value: auth.profile.identifier }] : undefined,
    name: [{ text: auth.profile.full_name }], birthDate: auth.profile.birth_date,
  }});
  for (const document of documents.data ?? []) {
    const signed = await auth.db.storage.from("patient-documents").createSignedUrl(document.storage_path, 300);
    entries.push({ fullUrl: `urn:uuid:${document.id}`, resource: {
      resourceType: "DocumentReference", id: document.id, status: "current", subject: { reference: `Patient/${ownerId}` },
      date: document.created_at, description: `${document.source_institution} · ${document.document_type}`,
      author: [{ display: document.source_institution }],
      content: [{ attachment: { contentType: document.mime_type, url: signed.data?.signedUrl, size: document.size_bytes, title: document.original_filename, creation: document.document_date } }],
    }});
  }
  for (const result of labResults.data ?? []) {
    const referenceRange = result.ref_low !== null || result.ref_high !== null || result.ref_text
      ? [{ low: result.ref_low !== null ? { value: result.ref_low, unit: result.unit } : undefined, high: result.ref_high !== null ? { value: result.ref_high, unit: result.unit } : undefined, text: result.ref_text || undefined }]
      : undefined;
    entries.push({ fullUrl: `urn:uuid:${result.id}`, resource: {
      resourceType: "Observation", id: result.id, status: "final", subject: { reference: `Patient/${ownerId}` },
      code: { coding: result.loinc_code ? [{ system: "http://loinc.org", code: result.loinc_code, display: result.analyte }] : undefined, text: result.analyte },
      effectiveDateTime: `${result.observed_at}T00:00:00Z`,
      ...(result.value_num !== null ? { valueQuantity: { value: result.value_num, unit: result.unit } } : { valueString: result.value_text }),
      referenceRange, interpretation: result.flag ? [{ text: result.flag }] : undefined,
      derivedFrom: [{ reference: `DocumentReference/${result.document_id}` }],
    }});
  }
  const bundle = { resourceType: "Bundle", type: "collection", timestamp: new Date().toISOString(), total: entries.length, entry: entries };
  return new NextResponse(JSON.stringify(bundle, null, 2), { headers: { "Content-Type": "application/fhir+json", "Content-Disposition": "attachment; filename=mi-registro-fhir.json", "Cache-Control": "no-store" } });
}
