import assert from "node:assert/strict";
import test from "node:test";
import { labFlag, labTrendKey } from "./lab-observations.ts";

test("labFlag deriva low/high/normal dentro del rango", () => {
  assert.equal(labFlag(3, 4, 10), "low");
  assert.equal(labFlag(12, 4, 10), "high");
  assert.equal(labFlag(7, 4, 10), "normal");
  assert.equal(labFlag(4, 4, 10), "normal"); // límite inferior inclusivo
  assert.equal(labFlag(10, 4, 10), "normal"); // límite superior inclusivo
});

test("labFlag no evalúa sin valor numérico ni sin ningún límite", () => {
  assert.equal(labFlag(null, 4, 10), "");
  assert.equal(labFlag(NaN, 4, 10), "");
  assert.equal(labFlag(7, null, null), "");
});

test("labFlag funciona con un solo límite", () => {
  assert.equal(labFlag(2, 4, null), "low");
  assert.equal(labFlag(7, 4, null), "normal");
  assert.equal(labFlag(20, null, 10), "high");
});

test("labTrendKey prefiere LOINC y cae al analito normalizado", () => {
  assert.equal(labTrendKey({ loincCode: "718-7", analyte: "Hemoglobina" }), "718-7");
  assert.equal(labTrendKey({ loincCode: "", analyte: "  Hemoglobina " }), "hemoglobina");
});
