export type PhrProfileInput = { fullName: string; birthDate: string; identifier: string };
export type PhrEmergencyInput = {
  bloodType: string; allergies: string; conditions: string; medications: string;
  emergencyContactName: string; emergencyContactPhone: string; emergencyNotes: string;
};

export function validatePhrProfile(input: PhrProfileInput, today = new Date()) {
  const fullName = input.fullName.trim().replace(/\s+/g, " ");
  const identifier = input.identifier.trim();
  if (fullName.length < 2 || fullName.length > 120) return { error: "Ingresa un nombre válido." } as const;
  if (identifier.length > 32) return { error: "El identificador es demasiado largo." } as const;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.birthDate)) return { error: "Ingresa una fecha de nacimiento válida." } as const;
  const birth = new Date(`${input.birthDate}T00:00:00Z`);
  if (!Number.isFinite(birth.getTime()) || birth.toISOString().slice(0, 10) !== input.birthDate || input.birthDate < "1900-01-01") {
    return { error: "Ingresa una fecha de nacimiento válida." } as const;
  }
  const adultBefore = new Date(Date.UTC(today.getUTCFullYear() - 18, today.getUTCMonth(), today.getUTCDate()));
  if (birth > adultBefore) return { error: "Por ahora, Mi Salud está disponible para mayores de 18 años." } as const;
  return { value: { fullName, birthDate: input.birthDate, identifier } } as const;
}

export function validatePhrEmergency(input: PhrEmergencyInput) {
  const bloodTypes = ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
  if (!bloodTypes.includes(input.bloodType)) return { error: "Grupo sanguíneo inválido." } as const;
  const value = {
    bloodType: input.bloodType,
    allergies: input.allergies.trim(), conditions: input.conditions.trim(), medications: input.medications.trim(),
    emergencyContactName: input.emergencyContactName.trim(), emergencyContactPhone: input.emergencyContactPhone.trim(), emergencyNotes: input.emergencyNotes.trim(),
  };
  if ([value.allergies, value.conditions, value.medications, value.emergencyNotes].some((text) => text.length > 1000)
    || value.emergencyContactName.length > 120 || value.emergencyContactPhone.length > 40) {
    return { error: "Uno de los campos de emergencia es demasiado extenso." } as const;
  }
  return { value } as const;
}
