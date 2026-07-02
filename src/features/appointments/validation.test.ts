import assert from "node:assert/strict";
import test from "node:test";
import { initialAppointments } from "./mock-data.ts";
import { appointmentError } from "./validation.ts";

test("rechaza horas inválidas y choques de sala", () => {
  const base = initialAppointments[0];
  assert.match(appointmentError({ ...base, id: "new", startTime: "10:00", endTime: "09:00" }, []), /posterior/);
  assert.match(appointmentError({ ...base, id: "new", startTime: "09:15", endTime: "09:45" }, initialAppointments), /horario/);
  assert.equal(appointmentError({ ...base, id: "new", startTime: "09:30", endTime: "10:00" }, initialAppointments), "");
});
