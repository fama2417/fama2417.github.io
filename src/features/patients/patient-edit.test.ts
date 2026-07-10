import test from "node:test";
import assert from "node:assert/strict";
import { buildPatientPatch, editablePatientFields } from "./patient-edit.ts";

test("normaliza el patch: trim de strings y no-strings a vacío", () => {
  const result = buildPatientPatch({ phone: "  +56 9 1234  ", email: " a@b.cl ", address: undefined, comuna: null, prevision: "FONASA", allergies: "", morbidHistory: 42 });
  assert.ok("patch" in result);
  assert.equal(result.patch.phone, "+56 9 1234");
  assert.equal(result.patch.email, "a@b.cl");
  assert.equal(result.patch.address, "");
  assert.equal(result.patch.comuna, "");
  assert.equal(result.patch.morbidHistory, "");
});

test("excluye campos no permitidos aunque vengan en la entrada", () => {
  const result = buildPatientPatch({ phone: "1", identifier: "1-9", full_name: "Otro", birth_date: "2000-01-01", sex: "male", tenant_id: "x", privacy_consent_at: "hoy" });
  assert.ok("patch" in result);
  assert.deepEqual(Object.keys(result.patch).sort(), [...editablePatientFields].sort());
});

test("correo vacío es válido", () => {
  const result = buildPatientPatch({ email: "   " });
  assert.ok("patch" in result);
  assert.equal(result.patch.email, "");
});

test("correo inválido se rechaza", () => {
  const result = buildPatientPatch({ email: "sin-arroba" });
  assert.ok("error" in result);
});
