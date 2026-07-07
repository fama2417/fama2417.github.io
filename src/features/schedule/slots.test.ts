import assert from "node:assert/strict";
import test from "node:test";
import { availableSlots } from "./slots.ts";
import type { RoomSchedule } from "./repository.ts";

const room: RoomSchedule = { id: "s1", roomLabel: "Box 1", days: "1,2,3,4,5", openTime: "09:00", closeTime: "11:00" };
// 2026-07-06 es lunes (weekday 1).
const date = "2026-07-06";

test("arma bloques según duración y respeta la ventana de la sala", () => {
  const slots = availableSlots(date, "Box 1", 30, [room], []);
  assert.deepEqual(slots.map((s) => s.start), ["09:00", "09:30", "10:00", "10:30"]);
  assert.equal(slots.at(-1)?.end, "11:00");
});

test("descarta bloques que chocan con citas tomadas (no canceladas)", () => {
  const taken = [{ id: "a", date, locationName: "Box 1", startTime: "09:30", endTime: "10:00", status: "confirmed" }];
  const starts = availableSlots(date, "Box 1", 30, [room], taken).map((s) => s.start);
  assert.deepEqual(starts, ["09:00", "10:00", "10:30"]);
});

test("excludeId deja libre el propio bloque al editar", () => {
  const taken = [{ id: "self", date, locationName: "Box 1", startTime: "09:30", endTime: "10:00", status: "confirmed" }];
  const starts = availableSlots(date, "Box 1", 30, [room], taken, { excludeId: "self" }).map((s) => s.start);
  assert.ok(starts.includes("09:30"));
});

test("sala sin horario cae a 08:00–18:00; sin sala/duración no hay bloques", () => {
  assert.equal(availableSlots(date, "Box X", 60, [], []).length, 10);
  assert.deepEqual(availableSlots(date, "", 30, [room], []), []);
  assert.deepEqual(availableSlots(date, "Box 1", 0, [room], []), []);
});

test("día fuera de la regla semanal no ofrece bloques", () => {
  assert.deepEqual(availableSlots("2026-07-05", "Box 1", 30, [room], []), []); // domingo
});
