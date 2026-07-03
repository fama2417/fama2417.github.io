import { AppShell } from "@/components/AppShell";
import { ReportWindow } from "@/features/reports/ReportWindow";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppShell><ReportWindow appointmentId={id} /></AppShell>;
}
