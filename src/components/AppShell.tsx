import Link from "next/link";
import type { ReactNode } from "react";

const navigation = [
  { href: "/", label: "Inicio" },
  { href: "/agenda", label: "Agenda" },
  { href: "/pacientes", label: "Pacientes" },
  { href: "/worklist", label: "Worklist / Imágenes" },
  { href: "/configuracion", label: "Configuración" },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Navegación principal">
        <div><p className="eyebrow">MVP clínico</p><h1>Agenda + Imagenología</h1></div>
        <nav>{navigation.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}</nav>
        <div className="sidebar-card"><strong>Supabase conectado</strong><span>Acceso autenticado, RLS y auditoría activos.</span></div>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
