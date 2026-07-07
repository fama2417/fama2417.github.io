import { AppShell } from "@/components/AppShell";
import { RequireRole } from "@/components/RequireRole";
import { AgendaManager } from "@/features/appointments/AgendaManager";
import { BookingCalendar } from "@/features/scheduling/BookingCalendar";

export default function AgendaPage() {
  return <AppShell><RequireRole roles={["admin", "operator"]}><BookingCalendar /><AgendaManager /></RequireRole></AppShell>;
}
