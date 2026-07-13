import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { pdfSafeText } from "@/lib/safe-text";
import { effectiveTenantId } from "@/lib/tenant";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const orthancUrl = (process.env.ORTHANC_URL ?? "").replace(/\/$/, "");
const orthancCreds = process.env.ORTHANC_CREDS ?? "";

const renderHeader = (template: string, values: Record<string, string>) =>
  template.replace(/{{\s*(\w+)\s*}}/g, (_, key: string) => values[key] ?? "");

const channelLabels: Record<string, string> = { phone: "Teléfono", in_person: "Presencial", secure_message: "Mensajería segura", email: "Correo", other: "Otro" };
const followUpLabels: Record<string, string> = { pending: "Pendiente", acknowledged: "Recibido", completed: "Realizado" };
const REPORT_PDF_DESC = "Informe radiológico (PDF)";
const trustedAssetUrl = (value: string) => {
  try { return new URL(value).origin === new URL(supabaseUrl).origin; } catch { return false; }
};

const orthancFetch = (path: string, init?: RequestInit) =>
  fetch(`${orthancUrl}${path}`, { ...init, headers: { Authorization: `Basic ${Buffer.from(orthancCreds).toString("base64")}`, ...(init?.headers ?? {}) } });

type LinkedStudy = { orthanc_study_id: string | null; study_instance_uid: string | null };
async function resolveOrthancStudyId(study?: LinkedStudy | null) {
  if (study?.orthanc_study_id) return study.orthanc_study_id;
  if (!study?.study_instance_uid) return "";
  const found = await orthancFetch("/tools/find", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Level: "Study", Query: { StudyInstanceUID: study.study_instance_uid }, Limit: 1 }) });
  if (!found.ok) throw new Error(`PACS no disponible (${found.status}).`);
  return ((await found.json()) as string[])[0] ?? "";
}

/** Borra del estudio Orthanc las series PDF del informe (evita duplicados al re-archivar y al eliminar el informe). */
async function deleteReportPdfSeries(orthancStudyId: string) {
  const study = await orthancFetch(`/studies/${encodeURIComponent(orthancStudyId)}`);
  if (!study.ok) throw new Error(`PACS no disponible (${study.status}).`);
  const series = ((await study.json()) as { Series?: string[] }).Series ?? [];
  await Promise.all(series.map(async (seriesId) => {
    const detail = await orthancFetch(`/series/${seriesId}`);
    if (!detail.ok) throw new Error(`No fue posible revisar una serie PACS (${detail.status}).`);
    const desc = ((await detail.json()) as { MainDicomTags?: { SeriesDescription?: string } }).MainDicomTags?.SeriesDescription;
    if (desc === REPORT_PDF_DESC) {
      const deletion = await orthancFetch(`/series/${seriesId}`, { method: "DELETE" });
      if (!deletion.ok) throw new Error(`No fue posible reemplazar el PDF PACS (${deletion.status}).`);
    }
  }));
}

/** Valida la sesión y devuelve el orthanc_study_id del estudio de la cita (RLS del usuario). */
async function studyOf(request: NextRequest, appointmentId: string) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const db = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth } = await db.auth.getUser(token);
  if (!auth.user) return { error: NextResponse.json({ error: "No autenticado." }, { status: 401 }) };
  const { data: profile } = await db.from("profiles").select("role").eq("id", auth.user.id).single();
  if (profile?.role !== "admin") return { error: NextResponse.json({ error: "Solo administradores pueden eliminar el PDF del PACS." }, { status: 403 }) };
  const { data } = await db.from("appointments").select("study:imaging_studies(orthanc_study_id, study_instance_uid)").eq("id", appointmentId).maybeSingle();
  const orthancStudyId = await resolveOrthancStudyId((data as unknown as { study: LinkedStudy | null } | null)?.study);
  return { orthancStudyId };
}

