import test from "node:test";
import assert from "node:assert/strict";
import { validatePhrEmergency, validatePhrProfile } from "./profile.ts";

test("el onboarding PHR normaliza adultos y rechaza menores", () => {
  const today = new Date("2026-07-15T12:00:00Z");
  assert.deepEqual(validatePhrProfile({ fullName: "  Ana   Pérez ", birthDate: "2000-02-03", identifier: " 12.345.678-9 " }, today), {
    value: { fullName: "Ana Pérez", birthDate: "2000-02-03", identifier: "12.345.678-9" },
  });
  assert.match(validatePhrProfile({ fullName: "Ana", birthDate: "2010-01-01", identifier: "" }, today).error ?? "", /mayores de 18/);
});

test("valida el perfil de emergencia sin interpretar su contenido", () => {
  assert.deepEqual(validatePhrEmergency({ bloodType: "O+", allergies: " Penicilina ", conditions: "", medications: "", emergencyContactName: " Ana ", emergencyContactPhone: " +56912345678 ", emergencyNotes: "" }), {
    value: { bloodType: "O+", allergies: "Penicilina", conditions: "", medications: "", emergencyContactName: "Ana", emergencyContactPhone: "+56912345678", emergencyNotes: "" },
  });
  assert.match(validatePhrEmergency({ bloodType: "Z+", allergies: "", conditions: "", medications: "", emergencyContactName: "", emergencyContactPhone: "", emergencyNotes: "" }).error ?? "", /inválido/);
});
