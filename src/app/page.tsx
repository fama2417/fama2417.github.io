import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { clinicalStandards, implementationPhases } from "@/lib/clinical-roadmap";

export default function Home() {
  return (
    <AppShell>
      <section className="hero">
        <p className="eyebrow">Plan de implementación</p>
        <h2>Base para Agenda Web, Pacientes, Worklist y visualización DICOM</h2>
        <p>
          Primer hito del proyecto: reemplazar la página estática por una aplicación clínica modular,
          preparada para Supabase, estándares FHIR y una futura integración Orthanc/OHIF.
        </p>
        <div className="hero-actions">
          <Link className="button primary" href="/agenda">Abrir agenda</Link>
          <Link className="button secondary" href="/pacientes">Ver pacientes</Link>
        </div>
      </section>

      <section className="grid two-columns">
        {implementationPhases.map((phase) => (
          <article className="card" key={phase.title}>
            <h3>{phase.title}</h3>
            <ul>
              {phase.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </article>
        ))}
      </section>

      <section className="card">
        <h3>Estándares y decisiones técnicas</h3>
        <ul>
          {clinicalStandards.map((standard) => <li key={standard}>{standard}</li>)}
        </ul>
      </section>
    </AppShell>
  );
}
