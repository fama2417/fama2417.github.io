"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fetchAppointments } from "@/features/appointments/repository";
import type { Appointment } from "@/features/appointments/mock-data";
import { supabase } from "@/lib/supabase-client";

type Role = "admin" | "operator" | "radiologist";

const roleLabels: Record<Role, string> = { admin: "Administrador", operator: "Operador / admisión", radiologist: "Radiólogo" };
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });

const modules: { href: string; icon: string; title: string; description: string; roles: Role[] }[] = [
  { href: "/agenda", icon: "📅", title: "Agenda", description: "Programar, editar y confirmar citas de imagenología.", roles: ["admin", "operator"] },
  { href: "/worklist", icon: "🩺", title: "Lista de trabajo", description: "Informar estudios junto a sus imágenes y asignar casos.", roles: ["admin", "operator", "radiologist"] },
  { href: "/pacientes", icon: "👤", title: "Pacientes", description: "Registro clínico y trazabilidad de datos personales.", roles: ["admin"] },
  { href: "/configuracion", icon: "⚙️", title: "Configuración", description: "Institución, usuarios, plantillas y parámetros de la agenda.", roles: ["admin"] },
  { href: "/privacidad", icon: "🔒", title: "Privacidad", description: "Política de tratamiento de datos personales (Ley 19.628).", roles: ["admin", "radiologist"] },
];

type Stat = { label: string; value: number; hint: string; view: string; tone?: "danger" | "warning" };

export function HomeDashboard() {
  const [role, setRole] = useState<Role | null>(null);
  const [name, setName] = useState("");
  const [tenant, setTenant] = useState("");
  const [uid, setUid] = useState("");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: auth }) => {
      if (!auth.user) return;
      setUid(auth.user.id);
      supabase.from("profiles").select("full_name, role, tenant:tenants!profiles_tenant_id_fkey(name), activeTenant:tenants!profiles_active_tenant_id_fkey(name)").eq("id", auth.user.id).single().then(({ data }) => {
        if (!data) return;
        setRole(data.role as Role);
        setName((data.full_name as string) ?? "");
        setTenant((data.activeTenant as unknown as { name: string } | null)?.name ?? (data.tenant as unknown as { name: string } | null)?.name ?? "");
      });
    });
    fetchAppointments().then(setAppointments).catch(() => undefined).finally(() => setLoading(false));
  }, []);

  const stats = useMemo<Stat[]>(() => {
    const day = today();
    const withStudy = appointments.filter((item) => item.studyInstanceUid);
    const pending = withStudy.filter((item) => item.reportStatus !== "final");
    const base: Stat[] = [
      { label: "Citas de hoy", value: appointments.filter((item) => item.date === day).length, hint: "Agendadas para la fecha actual", view: "today" },
      { label: "Estudios por informar", value: pending.length, hint: "Con imágenes vinculadas y sin informe definitivo", view: "pending", tone: pending.length ? "warning" : undefined },
      { label: "Hallazgos críticos", value: appointments.filter((item) => item.criticalFinding).length, hint: "Marcados en informes", view: "critical", tone: appointments.some((item) => item.criticalFinding) ? "danger" : undefined },
      { label: "Seguimientos pendientes", value: appointments.filter((item) => item.actionablePending).length, hint: "Recomendaciones accionables abiertas", view: "follow" },
    ];
    if (role === "radiologist") {
      const mine = appointments.filter((item) => item.assignedTo === uid && item.reportStatus !== "final").length;
      return [{ label: "Asignados a mí", value: mine, hint: "Casos que debo informar", view: "mine", tone: mine ? "warning" : undefined }, ...base.slice(1)];
    }
    return base;
  }, [appointments, role, uid]);

  const tiles = role ? modules.filter((item) => item.roles.includes(role)) : [];

  return <>
    <section className="hero home-hero">
      <div>
        <p className="eyebrow">{tenant || "Centro de imagenología"}</p>
        <h2>{name ? `Hola, ${name.split(" ")[0]}` : "Bienvenido"}</h2>
        <p>{role ? `Sesión de ${roleLabels[role]}. ` : ""}Accede a los módulos según tu perfil y revisa el estado del día.</p>
      </div>
    </section>

    <section className="stat-grid" aria-label="Indicadores">
      {stats.map((stat) => <Link key={stat.label} href={`/worklist?view=${stat.view}`} className={`stat-card ${stat.tone ?? ""}`}>
        <span className="stat-value">{loading ? "…" : stat.value}</span>
        <span className="stat-label">{stat.label}</span>
        <span className="stat-hint">{stat.hint}</span>
      </Link>)}
    </section>

    <section className="module-grid" aria-label="Módulos">
      {tiles.map((tile) => <Link key={tile.href} href={tile.href} className="module-card">
        <span className="module-icon" aria-hidden="true">{tile.icon}</span>
        <span className="module-title">{tile.title}</span>
        <span className="module-desc">{tile.description}</span>
        <span className="module-go">Abrir →</span>
      </Link>)}
    </section>
  </>;
}
