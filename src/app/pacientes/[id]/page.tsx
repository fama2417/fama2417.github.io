import { AppShell } from "@/components/AppShell";
import { RequireRole } from "@/components/RequireRole";
import { PatientHistory } from "@/features/patients/PatientHistory";

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppShell><RequireRole roles={["admin", "operator", "radiologist", "clinician"]}><PatientHistory patientId={id} /></RequireRole></AppShell>;
}
