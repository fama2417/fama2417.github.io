import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveSessionKind } from "./session.ts";

test("con profile staff se mantiene el flujo staff, aunque exista vínculo", () => {
  assert.equal(resolveSessionKind({ hasProfile: true, hasPatient: false }), "staff");
  assert.equal(resolveSessionKind({ hasProfile: true, hasPatient: true, hasPhrProfile: true }), "staff");
});

test("sin profile pero vinculado a patients.user_id es paciente (portal)", () => {
  assert.equal(resolveSessionKind({ hasProfile: false, hasPatient: true }), "patient");
});

test("el perfil PHR habilita el portal sin tenant y una cuenta nueva entra a onboarding", () => {
  assert.equal(resolveSessionKind({ hasProfile: false, hasPatient: false, hasPhrProfile: true }), "patient");
  assert.equal(resolveSessionKind({ hasProfile: false, hasPatient: false, hasPhrProfile: false }), "onboarding");
});

test("un cuidador activo entra al portal aunque no tenga PHR propio", () => {
  assert.equal(resolveSessionKind({ hasProfile: false, hasPatient: false, hasCaregiverAccess: true }), "patient");
});

// El selector ownerUserId solo acota perfiles ya visibles por RLS; nunca acepta patientId institucional.
test("las lecturas longitudinales no aceptan patientId institucional", () => {
  const source = readFileSync(new URL("./repository.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const exported = [...source.matchAll(/export async function (fetch\w+)\(([^)]*)\)/g)];
  assert.ok(exported.length >= 4, "se esperan al menos 4 funciones exportadas");
  for (const [, name, params] of exported) assert.ok(!/patientId/i.test(params), `${name} no debe aceptar patientId`);
});

// El portal no debe renderizar navegación staff ni enlazar rutas internas.
test("el portal no renderiza navegación staff", () => {
  const source = readFileSync(new URL("./PersonalHealthRecord.tsx", import.meta.url), "utf8");
  for (const forbidden of ["AppShell", "app-shell", "/worklist", "/agenda", "/pacientes", "/informe/"]) {
    assert.ok(!source.includes(forbidden), `el portal no debe contener "${forbidden}"`);
  }
});
