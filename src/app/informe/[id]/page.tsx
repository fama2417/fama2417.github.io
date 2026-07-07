import { AppShell } from "@/components/AppShell";
import { RequireRole } from "@/components/RequireRole";
import { ReportWindow } from "@/features/reports/ReportWindow";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppShell><RequireRole roles={["admin", "radiologist"]}><ReportWindow appointmentId={id} /></RequireRole></AppShell>;
}
