import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { implementationPhases } from "@/lib/clinical-roadmap";

export default function Home() {
  return (
    <AppShell>
      <section className="hero"><p className="eyebrow">Centro de imagenología</p><h2>Agenda clínica y flujo de imágenes en un solo lugar</h2><p>El MVP permite validar la operación completa con datos ficticios antes de conectar servicios clínicos reales.</p><div className="hero-actions"><Link className="button primary" href="/agenda">Abrir agenda</Link><Link className="button secondary" href="/worklist">Ver worklist</Link></div></section>
      <section className="grid two-columns">{implementationPhases.map((phase) => <article className="card" key={phase.title}><div className="card-heading"><h3>{phase.title}</h3><span className="phase-state">{phase.state}</span></div><ul>{phase.items.map((item) => <li key={item}>{item}</li>)}</ul></article>)}</section>
      <section className="notice"><strong>Importante:</strong> este entorno usa almacenamiento local de demostración. No contiene ni debe recibir datos reales de pacientes.</section>
    </AppShell>
  );
}
