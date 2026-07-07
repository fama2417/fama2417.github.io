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
  { href: "/privacidad", label: "Privacidad", roles: ["admin", "radiologist"] },
  { href: "/configuracion", label: "Configuración", roles: ["admin"] },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [role, setRole] = useState<Role | null>(null);
  const [tenant, setTenant] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data: auth }) => {
      if (!auth.user) return;
      supabase.from("profiles").select("role, tenant:tenants!profiles_tenant_id_fkey(name), activeTenant:tenants!profiles_active_tenant_id_fkey(name)").eq("id", auth.user.id).single().then(({ data }) => {
        if (data) {
          setRole(data.role as Role);
          setTenant((data.activeTenant as unknown as { name: string } | null)?.name ?? (data.tenant as unknown as { name: string } | null)?.name ?? "");
        }
      });
    });
  }, []);

  // Hasta conocer el rol no se muestra ninguna pestaña (evita el parpadeo de ver todas por un instante).
  const visible = role ? navigation.filter((item) => item.roles.includes(role)) : [];

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
