import type { Metadata } from "next";
import { PersonalHealthRecord } from "@/features/patient-portal/PersonalHealthRecord";

export const metadata: Metadata = { title: "Mi Salud · Registro Personal", description: "Tus documentos y resultados de salud, privados y bajo tu control." };

export default function PortalPage() {
  return <PersonalHealthRecord />;
}
