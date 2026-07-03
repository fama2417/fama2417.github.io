"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const navigation = [
  { href: "/", label: "Inicio" },
  { href: "/agenda", label: "Agenda" },
  { href: "/pacientes", label: "Pacientes" },
  { href: "/worklist", label: "Lista de trabajo" },
  { href: "/privacidad", label: "Privacidad" },
  { href: "/configuracion", label: "Configuración" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><p className="eyebrow">PACS · Agenda</p><h1>Imagenología</h1></div>
        <nav aria-label="Navegación principal">
          {navigation.map((item) => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined}>{item.label}</Link>)}
        </nav>
      </header>
      <main className="main-content">{children}</main>
    </div>
  );
}
