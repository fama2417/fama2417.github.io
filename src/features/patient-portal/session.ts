/**
 * Clasificación de la sesión sin rol nuevo: staff = tiene fila en profiles;
 * paciente = tiene perfil PHR o un vínculo institucional previo;
 * onboarding = cuenta autenticada que aún debe crear su registro personal.
 */
export type SessionKind = "staff" | "patient" | "onboarding" | "unknown";

export function resolveSessionKind({ hasProfile, hasPatient, hasPhrProfile = false, hasCaregiverAccess = false }: { hasProfile: boolean; hasPatient: boolean; hasPhrProfile?: boolean; hasCaregiverAccess?: boolean }): SessionKind {
  if (hasProfile) return "staff";
  if (hasPhrProfile || hasPatient || hasCaregiverAccess) return "patient";
  return "onboarding";
}
