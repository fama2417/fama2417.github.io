"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  createDevice, createLocation, createPractitioner, createPractitionerRole, createService, createServiceType, deleteEntity,
  fetchDevices, fetchLocations, fetchOrganizations, fetchPractitioners, fetchPractitionerRoles, fetchServices, fetchServiceTypes,
  updateDevice, updateLocation, updatePractitioner, updateRole, updateService, updateServiceType,
  type Device, type HealthcareService, type Location, type Organization, type Practitioner, type PractitionerRole, type ServiceType,
} from "./repository";

// Pestañas con su etiqueta amigable + info técnica (nombre FHIR) para que se entienda a qué se refiere.
const TABS = {
  locations: { label: "Sedes", help: "Location (FHIR): lugar físico donde se atiende. Una institución puede tener varias sedes." },
  services: { label: "Servicios", help: "HealthcareService: unidad clínica que presta atención (Cardiología, Imagenología…). Su capacidad = atenciones simultáneas." },
  practitioners: { label: "Profesionales", help: "Practitioner: la persona. Puede o no tener usuario del sistema." },
  roles: { label: "Roles", help: "PractitionerRole: el profesional ejerciendo en una sede y servicio concretos. Es lo que se agenda como recurso «profesional»." },
  devices: { label: "Equipos", help: "Device: equipo agendable (resonador, scanner, torre endoscópica). Modalidad DICOM si aplica." },
  serviceTypes: { label: "Tipos de atención", help: "Prestación: qué se hace en la cita, con su duración, capacidad y reglas (contraste/anestesia)." },
} as const;
type Tab = keyof typeof TABS;

