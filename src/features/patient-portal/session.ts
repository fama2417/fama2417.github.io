/**
 * Clasificación de la sesión sin rol nuevo: staff = tiene fila en profiles;
 * paciente = sin profile pero vinculado en patients.user_id (visible solo por RLS);
 * unknown = autenticado sin habilitación (se le niega acceso).
 */
export type SessionKind = "staff" | "patient" | "unknown";

export function resolveSessionKind({ hasProfile, hasPatient }: { hasProfile: boolean; hasPatient: boolean }): SessionKind {
  if (hasProfile) return "staff";
  if (hasPatient) return "patient";
  return "unknown";
}
