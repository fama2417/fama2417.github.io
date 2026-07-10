import assert from "node:assert/strict";
import test from "node:test";
import { hasMinimumPatientSearch, patientSearchFilter } from "./search.ts";

test("búsqueda mínima staff: 3 caracteres reales, sin contar espacios de borde", () => {
  assert.equal(hasMinimumPatientSearch("ana"), true);
  assert.equal(hasMinimumPatientSearch("  ana  "), true);
  assert.equal(hasMinimumPatientSearch("an"), false);
  assert.equal(hasMinimumPatientSearch("a b"), true);
  assert.equal(hasMinimumPatientSearch("   "), false);
  assert.equal(hasMinimumPatientSearch(""), false);
});

test("RUN formateado busca también por identifier_key normalizado", () => {
  assert.equal(
    patientSearchFilter("11.111.111-1"),
    "full_name.ilike.%11.111.111-1%,identifier.ilike.%11.111.111-1%,identifier_key.ilike.%111111111%",
  );
});

test("RUN sin formato coincide con identifier_key", () => {
  const filter = patientSearchFilter("111111111");
  assert.ok(filter?.includes("identifier_key.ilike.%111111111%"));
});

test("búsqueda por nombre conserva full_name e identifier", () => {
  assert.equal(
    patientSearchFilter("María Pérez"),
    "full_name.ilike.%María Pérez%,identifier.ilike.%María Pérez%,identifier_key.ilike.%maraprez%",
  );
});

test("pasaporte alfanumérico se normaliza a minúsculas", () => {
  assert.ok(patientSearchFilter("AB-1234")?.includes("identifier_key.ilike.%ab1234%"));
});

test("caracteres reservados de PostgREST se eliminan", () => {
  assert.equal(patientSearchFilter("a,b(c)%d"), "full_name.ilike.%a b c  d%,identifier.ilike.%a b c  d%,identifier_key.ilike.%abcd%");
});

test("búsqueda vacía o solo símbolos no genera filtro", () => {
  assert.equal(patientSearchFilter(undefined), null);
  assert.equal(patientSearchFilter("   "), null);
  assert.equal(patientSearchFilter("%,()"), null);
});
