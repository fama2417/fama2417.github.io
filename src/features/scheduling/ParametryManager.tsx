"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  createDevice, createLocation, createOrganization, createPractitioner, createPractitionerRole, createService, createServiceType,
  fetchDevices, fetchLocations, fetchOrganizations, fetchPractitioners, fetchPractitionerRoles, fetchServices, fetchServiceTypes,
  type Device, type HealthcareService, type Location, type Organization, type Practitioner, type PractitionerRole, type ServiceType,
} from "./repository";

export function ParametryManager() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [services, setServices] = useState<HealthcareService[]>([]);
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [roles, setRoles] = useState<PractitionerRole[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [error, setError] = useState("");
  const [allowed, setAllowed] = useState(true);

  const reloadOrgs = () => fetchOrganizations().then(setOrgs);
  const reloadLocations = () => fetchLocations().then(setLocations);
  const reloadServices = () => fetchServices().then(setServices);
  const reloadPractitioners = () => fetchPractitioners().then(setPractitioners);
  const reloadRoles = () => fetchPractitionerRoles().then(setRoles);
  const reloadDevices = () => fetchDevices().then(setDevices);
  const reloadServiceTypes = () => fetchServiceTypes().then(setServiceTypes);

  useEffect(() => {
    Promise.all([reloadOrgs(), reloadLocations(), reloadServices(), reloadPractitioners(), reloadRoles(), reloadDevices(), reloadServiceTypes()])
      .catch(() => setAllowed(false));
  }, []);

  const run = (fn: () => Promise<unknown>, reload: () => Promise<unknown>, form?: HTMLFormElement) => async (e: FormEvent) => {
    e.preventDefault(); setError("");
    try { await fn(); await reload(); form?.reset(); }
    catch (err) { setError(err instanceof Error ? err.message : "No fue posible guardar."); }
  };
  const orgName = (id: string) => orgs.find((o) => o.id === id)?.name ?? "—";
  const practName = (id: string) => practitioners.find((p) => p.id === id)?.fullName ?? "—";

  if (!allowed) return null;

  return (
    <section className="card" aria-label="Parametría de agenda">
      <div className="card-heading"><h3>Parametría de agenda (FHIR)</h3></div>
      <p>Instituciones, sedes, servicios, profesionales, roles, equipos y tipos de atención. Con esto se arman los recursos agendables.</p>
      {error && <p className="form-error" role="alert">{error}</p>}

      {/* 1. Instituciones */}
      <h4>Instituciones</h4>
      <form className="catalog-form" onSubmit={(e) => run(() => createOrganization(String(new FormData(e.currentTarget).get("name")).trim()), reloadOrgs, e.currentTarget)(e)}>
        <label>Nombre<input name="name" required placeholder="Ej: Clínica Central" /></label>
        <button className="button secondary" type="submit">Agregar</button>
      </form>
      <ul className="catalog-list">{orgs.map((o) => <li key={o.id}><span>{o.name}</span></li>)}</ul>

      {/* 2. Sedes */}
      <h4>Sedes</h4>
      <form className="catalog-form" onSubmit={(e) => { const f = new FormData(e.currentTarget); run(() => createLocation(String(f.get("org")), String(f.get("name")).trim(), String(f.get("addr")).trim()), reloadLocations, e.currentTarget)(e); }}>
        <label>Institución<select name="org" required><option value="">…</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label>Nombre<input name="name" required placeholder="Ej: Sede Providencia" /></label>
        <label>Dirección<input name="addr" placeholder="Opcional" /></label>
        <button className="button secondary" type="submit">Agregar</button>
      </form>
      <ul className="catalog-list">{locations.map((l) => <li key={l.id}><span><strong>{l.name}</strong> · {orgName(l.organizationId)}</span></li>)}</ul>

      {/* 3. Servicios clínicos */}
      <h4>Servicios clínicos</h4>
      <form className="catalog-form" onSubmit={(e) => { const f = new FormData(e.currentTarget); run(() => createService(String(f.get("org")), String(f.get("name")).trim(), String(f.get("spec")).trim(), Number(f.get("cap")) || 1), reloadServices, e.currentTarget)(e); }}>
        <label>Institución<select name="org" required><option value="">…</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label>Nombre<input name="name" required placeholder="Ej: Cardiología" /></label>
        <label>Especialidad<input name="spec" placeholder="Opcional" /></label>
        <label>Capacidad<input name="cap" type="number" min={1} defaultValue={1} /></label>
        <button className="button secondary" type="submit">Agregar</button>
      </form>
      <ul className="catalog-list">{services.map((s) => <li key={s.id}><span><strong>{s.name}</strong> · {orgName(s.organizationId)} · cap. {s.capacity}</span></li>)}</ul>

      {/* 4. Profesionales */}
      <h4>Profesionales</h4>
      <form className="catalog-form" onSubmit={(e) => { const f = new FormData(e.currentTarget); run(() => createPractitioner(String(f.get("name")).trim(), String(f.get("reg")).trim()), reloadPractitioners, e.currentTarget)(e); }}>
        <label>Nombre<input name="name" required placeholder="Ej: Dr. Pepito" /></label>
        <label>Registro profesional<input name="reg" placeholder="Opcional" /></label>
        <button className="button secondary" type="submit">Agregar</button>
      </form>
      <ul className="catalog-list">{practitioners.map((p) => <li key={p.id}><span>{p.fullName}{p.professionalRegistration && ` · ${p.professionalRegistration}`}</span></li>)}</ul>

      {/* 5. Roles profesionales (profesional + institución + sede + servicio) */}
      <h4>Roles profesionales</h4>
      <form className="catalog-form" onSubmit={(e) => { const f = new FormData(e.currentTarget); run(() => createPractitionerRole({ practitionerId: String(f.get("pract")), organizationId: String(f.get("org")), locationId: String(f.get("loc")) || null, healthcareServiceId: String(f.get("svc")) || null, specialty: String(f.get("spec")).trim() }), reloadRoles, e.currentTarget)(e); }}>
        <label>Profesional<select name="pract" required><option value="">…</option>{practitioners.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}</select></label>
        <label>Institución<select name="org" required><option value="">…</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label>Sede<select name="loc"><option value="">(Cualquiera)</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label>Servicio<select name="svc"><option value="">(Ninguno)</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Especialidad<input name="spec" placeholder="Ej: Cardiología" /></label>
        <button className="button secondary" type="submit">Agregar</button>
      </form>
      <ul className="catalog-list">{roles.map((r) => <li key={r.id}><span>{practName(r.practitionerId)} · {orgName(r.organizationId)}{r.specialty && ` · ${r.specialty}`}</span></li>)}</ul>

      {/* 6. Equipos / salas físicas */}
      <h4>Equipos</h4>
      <form className="catalog-form" onSubmit={(e) => { const f = new FormData(e.currentTarget); run(() => createDevice({ organizationId: String(f.get("org")), locationId: String(f.get("loc")) || null, name: String(f.get("name")).trim(), modality: String(f.get("mod")).trim() }), reloadDevices, e.currentTarget)(e); }}>
        <label>Institución<select name="org" required><option value="">…</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label>Sede<select name="loc"><option value="">(Cualquiera)</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label>Nombre<input name="name" required placeholder="Ej: RM Siemens 1.5T" /></label>
        <label>Modalidad<input name="mod" placeholder="Ej: MR, CT" /></label>
        <button className="button secondary" type="submit">Agregar</button>
      </form>
      <ul className="catalog-list">{devices.map((d) => <li key={d.id}><span><strong>{d.name}</strong> · {orgName(d.organizationId)}{d.modality && ` · ${d.modality}`}</span></li>)}</ul>

      {/* 7. Tipos de atención / prestaciones */}
      <h4>Tipos de atención</h4>
      <form className="catalog-form" onSubmit={(e) => { const f = new FormData(e.currentTarget); run(() => createServiceType({ code: String(f.get("code")).trim(), name: String(f.get("name")).trim(), durationMin: Number(f.get("dur")) || 30, capacity: Number(f.get("cap")) || 1, requiresContrast: f.get("contrast") === "on", requiresAnesthesia: f.get("anesth") === "on", prepInstructions: String(f.get("prep")).trim() }), reloadServiceTypes, e.currentTarget)(e); }}>
        <label>Código<input name="code" placeholder="Opcional" /></label>
        <label>Nombre<input name="name" required placeholder="Ej: RM de cerebro" /></label>
        <label>Duración (min)<input name="dur" type="number" min={5} defaultValue={30} /></label>
        <label>Capacidad<input name="cap" type="number" min={1} defaultValue={1} /></label>
        <label className="checkbox"><input name="contrast" type="checkbox" /> Contraste</label>
        <label className="checkbox"><input name="anesth" type="checkbox" /> Anestesia</label>
        <label>Preparación<input name="prep" placeholder="Opcional" /></label>
        <button className="button secondary" type="submit">Agregar</button>
      </form>
      <ul className="catalog-list">{serviceTypes.map((s) => <li key={s.id}><span><strong>{s.name}</strong> · {s.durationMin}′{s.requiresContrast && " · contraste"}{s.requiresAnesthesia && " · anestesia"}</span></li>)}</ul>
    </section>
  );
}