/** Elimina del PACS el PDF del informe (al eliminar el informe desde el módulo). */
export async function DELETE(request: NextRequest) {
  if (!orthancUrl || !orthancCreds) return NextResponse.json({ error: "PACS sin configurar en el servidor." }, { status: 501 });
  const appointmentId = request.nextUrl.searchParams.get("appointmentId") ?? "";
  if (!appointmentId) return NextResponse.json({ error: "Falta appointmentId." }, { status: 400 });
  try {
    const ctx = await studyOf(request, appointmentId);
    if ("error" in ctx) return ctx.error;
    if (ctx.orthancStudyId) await deleteReportPdfSeries(ctx.orthancStudyId);
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "No fue posible eliminar el PDF del PACS." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}

/** Genera el PDF del informe definitivo y lo adjunta al estudio en Orthanc como serie DICOM (PDF encapsulado). */
export async function POST(request: NextRequest) {
  if (!orthancUrl || !orthancCreds) return NextResponse.json({ error: "PACS sin configurar en el servidor." }, { status: 501 });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  // Cliente con la sesión del usuario: RLS decide qué puede leer (mismo tenant).
  const db = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth } = await db.auth.getUser(token);
  if (!auth.user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  const { data: profile } = await db.from("profiles").select("role, tenant_id, active_tenant_id, platform").eq("id", auth.user.id).single();
  if (!profile || !["admin", "radiologist"].includes(profile.role)) return NextResponse.json({ error: "Solo administración o radiología pueden archivar informes." }, { status: 403 });
  const tenantId = effectiveTenantId(profile);

  const { appointmentId } = (await request.json().catch(() => ({}))) ?? {};
  if (!appointmentId) return NextResponse.json({ error: "Falta appointmentId." }, { status: 400 });

  const report = await db.from("radiology_reports").select("id, clinical_indication, technique, comparison, findings, impression, status, critical_finding, critical_finding_type, signed_at, signed_by, signer_name, signer_registration").eq("appointment_id", appointmentId).maybeSingle();
  if (report.error) return NextResponse.json({ error: report.error.message }, { status: 500 });
  const reportRow = report.data;
  if (!reportRow || reportRow.status !== "final") return NextResponse.json({ error: "No hay informe definitivo para archivar." }, { status: 409 });

  const [appointment, tenant, keyImagesResult, followUpsResult, communicationsResult] = await Promise.all([
    db.from("appointments").select("appointment_date, modality, reason, treating_physician, requester_name, patient:patients(full_name, identifier), study:imaging_studies(orthanc_study_id, study_instance_uid)").eq("id", appointmentId).maybeSingle(),
    db.from("tenants").select("name, rut, address, phone, report_header, logo_url").eq("id", tenantId).maybeSingle(),
    db.from("report_key_images").select("instance_id, caption").eq("appointment_id", appointmentId).order("created_at"),
    db.from("report_follow_ups").select("recommendation, due_date, status").eq("appointment_id", appointmentId).order("due_date"),
    db.from("report_communications").select("recipient, channel, communicated_at, acknowledged, urgency").eq("report_id", reportRow.id).order("communicated_at"),
  ]);
  const queryError = [appointment.error, tenant.error, keyImagesResult.error, followUpsResult.error, communicationsResult.error].find(Boolean);
  if (queryError) return NextResponse.json({ error: queryError.message }, { status: 500 });
  const keyImages = (keyImagesResult.data ?? []) as { instance_id: string; caption: string }[];
  const followUps = (followUpsResult.data ?? []) as { recommendation: string; due_date: string; status: string }[];
  const acknowledged = ((communicationsResult.data ?? []) as { recipient: string; channel: string; communicated_at: string; acknowledged: boolean; urgency: string }[]).filter((c) => c.urgency === "critical" && c.acknowledged).at(-1);
  const appointmentRow = appointment.data as unknown as { appointment_date: string; modality: string; reason: string; treating_physician: string; requester_name: string; patient: { full_name: string; identifier: string } | null; study: LinkedStudy | null } | null;
  if (!appointmentRow) return NextResponse.json({ error: "No hay informe definitivo para archivar." }, { status: 409 });
  let orthancStudyId = "";
  try { orthancStudyId = await resolveOrthancStudyId(appointmentRow.study); }
  catch (cause) { return NextResponse.json({ error: cause instanceof Error ? cause.message : "PACS no disponible." }, { status: 502 }); }
  if (!orthancStudyId) return NextResponse.json({ error: "El estudio no tiene imágenes vinculadas en el PACS; el PDF no se archivó." }, { status: 409 });

  // --- PDF ---
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const embedImage = async (bytes: ArrayBuffer) => { try { return await pdf.embedPng(bytes); } catch { try { return await pdf.embedJpg(bytes); } catch { return null; } } };
  const basicAuth = `Basic ${Buffer.from(orthancCreds).toString("base64")}`;
  let page = pdf.addPage([595, 842]); // A4
  let y = 800;
  const margin = 50;
  const width = 595 - margin * 2;
  const writeLine = (text: string, options?: { bold?: boolean; size?: number }) => {
    const size = options?.size ?? 10;
    const face = options?.bold ? bold : font;
    const safeText = pdfSafeText(face, text);
    // ponytail: corte de línea por ancho aproximado; suficiente para texto clínico
    const words = safeText.split(" ");
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (face.widthOfTextAtSize(candidate, size) > width && line) {
        if (y < 60) { page = pdf.addPage([595, 842]); y = 800; }
        page.drawText(line, { x: margin, y, size, font: face, color: rgb(0.1, 0.1, 0.1) });
        y -= size + 4;
        line = word;
      } else line = candidate;
    }
    if (y < 60) { page = pdf.addPage([595, 842]); y = 800; }
    page.drawText(line, { x: margin, y, size, font: face, color: rgb(0.1, 0.1, 0.1) });
    y -= size + 6;
  };
  const writeBlock = (title: string, body: string) => {
    if (!body?.trim()) return;
    y -= 6;
    writeLine(title.toUpperCase(), { bold: true, size: 10 });
    body.split("\n").filter(Boolean).forEach((line) => writeLine(line));
  };

  const tenantRow = tenant.data as { name?: string; rut?: string; address?: string; phone?: string; report_header?: string; logo_url?: string } | null;
  const patientName = appointmentRow.patient?.full_name ?? "Paciente";
  if (tenantRow?.logo_url && trustedAssetUrl(tenantRow.logo_url)) {
    try {
      const logo = await embedImage(await (await fetch(tenantRow.logo_url)).arrayBuffer());
      if (logo) { const scale = Math.min(120 / logo.width, 48 / logo.height); page.drawImage(logo, { x: 595 - margin - logo.width * scale, y: y - logo.height * scale + 8, width: logo.width * scale, height: logo.height * scale }); }
    } catch { /* logo opcional */ }
  }
  writeLine(tenantRow?.name ?? "Informe radiológico", { bold: true, size: 14 });
  writeLine([tenantRow?.rut && `RUT ${tenantRow.rut}`, tenantRow?.address, tenantRow?.phone].filter(Boolean).join(" · "), { size: 8 });
  y -= 8;
  writeLine("INFORME RADIOLÓGICO", { bold: true, size: 12 });
  if (tenantRow?.report_header) {
    renderHeader(tenantRow.report_header, {
      paciente: patientName, id: appointmentRow.patient?.identifier ?? "—",
      medico: appointmentRow.treating_physician || appointmentRow.requester_name || "—",
      examen: `${appointmentRow.modality} · ${appointmentRow.reason}`, fecha: appointmentRow.appointment_date, institucion: tenantRow?.name ?? "",
    }).split("\n").filter(Boolean).forEach((line) => writeLine(line));
  } else {
    writeLine(`Paciente: ${patientName} · ID: ${appointmentRow.patient?.identifier ?? "—"}`);
    writeLine(`Examen: ${appointmentRow.modality} · ${appointmentRow.reason} · Fecha: ${appointmentRow.appointment_date}`);
  }
  if (reportRow.critical_finding) writeLine(`⚠ HALLAZGO CRÍTICO${reportRow.critical_finding_type ? `: ${reportRow.critical_finding_type}` : ""}${acknowledged ? ` · Comunicado a ${acknowledged.recipient} por ${channelLabels[acknowledged.channel] ?? acknowledged.channel}, ${new Date(acknowledged.communicated_at).toLocaleString("es-CL", { timeZone: "America/Santiago" })}.` : ""}`, { bold: true });
  writeBlock("Indicación clínica", reportRow.clinical_indication);
  writeBlock("Técnica", reportRow.technique);
  writeBlock("Comparación", reportRow.comparison);
  writeBlock("Hallazgos", reportRow.findings);
  writeBlock("Impresión", reportRow.impression);

  if (keyImages.length) {
    y -= 6;
    writeLine("IMÁGENES CLAVE", { bold: true, size: 10 });
    const cellWidth = (width - 10) / 2;
    for (let index = 0; index < keyImages.length; index += 2) {
      const pair = keyImages.slice(index, index + 2);
      const embedded = await Promise.all(pair.map(async (item) => {
        try {
          let bytes: ArrayBuffer;
          if (item.instance_id.includes("/")) {
            // Captura del visor guardada en el bucket "capturas"
            const file = await db.storage.from("capturas").download(item.instance_id);
            if (!file.data) return null;
            bytes = await file.data.arrayBuffer();
          } else {
            const preview = await fetch(`${orthancUrl}/instances/${item.instance_id}/preview`, { headers: { Authorization: basicAuth, Accept: "image/png" } });
            if (!preview.ok) return null;
            bytes = await preview.arrayBuffer();
          }
          try { return await pdf.embedPng(bytes); } catch { return await pdf.embedJpg(bytes); }
        } catch { return null; }
      }));
      const sizes = embedded.map((image) => {
        if (!image) return { width: 0, height: 0 };
        const scale = Math.min(cellWidth / image.width, 220 / image.height);
        return { width: image.width * scale, height: image.height * scale };
      });
      const rowHeight = Math.max(...sizes.map((size) => size.height), 0);
      if (!rowHeight) continue;
      if (y - rowHeight - 24 < 60) { page = pdf.addPage([595, 842]); y = 800; }
      embedded.forEach((image, position) => {
        if (!image) return;
        const size = sizes[position];
        const x = margin + position * (cellWidth + 10);
        page.drawImage(image, { x, y: y - size.height, width: size.width, height: size.height });
        const caption = pair[position].caption;
        if (caption) page.drawText(pdfSafeText(font, caption.slice(0, 70)), { x, y: y - size.height - 10, size: 8, font, color: rgb(0.2, 0.2, 0.2) });
      });
      y -= rowHeight + 24;
    }
  }
  if (followUps.length) {
    y -= 6;
    writeLine("RECOMENDACIONES Y SEGUIMIENTO", { bold: true, size: 10 });
    followUps.forEach((item) => writeLine(`${item.recommendation} · Plazo ${new Date(`${item.due_date}T00:00:00`).toLocaleDateString("es-CL")} · ${followUpLabels[item.status] ?? item.status}`));
  }

  y -= 16;
  // Firma escaneada del firmante (bucket privado "firmas"), igual que en el informe impreso.
  if (reportRow.signed_by) {
    try {
      const { data: signer } = await db.from("profiles").select("signature_url").eq("id", reportRow.signed_by).maybeSingle();
      const path = (signer as { signature_url?: string } | null)?.signature_url;
      if (path) {
        const file = await db.storage.from("firmas").download(path);
        const image = file.data ? await embedImage(await file.data.arrayBuffer()) : null;
        if (image) { const scale = Math.min(160 / image.width, 50 / image.height); if (y - image.height * scale < 60) { page = pdf.addPage([595, 842]); y = 800; } page.drawImage(image, { x: margin, y: y - image.height * scale, width: image.width * scale, height: image.height * scale }); y -= image.height * scale + 4; }
      }
    } catch { /* firma opcional */ }
  }
  writeLine([reportRow.signer_name, reportRow.signer_registration].filter(Boolean).join(" · "), { bold: true });
  writeLine(`Firmado electrónicamente · ${reportRow.signed_at ? new Date(reportRow.signed_at).toLocaleString("es-CL", { timeZone: "America/Santiago" }) : ""}`, { size: 8 });

  const pdfBase64 = Buffer.from(await pdf.save()).toString("base64");

  try {
    await deleteReportPdfSeries(orthancStudyId); // reemplaza el PDF anterior en vez de acumular series
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "No fue posible reemplazar el PDF del PACS." }, { status: 502 });
  }
  const upstream = await orthancFetch("/tools/create-dicom", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      Parent: orthancStudyId,
      Tags: { Modality: "DOC", SeriesDescription: REPORT_PDF_DESC },
      Content: `data:application/pdf;base64,${pdfBase64}`,
    }),
  });
  if (!upstream.ok) return NextResponse.json({ error: `El PACS rechazó el PDF (${upstream.status}).` }, { status: 502 });
  return NextResponse.json({ ok: true });
}
