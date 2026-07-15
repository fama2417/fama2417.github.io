import { NextRequest, NextResponse } from "next/server";
import { phrTrendsCsv, reportedRangeLabel } from "@/features/patient-portal/longitudinal";
import type { PhrLabResult } from "@/features/patient-portal/labs";
import { simplePhrPdf } from "@/features/patient-portal/pdf";
import { requirePhrApi } from "@/lib/server-auth";

export async function GET(request: NextRequest) {
  const auth = await requirePhrApi(request); if (auth instanceof NextResponse) return auth;
  const query = await auth.db.from("phr_lab_results").select("id, document_id, loinc_code, analyte, value_num, value_text, unit, ref_low, ref_high, ref_text, flag, observed_at, source, review_status")
    .eq("owner_user_id", auth.user.id).eq("review_status", "confirmed").order("observed_at");
  if (query.error) return NextResponse.json({ error: "No fue posible preparar las tendencias." }, { status: 500 });
  const results = (query.data ?? []).map((row) => ({
    id: row.id, documentId: row.document_id, loincCode: row.loinc_code, analyte: row.analyte,
    valueNum: row.value_num, valueText: row.value_text, unit: row.unit, refLow: row.ref_low,
    refHigh: row.ref_high, refText: row.ref_text, flag: row.flag, observedAt: row.observed_at,
    source: row.source, reviewStatus: row.review_status,
  })) as PhrLabResult[];
  if (request.nextUrl.searchParams.get("format") === "csv") {
    return new NextResponse(phrTrendsCsv(results), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=tendencias-laboratorio.csv", "Cache-Control": "no-store" } });
  }
  const lines = results.length ? results.map((result) => `${result.observedAt} | ${result.analyte}: ${result.valueNum ?? result.valueText} ${result.unit} | ${reportedRangeLabel(result)}`) : ["No hay resultados confirmados."];
  const pdf = await simplePhrPdf("Tendencias de laboratorio", ["Resultados confirmados por la persona. Este documento no entrega diagnósticos.", "", ...lines]);
  return new NextResponse(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=tendencias-laboratorio.pdf", "Cache-Control": "no-store" } });
}
