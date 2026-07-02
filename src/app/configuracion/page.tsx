import { AppShell } from "@/components/AppShell";

const integrationBlocks = [
  {
    title: "Supabase",
    description: "Base PostgreSQL, autenticación inicial, RLS y storage de archivos no DICOM para pruebas.",
  },
  {
    title: "Orthanc",
    description: "PACS Open Source recomendado para pruebas DICOM, DICOMweb y conexión futura con OHIF.",
  },
  {
    title: "OHIF Viewer",
    description: "Visor web Open Source para estudios DICOM conectado a DICOMweb.",
  },
  {
    title: "FHIR",
    description: "Referencia de interoperabilidad para Patient, Practitioner, Appointment, Schedule e ImagingStudy.",
  },
];

export default function SettingsPage() {
  return (
    <AppShell>
      <div className="page-header">
        <div>
          <p className="eyebrow">Arquitectura</p>
          <h2>Configuración e integraciones futuras</h2>
          <p>Decisiones técnicas iniciales para mantener el proyecto alineado con estándares clínicos.</p>
        </div>
      </div>

      <section className="grid two-columns">
        {integrationBlocks.map((block) => (
          <article className="card" key={block.title}>
            <h3>{block.title}</h3>
            <p>{block.description}</p>
          </article>
        ))}
      </section>
    </AppShell>
  );
}
