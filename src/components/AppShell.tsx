"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase-client";

type Role = "admin" | "operator" | "radiologist";

const navigation: { href: string; label: string; roles: Role[] }[] = [
  { href: "/", label: "Inicio", roles: ["admin", "operator", "radiologist"] },
  { href: "/agenda", label: "Agenda", roles: ["admin", "operator"] },
  { href: "/pacientes", label: "Pacientes", roles: ["admin"] },
  { href: "/worklist", label: "Lista de trabajo", roles: ["admin", "operator", "radiologist"] },
  { href: "/privacidad", label: "Privacidad", roles: ["admin", "operator", "radiologist"] },
  { href: "/configuracion", label: "Configuración", roles: ["admin", "operator"] },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [role, setRole] = useState<Role | null>(null);
  const [tenant, setTenant] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data: auth }) => {
      if (!auth.user) return;
      supabase.from("profiles").select("role, tenant:tenants(name)").eq("id", auth.user.id).single().then(({ data }) => {
        if (data) {
          setRole(data.role as Role);
          setTenant((data.tenant as unknown as { name: string } | null)?.name ?? "");
        }
      });
    });
  }, []);

  const visible = navigation.filter((item) => !role || item.roles.includes(role));

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><p className="eyebrow">{tenant || "PACS · Agenda"}</p><h1>Imagenología</h1></div>
        <nav aria-label="Navegación principal">
          {visible.map((item) => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined}>{item.label}</Link>)}
        </nav>
      </header>
      <main className="main-content">{children}</main>
    </div>
  );
}
