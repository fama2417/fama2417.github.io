import { AppShell } from "@/components/AppShell";
import { RequireRole } from "@/components/RequireRole";
import { BookingCalendar } from "@/features/scheduling/BookingCalendar";

export default function AgendaPage() {
  return <AppShell><RequireRole roles={["admin", "operator"]}><BookingCalendar /></RequireRole></AppShell>;
}
