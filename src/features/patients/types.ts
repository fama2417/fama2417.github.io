export type Patient = {
  id: string;
  identifier: string;
  identifierType: "run" | "passport" | "other";
  name: string;
  birthDate: string;
  sex: "female" | "male" | "other" | "unknown";
  phone: string;
  consentAt?: string;
  address: string;
  comuna: string;
  email: string;
  allergies: string;
  morbidHistory: string;
  prevision: string;
};

export const identifierTypeLabels: Record<Patient["identifierType"], string> = { run: "RUN", passport: "Pasaporte", other: "Otro" };

export const sexLabels: Record<Patient["sex"], string> = { female: "Femenino", male: "Masculino", other: "Otro", unknown: "No informado" };

export const emptyPatientRecord = { address: "", comuna: "", email: "", allergies: "", morbidHistory: "", prevision: "" };
