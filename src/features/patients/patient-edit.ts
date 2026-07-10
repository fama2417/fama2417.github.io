/** Campos administrativos/clínicos básicos editables por admin en Fase 2D. Allowlist explícita: todo lo demás se descarta. */
export const editablePatientFields = ["phone", "email", "address", "comuna", "prevision", "allergies", "morbidHistory"] as const;

export type PatientEditPatch = Record<(typeof editablePatientFields)[number], string>;

/** Normaliza la entrada del formulario: solo campos permitidos, strings con trim; correo validado solo si tiene contenido. */
export function buildPatientPatch(input: Record<string, unknown>): { patch: PatientEditPatch } | { error: string } {
  const patch = {} as PatientEditPatch;
  for (const field of editablePatientFields) {
    const value = input[field];
    patch[field] = typeof value === "string" ? value.trim() : "";
  }
  if (patch.email && !patch.email.includes("@")) return { error: "Correo inválido." };
  return { patch };
}
