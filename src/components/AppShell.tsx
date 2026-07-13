"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase-client";

type Role = "admin" | "operator" | "radiologist" | "clinician";

const roleLabels: Record<Role, string> = { admin: "Administrador", operator: "Operador", radiologist: "Radiólogo", clinician: "Profesional clínico" };

const navigation: { href: string; label: string; roles: Role[] }[] = [
  { href: "/", label: "Inicio", roles: ["admin", "operator", "radiologist", "clinician"] },
  { href: "/agenda", label: "Agenda", roles: ["admin", "operator"] },
  { href: "/pacientes", label: "Pacientes", roles: ["admin", "operator", "radiologist", "clinician"] },
  { href: "/worklist", label: "Lista de trabajo", roles: ["admin", "operator", "radiologist", "clinician"] },
  { href: "/privacidad", label: "Privacidad", roles: ["admin", "radiologist"] },
  { href: "/configuracion", label: "Configuración", roles: ["admin"] },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [role, setRole] = useState<Role | null>(null);
  const [userName, setUserName] = useState("");
  const [tenant, setTenant] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  // Rutas de trabajo clínico: sidebar escondida por defecto para conservar ancho (drawer bajo demanda).
  const compact = pathname.startsWith("/informe");

  useEffect(() => {
    supabase.auth.getUser().then(({ data: auth }) => {
      if (!auth.user) return;
      supabase.from("profiles").select("role, full_name, tenant:tenants!profiles_tenant_id_fkey(name), activeTenant:tenants!profiles_active_tenant_id_fkey(name)").eq("id", auth.user.id).single().then(({ data }) => {
        if (data) {
          setRole(data.role as Role);
          setUserName(data.full_name ?? "");
          setTenant((data.activeTenant as unknown as { name: string } | null)?.name ?? (data.tenant as unknown as { name: string } | null)?.name ?? "");
        }
      });
    });
  }, []);

  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    sidebarRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // Hasta conocer el rol no se muestra ningún enlace (evita el parpadeo de ver todos por un instante).
  const visible = role ? navigation.filter((item) => item.roles.includes(role)) : [];
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className={compact ? "app-shell app-shell-compact" : "app-shell"}>
      <aside ref={sidebarRef} id="app-shell-sidebar" className={menuOpen ? "app-shell-sidebar open" : "app-shell-sidebar"} aria-label="Navegación principal" tabIndex={-1}>
        <div className="app-shell-brand"><p className="eyebrow">{tenant || "PACS · Agenda"}</p><h1>Imagenología</h1></div>
        <nav className="app-shell-nav">
          {visible.map((item) => <Link key={item.href} href={item.href} aria-current={isActive(item.href) ? "page" : undefined} onClick={() => setMenuOpen(false)}>{item.label}</Link>)}
        </nav>
        {role && (
          <div className="app-shell-user">
            <strong>{userName || "Sesión activa"}</strong>
            <span>{roleLabels[role]}</span>
            <button type="button" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
          </div>
        )}
      </aside>
      {menuOpen && <div className="app-shell-scrim" aria-hidden="true" onClick={() => setMenuOpen(false)} />}
      <div className="app-shell-main">
        <div className="app-shell-topbar">
          <button className="app-shell-menu-button" type="button" aria-label="Abrir menú de navegación" aria-expanded={menuOpen} aria-controls="app-shell-sidebar" onClick={() => setMenuOpen((open) => !open)}>☰</button>
          <h1>Imagenología</h1>
        </div>
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
