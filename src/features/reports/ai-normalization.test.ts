import assert from "node:assert/strict";
import test from "node:test";
import { normalizeClinicalText } from "./ai-normalization.ts";

test("normaliza texto clinico para busqueda", () => {
  assert.equal(normalizeClinicalText("Dilatacion de Via Biliar"), "dilatacion de via biliar");
  assert.equal(normalizeClinicalText("Dilatación de Vía Biliar"), "dilatacion de via biliar");
});
