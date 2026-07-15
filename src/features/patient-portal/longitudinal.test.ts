import assert from "node:assert/strict";
import test from "node:test";
import { comparePhrPeriods, measurementExplanation, phrTrendsCsv, reportedRangeLabel } from "./longitudinal.ts";
import type { PhrLabResult } from "./labs.ts";

const row = (id: string, date: string, value: number, unit = "mg/dL", flag: PhrLabResult["flag"] = "normal"): PhrLabResult => ({
  id, documentId: "doc", loincCode: "", analyte: "Glucosa", valueNum: value, valueText: "", unit,
  refLow: 70, refHigh: 99, refText: "", flag, observedAt: date, source: "ocr", reviewStatus: "confirmed",
});

test("compara el último valor de dos períodos usando unidades compatibles", () => {
  const compared = comparePhrPeriods([row("a", "2026-01-10", 90), row("b", "2026-06-10", 1.1, "g/L", "high")],
    { from: "2026-01-01", to: "2026-01-31" }, { from: "2026-06-01", to: "2026-06-30" });
  assert.equal(compared.length, 1);
  assert.equal(compared[0].first, 0.9);
  assert.equal(compared[0].second, 1.1);
  assert.ok(Math.abs(compared[0].change! - 0.2) < 1e-9);
});

test("usa lenguaje descriptivo y no entrega diagnósticos", () => {
  assert.equal(reportedRangeLabel(row("a", "2026-01-01", 110, "mg/dL", "high")), "Fuera del rango informado por el laboratorio");
  assert.match(measurementExplanation(row("a", "2026-01-01", 90)), /Mide/);
  const csv = phrTrendsCsv([row("a", "2026-01-01", 110, "mg/dL", "high")]);
  assert.match(csv, /Fuera del rango informado por el laboratorio/);
  assert.doesNotMatch(csv, /enferm|diagnóst|tienes/i);
});
