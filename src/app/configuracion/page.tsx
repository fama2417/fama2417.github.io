import { AppShell } from "@/components/AppShell";
import { RequireRole } from "@/components/RequireRole";
import { CatalogManager } from "@/features/catalog/CatalogManager";
import { TemplatesManager } from "@/features/reports/TemplatesManager";
import { ScheduleManager } from "@/features/schedule/ScheduleManager";
import { ParametryManager } from "@/features/scheduling/ParametryManager";
import { ResourceWizard } from "@/features/scheduling/ResourceWizard";
import { InstitutionSettings } from "@/features/tenant/InstitutionSettings";
import { TenantsManager } from "@/features/tenant/TenantsManager";
import { UsersManager } from "@/features/users/UsersManager";
import { getSupabaseEnvironment } from "@/lib/supabase";

export default function SettingsPage() {
  const supabase = getSupabaseEnvironment();
  const orthancUrl = (process.env.NEXT_PUBLIC_ORTHANC_URL ?? "http://localhost:8042").replace(/\/$/, "");
  const ohifUrl = (process.env.NEXT_PUBLIC_OHIF_URL ?? `${orthancUrl}/ohif`).replace(/\/$/, "");
  return (
    <AppShell>
      <RequireRole roles={["admin"]}>
      <div className="page-header"><div><p className="eyebrow">Configuración</p><h2>Parámetros e integraciones</h2><p>Administra los listados de la agenda y revisa el estado de los servicios.</p></div></div>
      <InstitutionSettings />
      <UsersManager />
      <ParametryManager />
      <ResourceWizard />
      <CatalogManager />
      <ScheduleManager />
      <TemplatesManager />
      <TenantsManager />
      <section className="grid two-columns">
        <article className="card"><div className="card-heading"><h3>Supabase</h3><span className={`phase-state ${supabase.isConfigured ? "ready" : "pending"}`}>{supabase.isConfigured ? "Configurado" : "Pendiente"}</span></div><p>PostgreSQL, autenticación, RLS y auditoría. La migración está en <code>supabase/migrations</code>.</p></article>
        <article className="card"><div className="card-heading"><h3>Orthanc + OHIF</h3><span className="phase-state">Configurado</span></div><p>PACS DICOM de prueba y visor web integrados en un contenedor Docker.</p><div className="integration-links"><a href={`${orthancUrl}/ui/app/`} target="_blank" rel="noreferrer">Orthanc ↗</a><a href={ohifUrl} target="_blank" rel="noreferrer">OHIF ↗</a></div></article>
        <article className="card"><h3>Interoperabilidad</h3><p>Modelo alineado con Patient, Appointment e ImagingStudy de HL7 FHIR. La API FHIR no se expone hasta que exista un consumidor real.</p></article>
        <article className="card"><h3>Uso clínico real</h3><p>Requiere usuarios, permisos, HTTPS, respaldo, monitoreo y una revisión legal y de seguridad antes de habilitarse.</p></article>
      </section>
      </RequireRole>
    </AppShell>
  );
}
