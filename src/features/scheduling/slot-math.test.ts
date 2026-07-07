import assert from "node:assert/strict";
import test from "node:test";
import { addMinutes, commonStarts } from "./slot-math.ts";

test("addMinutes suma dentro del día", () => {
  assert.equal(addMinutes("08:00", 30), "08:30");
  assert.equal(addMinutes("08:45", 30), "09:15");
});

test("addMinutes envuelve a 24h", () => {
  assert.equal(addMinutes("23:45", 30), "00:15");
});

test("commonStarts: intersección de disponibilidad de un composite", () => {
  const result = commonStarts([
    ["08:00", "08:30", "09:00"], // endoscopista
    ["08:30", "09:00", "09:30"], // sala
    ["08:00", "08:30", "09:00"], // torre
  ]);
  assert.deepEqual([...result].sort(), ["08:30", "09:00"]);
});

test("commonStarts: sin miembros o sin solape → vacío", () => {
  assert.equal(commonStarts([]).size, 0);
  assert.equal(commonStarts([["08:00"], ["09:00"]]).size, 0);
});

test("commonStarts: un solo miembro devuelve sus propios inicios", () => {
  assert.deepEqual([...commonStarts([["08:00", "08:30"]])], ["08:00", "08:30"]);
});
