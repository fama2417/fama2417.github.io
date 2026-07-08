import { AppShell } from "@/components/AppShell";
import { RequireRole } from "@/components/RequireRole";
import { AgendaManager } from "@/features/appointments/AgendaManager";

export default function AgendaPage() {
  return <AppShell><RequireRole roles={["admin", "operator"]}><AgendaManager /></RequireRole></AppShell>;
}
