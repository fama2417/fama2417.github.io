import { AppShell } from "@/components/AppShell";
import { getSupabaseEnvironment } from "@/lib/supabase";

export default function SettingsPage() {
  const supabase = getSupabaseEnvironment();
  return (
    <AppShell>
      <div className="page-header"><div><p className="eyebrow">Integraciones</p><h2>Configuración técnica</h2><p>Estado de los servicios externos del MVP.</p></div></div>
      <section className="grid two-columns">
        <article className="card"><div className="card-heading"><h3>Supabase</h3><span className={`phase-state ${supabase.isConfigured ? "ready" : "pending"}`}>{supabase.isConfigured ? "Configurado" : "Pendiente"}</span></div><p>PostgreSQL, autenticación, RLS y auditoría. La migración está en <code>supabase/migrations</code>.</p></article>
        <article className="card"><div className="card-heading"><h3>Orthanc + OHIF</h3><span className="phase-state">Listo para iniciar</span></div><p>PACS DICOM de prueba y visor web integrados en un contenedor Docker.</p><div className="integration-links"><a href="http://localhost:8042/ui/app/" target="_blank" rel="noreferrer">Orthanc ↗</a><a href="http://localhost:8042/ohif/" target="_blank" rel="noreferrer">OHIF ↗</a></div></article>
        <article className="card"><h3>Interoperabilidad</h3><p>Modelo alineado con Patient, Appointment e ImagingStudy de HL7 FHIR. La API FHIR no se expone hasta que exista un consumidor real.</p></article>
        <article className="card"><h3>Uso clínico real</h3><p>Requiere usuarios, permisos, HTTPS, respaldo, monitoreo y una revisión legal y de seguridad antes de habilitarse.</p></article>
      </section>
    </AppShell>
  );
}
