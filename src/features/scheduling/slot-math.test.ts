import assert from "node:assert/strict";
import test from "node:test";
import { addMinutes, commonStarts, runCovering, startsFittingDuration, type SlotLite } from "./slot-math.ts";

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

const D = "2026-07-08";
const grid: SlotLite[] = [
  { id: "a", startsAt: `${D}T08:00:00+00:00`, endsAt: `${D}T08:15:00+00:00` },
  { id: "b", startsAt: `${D}T08:15:00+00:00`, endsAt: `${D}T08:30:00+00:00` },
  { id: "c", startsAt: `${D}T08:30:00+00:00`, endsAt: `${D}T08:45:00+00:00` },
  { id: "d", startsAt: `${D}T08:45:00+00:00`, endsAt: `${D}T09:00:00+00:00` },
  { id: "e", startsAt: `${D}T09:15:00+00:00`, endsAt: `${D}T09:30:00+00:00` }, // hueco 09:00-09:15
];

test("runCovering: prestación de 60′ consume 4 cupos base de 15′", () => {
  assert.deepEqual(runCovering(grid, `${D}T08:00:00+00:00`, 60), ["a", "b", "c", "d"]);
});
test("runCovering: 30′ consume 2 cupos", () => {
  assert.deepEqual(runCovering(grid, `${D}T08:15:00+00:00`, 30), ["b", "c"]);
});
test("runCovering: un hueco corta la corrida → null", () => {
  assert.equal(runCovering(grid, `${D}T08:45:00+00:00`, 60), null); // 08:45→09:00 y luego hueco
});
test("startsFittingDuration: solo inicios con cupos contiguos suficientes", () => {
  const starts = startsFittingDuration(grid, 30).map((s) => s.startsAt.slice(11, 16));
  assert.deepEqual(starts, ["08:00", "08:15", "08:30"]); // 08:45 se queda sin par por el hueco
});