export function ParametryManager() {
  const [tab, setTab] = useState<Tab>("locations");
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [services, setServices] = useState<HealthcareService[]>([]);
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [roles, setRoles] = useState<PractitionerRole[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [allowed, setAllowed] = useState(true);

  const loaders: Record<Tab, () => Promise<unknown>> = {
    locations: () => fetchLocations().then(setLocations),
    services: () => fetchServices().then(setServices),
    practitioners: () => fetchPractitioners().then(setPractitioners),
    roles: () => fetchPractitionerRoles().then(setRoles),
    devices: () => fetchDevices().then(setDevices),
    serviceTypes: () => fetchServiceTypes().then(setServiceTypes),
  };

  useEffect(() => {
    Promise.all([fetchOrganizations().then(setOrgs), ...Object.values(loaders).map((fn) => fn())]).catch(() => setAllowed(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Institución no se muestra (la gestiona el superadmin). Con una sola org se usa por defecto.
  const orgId = orgs[0]?.id ?? "";
  const orgName = (id: string) => orgs.find((o) => o.id === id)?.name ?? "—";
  const practName = (id: string) => practitioners.find((p) => p.id === id)?.fullName ?? "—";

  const run = (fn: () => Promise<unknown>, form?: HTMLFormElement) => async (e: FormEvent) => {
    e.preventDefault(); setError("");
    try { await fn(); await loaders[tab](); setEditing(null); form?.reset(); }
    catch (err) { setError(err instanceof Error ? err.message : "No fue posible guardar."); }
  };
  const del = (table: Parameters<typeof deleteEntity>[0], id: string) => async () => {
    if (!confirm("¿Eliminar definitivamente? Si está en uso por una cita, no se podrá.")) return;
    setError("");
    try { await deleteEntity(table, id); await loaders[tab](); }
    catch { setError("No fue posible eliminar: probablemente esté en uso (citas, cupos o recursos)."); }
  };
  const E = editing ?? {};
  const set = (k: string, v: unknown) => setEditing({ ...E, [k]: v });
  const s = (k: string) => String(E[k] ?? "");

  if (!allowed) return null;

  return (
    <section className="card" aria-label="Parametría de agenda">
      <div className="card-heading"><h3>Parametría de agenda</h3><span className="phase-state">FHIR</span></div>
      <p>Bloques con los que se arman los recursos agendables. La institución la define el superadministrador.</p>
      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="catalog-layout">
        <nav className="catalog-tabs" aria-label="Componentes de la agenda">
          {(Object.keys(TABS) as Tab[]).map((key) => (
            <button key={key} type="button" className={key === tab ? "active" : ""} onClick={() => { setTab(key); setEditing(null); setError(""); }}>{TABS[key].label}</button>
          ))}
        </nav>

        <div>
          <p className="empty-inline" style={{ marginTop: 0 }}>{TABS[tab].help}</p>

          {tab === "locations" && <>
            <form className="catalog-form" onSubmit={(e) => { const f = new FormData(e.currentTarget); run(() => createLocation(orgId, String(f.get("name")).trim(), String(f.get("addr")).trim()), e.currentTarget)(e); }}>
              <label>Nombre<input name="name" required placeholder="Ej: Sede Providencia" /></label>
              <label>Dirección<input name="addr" placeholder="Opcional" /></label>
              <button className="button primary" type="submit">Agregar</button>
            </form>
            <ul className="catalog-list">{locations.map((l) => <li key={l.id} className={l.active ? "" : "inactive"}>{editing?.id === l.id
              ? <form className="catalog-form" onSubmit={run(() => updateLocation(l.id, { name: s("name"), address: s("address"), active: Boolean(E.active) }))}>
                  <label>Nombre<input value={s("name")} onChange={(e) => set("name", e.target.value)} required /></label>
                  <label>Dirección<input value={s("address")} onChange={(e) => set("address", e.target.value)} /></label>
                  <label className="checkbox"><input type="checkbox" checked={Boolean(E.active)} onChange={(e) => set("active", e.target.checked)} /> Activa</label>
                  <button className="button primary" type="submit">Guardar</button><button className="text-button" type="button" onClick={() => setEditing(null)}>Cancelar</button>
                </form>
              : <><span><strong>{l.name}</strong>{l.address && ` · ${l.address}`}</span><span><button className="text-button" type="button" onClick={() => setEditing({ ...l })}>Editar</button><button className="text-button" type="button" onClick={del("locations", l.id)}>Eliminar</button></span></>}
            </li>)}</ul>
          </>}

          {tab === "services" && <>
            <form className="catalog-form" onSubmit={(e) => { const f = new FormData(e.currentTarget); run(() => createService(orgId, String(f.get("name")).trim(), String(f.get("spec")).trim(), Number(f.get("cap")) || 1), e.currentTarget)(e); }}>
              <label>Nombre<input name="name" required placeholder="Ej: Cardiología" /></label>
              <label>Especialidad<input name="spec" placeholder="Opcional" /></label>
              <label>Capacidad<input name="cap" type="number" min={1} defaultValue={1} /></label>
              <button className="button primary" type="submit">Agregar</button>
            </form>
            <ul className="catalog-list">{services.map((sv) => <li key={sv.id} className={sv.active ? "" : "inactive"}>{editing?.id === sv.id
              ? <form className="catalog-form" onSubmit={run(() => updateService(sv.id, { name: s("name"), specialty: s("specialty"), capacity: Number(E.capacity) || 1, active: Boolean(E.active) }))}>
                  <label>Nombre<input value={s("name")} onChange={(e) => set("name", e.target.value)} required /></label>
                  <label>Especialidad<input value={s("specialty")} onChange={(e) => set("specialty", e.target.value)} /></label>
                  <label>Capacidad<input type="number" min={1} value={Number(E.capacity) || 1} onChange={(e) => set("capacity", Number(e.target.value))} /></label>
                  <label className="checkbox"><input type="checkbox" checked={Boolean(E.active)} onChange={(e) => set("active", e.target.checked)} /> Activo</label>
                  <button className="button primary" type="submit">Guardar</button><button className="text-button" type="button" onClick={() => setEditing(null)}>Cancelar</button>
                </form>
              : <><span><strong>{sv.name}</strong>{sv.specialty && ` · ${sv.specialty}`} · cap. {sv.capacity}</span><span><button className="text-button" type="button" onClick={() => setEditing({ ...sv })}>Editar</button><button className="text-button" type="button" onClick={del("healthcare_services", sv.id)}>Eliminar</button></span></>}
            </li>)}</ul>
          </>}

          {tab === "practitioners" && <>
            <form className="catalog-form" onSubmit={(e) => { const f = new FormData(e.currentTarget); run(() => createPractitioner(String(f.get("name")).trim(), String(f.get("reg")).trim()), e.currentTarget)(e); }}>
              <label>Nombre<input name="name" required placeholder="Ej: Dr. Pepito" /></label>
              <label>Registro profesional<input name="reg" placeholder="Opcional" /></label>
              <button className="button primary" type="submit">Agregar</button>
            </form>
            <ul className="catalog-list">{practitioners.map((p) => <li key={p.id} className={p.active ? "" : "inactive"}>{editing?.id === p.id
              ? <form className="catalog-form" onSubmit={run(() => updatePractitioner(p.id, { fullName: s("fullName"), professionalRegistration: s("professionalRegistration"), active: Boolean(E.active) }))}>
                  <label>Nombre<input value={s("fullName")} onChange={(e) => set("fullName", e.target.value)} required /></label>
                  <label>Registro<input value={s("professionalRegistration")} onChange={(e) => set("professionalRegistration", e.target.value)} /></label>
                  <label className="checkbox"><input type="checkbox" checked={Boolean(E.active)} onChange={(e) => set("active", e.target.checked)} /> Activo</label>
                  <button className="button primary" type="submit">Guardar</button><button className="text-button" type="button" onClick={() => setEditing(null)}>Cancelar</button>
                </form>
              : <><span><strong>{p.fullName}</strong>{p.professionalRegistration && ` · ${p.professionalRegistration}`}</span><span><button className="text-button" type="button" onClick={() => setEditing({ ...p })}>Editar</button><button className="text-button" type="button" onClick={del("practitioners", p.id)}>Eliminar</button></span></>}
            </li>)}</ul>
          </>}

          {tab === "roles" && <>
            <form className="catalog-form" onSubmit={(e) => { const f = new FormData(e.currentTarget); run(() => createPractitionerRole({ practitionerId: String(f.get("pract")), organizationId: orgId, locationId: String(f.get("loc")) || null, healthcareServiceId: String(f.get("svc")) || null, specialty: String(f.get("spec")).trim() }), e.currentTarget)(e); }}>
              <label>Profesional<select name="pract" required><option value="">…</option>{practitioners.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}</select></label>
              <label>Sede<select name="loc"><option value="">(Cualquiera)</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
              <label>Servicio<select name="svc"><option value="">(Ninguno)</option>{services.map((sv) => <option key={sv.id} value={sv.id}>{sv.name}</option>)}</select></label>
              <label>Especialidad<input name="spec" placeholder="Ej: Cardiología" /></label>
              <button className="button primary" type="submit">Agregar</button>
            </form>
            <ul className="catalog-list">{roles.map((r) => <li key={r.id} className={r.active ? "" : "inactive"}>{editing?.id === r.id
              ? <form className="catalog-form" onSubmit={run(() => updateRole(r.id, { specialty: s("specialty"), locationId: s("locationId") || null, healthcareServiceId: s("healthcareServiceId") || null, active: Boolean(E.active) }))}>
                  <label>Sede<select value={s("locationId")} onChange={(e) => set("locationId", e.target.value)}><option value="">(Cualquiera)</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
                  <label>Servicio<select value={s("healthcareServiceId")} onChange={(e) => set("healthcareServiceId", e.target.value)}><option value="">(Ninguno)</option>{services.map((sv) => <option key={sv.id} value={sv.id}>{sv.name}</option>)}</select></label>
                  <label>Especialidad<input value={s("specialty")} onChange={(e) => set("specialty", e.target.value)} /></label>
                  <label className="checkbox"><input type="checkbox" checked={Boolean(E.active)} onChange={(e) => set("active", e.target.checked)} /> Activo</label>
                  <button className="button primary" type="submit">Guardar</button><button className="text-button" type="button" onClick={() => setEditing(null)}>Cancelar</button>
                </form>
              : <><span><strong>{practName(r.practitionerId)}</strong>{r.specialty && ` · ${r.specialty}`}{r.locationId ? ` · ${locations.find((l) => l.id === r.locationId)?.name ?? ""}` : ""}</span><span><button className="text-button" type="button" onClick={() => setEditing({ ...r })}>Editar</button><button className="text-button" type="button" onClick={del("practitioner_roles", r.id)}>Eliminar</button></span></>}
            </li>)}</ul>
          </>}

          {tab === "devices" && <>
            <form className="catalog-form" onSubmit={(e) => { const f = new FormData(e.currentTarget); run(() => createDevice({ organizationId: orgId, locationId: String(f.get("loc")) || null, name: String(f.get("name")).trim(), modality: String(f.get("mod")).trim() }), e.currentTarget)(e); }}>
              <label>Nombre<input name="name" required placeholder="Ej: RM Siemens 1.5T" /></label>
              <label>Sede<select name="loc"><option value="">(Cualquiera)</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
              <label>Modalidad<input name="mod" placeholder="Ej: MR, CT" /></label>
              <button className="button primary" type="submit">Agregar</button>
            </form>
            <ul className="catalog-list">{devices.map((d) => <li key={d.id} className={d.active ? "" : "inactive"}>{editing?.id === d.id
              ? <form className="catalog-form" onSubmit={run(() => updateDevice(d.id, { name: s("name"), modality: s("modality"), locationId: s("locationId") || null, active: Boolean(E.active) }))}>
                  <label>Nombre<input value={s("name")} onChange={(e) => set("name", e.target.value)} required /></label>
                  <label>Sede<select value={s("locationId")} onChange={(e) => set("locationId", e.target.value)}><option value="">(Cualquiera)</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
                  <label>Modalidad<input value={s("modality")} onChange={(e) => set("modality", e.target.value)} /></label>
                  <label className="checkbox"><input type="checkbox" checked={Boolean(E.active)} onChange={(e) => set("active", e.target.checked)} /> Activo</label>
                  <button className="button primary" type="submit">Guardar</button><button className="text-button" type="button" onClick={() => setEditing(null)}>Cancelar</button>
                </form>
              : <><span><strong>{d.name}</strong>{d.modality && ` · ${d.modality}`}</span><span><button className="text-button" type="button" onClick={() => setEditing({ ...d })}>Editar</button><button className="text-button" type="button" onClick={del("devices", d.id)}>Eliminar</button></span></>}
            </li>)}</ul>
          </>}

          {tab === "serviceTypes" && <>
            <form className="catalog-form" onSubmit={(e) => { const f = new FormData(e.currentTarget); run(() => createServiceType({ code: String(f.get("code")).trim(), name: String(f.get("name")).trim(), durationMin: Number(f.get("dur")) || 30, capacity: Number(f.get("cap")) || 1, requiresContrast: f.get("contrast") === "on", requiresAnesthesia: f.get("anesth") === "on", prepInstructions: String(f.get("prep")).trim(), category: "procedure", modality: "", practitionerRequirement: "optional" }), e.currentTarget)(e); }}>
              <label>Código<input name="code" placeholder="Opcional" /></label>
              <label>Nombre<input name="name" required placeholder="Ej: RM de cerebro" /></label>
              <label>Duración (min)<input name="dur" type="number" min={5} defaultValue={30} /></label>
              <label>Capacidad<input name="cap" type="number" min={1} defaultValue={1} /></label>
              <label className="checkbox"><input name="contrast" type="checkbox" /> Contraste</label>
              <label className="checkbox"><input name="anesth" type="checkbox" /> Anestesia</label>
              <label>Preparación<input name="prep" placeholder="Opcional" /></label>
              <button className="button primary" type="submit">Agregar</button>
            </form>
            <ul className="catalog-list">{serviceTypes.map((st) => <li key={st.id} className={st.active ? "" : "inactive"}>{editing?.id === st.id
              ? <form className="catalog-form" onSubmit={run(() => updateServiceType(st.id, { code: s("code"), name: s("name"), durationMin: Number(E.durationMin) || 30, capacity: Number(E.capacity) || 1, requiresContrast: Boolean(E.requiresContrast), requiresAnesthesia: Boolean(E.requiresAnesthesia), prepInstructions: s("prepInstructions"), active: Boolean(E.active), category: st.category, modality: st.modality, practitionerRequirement: st.practitionerRequirement }))}>
                  <label>Código<input value={s("code")} onChange={(e) => set("code", e.target.value)} /></label>
                  <label>Nombre<input value={s("name")} onChange={(e) => set("name", e.target.value)} required /></label>
                  <label>Duración<input type="number" min={5} value={Number(E.durationMin) || 30} onChange={(e) => set("durationMin", Number(e.target.value))} /></label>
                  <label>Capacidad<input type="number" min={1} value={Number(E.capacity) || 1} onChange={(e) => set("capacity", Number(e.target.value))} /></label>
                  <label className="checkbox"><input type="checkbox" checked={Boolean(E.requiresContrast)} onChange={(e) => set("requiresContrast", e.target.checked)} /> Contraste</label>
                  <label className="checkbox"><input type="checkbox" checked={Boolean(E.requiresAnesthesia)} onChange={(e) => set("requiresAnesthesia", e.target.checked)} /> Anestesia</label>
                  <label className="checkbox"><input type="checkbox" checked={Boolean(E.active)} onChange={(e) => set("active", e.target.checked)} /> Activo</label>
                  <button className="button primary" type="submit">Guardar</button><button className="text-button" type="button" onClick={() => setEditing(null)}>Cancelar</button>
                </form>
              : <><span><strong>{st.name}</strong> · {st.durationMin}′{st.requiresContrast && " · contraste"}{st.requiresAnesthesia && " · anestesia"}</span><span><button className="text-button" type="button" onClick={() => setEditing({ ...st })}>Editar</button><button className="text-button" type="button" onClick={del("service_types", st.id)}>Eliminar</button></span></>}
            </li>)}</ul>
          </>}
        </div>
      </div>
    </section>
  );
}
