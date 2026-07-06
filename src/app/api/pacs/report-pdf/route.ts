import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const orthancUrl = (process.env.ORTHANC_URL ?? "").replace(/\/$/, "");
const orthancCreds = process.env.ORTHANC_CREDS ?? "";

const renderHeader = (template: string, values: Record<string, string>) =>
  template.replace(/{{\s*(\w+)\s*}}/g, (_, key: string) => values[key] ?? "");

/** Genera el PDF del informe definitivo y lo adjunta al estudio en Orthanc como serie DICOM (PDF encapsulado). */
export async function POST(request: NextRequest) {
  if (!orthancUrl || !orthancCreds) return NextResponse.json({ error: "PACS sin configurar en el servidor." }, { status: 501 });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  // Cliente con la sesión del usuario: RLS decide qué puede leer (mismo tenant).
  const db = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth } = await db.auth.getUser(token);
  if (!auth.user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const { appointmentId } = (await request.json().catch(() => ({}))) ?? {};
  if (!appointmentId) return NextResponse.json({ error: "Falta appointmentId." }, { status: 400 });

  const [report, appointment, tenant, keyImagesResult] = await Promise.all([
    db.from("radiology_reports").select("clinical_indication, technique, comparison, findings, impression, status, critical_finding, critical_finding_type, signed_at, signer_name, signer_registration").eq("appointment_id", appointmentId).maybeSingle(),
    db.from("appointments").select("appointment_date, modality, reason, treating_physician, requester_name, patient:patients(full_name, identifier), study:imaging_studies(orthanc_study_id)").eq("id", appointmentId).maybeSingle(),
    db.from("tenants").select("name, rut, address, phone, report_header").maybeSingle(),
    db.from("report_key_images").select("instance_id, caption").eq("appointment_id", appointmentId).order("created_at"),
  ]);
  const keyImages = (keyImagesResult.data ?? []) as { instance_id: string; caption: string }[];
  const reportRow = report.data;
  const appointmentRow = appointment.data as unknown as { appointment_date: string; modality: string; reason: string; treating_physician: string; requester_name: string; patient: { full_name: string; identifier: string } | null; study: { orthanc_study_id: string | null } | null } | null;
  if (!reportRow || reportRow.status !== "final" || !appointmentRow) return NextResponse.json({ error: "No hay informe definitivo para archivar." }, { status: 409 });
  const orthancStudyId = appointmentRow.study?.orthanc_study_id;
  if (!orthancStudyId) return NextResponse.json({ error: "El estudio no tiene imágenes vinculadas en el PACS; el PDF no se archivó." }, { status: 409 });

  // --- PDF ---
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595, 842]); // A4
  let y = 800;
  const margin = 50;
  const width = 595 - margin * 2;
  const writeLine = (text: string, options?: { bold?: boolean; size?: number }) => {
    const size = options?.size ?? 10;
    const face = options?.bold ? bold : font;
    // ponytail: corte de línea por ancho aproximado; suficiente para texto clínico
    const words = text.split(" ");
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

  const tenantRow = tenant.data as { name?: string; rut?: string; address?: string; phone?: string; report_header?: string } | null;
  const patientName = appointmentRow.patient?.full_name ?? "Paciente";
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
  if (reportRow.critical_finding) writeLine(`⚠ HALLAZGO CRÍTICO${reportRow.critical_finding_type ? `: ${reportRow.critical_finding_type}` : ""}`, { bold: true });
  writeBlock("Indicación clínica", reportRow.clinical_indication);
  writeBlock("Técnica", reportRow.technique);
  writeBlock("Comparación", reportRow.comparison);
  writeBlock("Hallazgos", reportRow.findings);
  writeBlock("Impresión", reportRow.impression);

  if (keyImages.length) {
    y -= 6;
    writeLine("IMÁGENES CLAVE", { bold: true, size: 10 });
    const basicAuth = `Basic ${Buffer.from(orthancCreds).toString("base64")}`;
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
        if (caption) page.drawText(caption.slice(0, 70), { x, y: y - size.height - 10, size: 8, font, color: rgb(0.2, 0.2, 0.2) });
      });
      y -= rowHeight + 24;
    }
  }
  y -= 10;
  writeLine([reportRow.signer_name, reportRow.signer_registration].filter(Boolean).join(" · "), { bold: true });
  writeLine(`Firmado electrónicamente · ${reportRow.signed_at ? new Date(reportRow.signed_at).toLocaleString("es-CL", { timeZone: "America/Santiago" }) : ""}`, { size: 8 });

  const pdfBase64 = Buffer.from(await pdf.save()).toString("base64");

  const upstream = await fetch(`${orthancUrl}/tools/create-dicom`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(orthancCreds).toString("base64")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      Parent: orthancStudyId,
      Tags: { Modality: "DOC", SeriesDescription: "Informe radiológico (PDF)" },
      Content: `data:application/pdf;base64,${pdfBase64}`,
    }),
  });
  if (!upstream.ok) return NextResponse.json({ error: `El PACS rechazó el PDF (${upstream.status}).` }, { status: 502 });
  return NextResponse.json({ ok: true });
}
