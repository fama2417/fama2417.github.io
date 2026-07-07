"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createResource, fetchDevices, fetchLocations, fetchOrganizations, fetchPractitioners, fetchPractitionerRoles,
  fetchResources, fetchServices, fetchServiceTypes, generateSlots, replaceSchedule, KIND_LABELS,
  type Device, type HealthcareService, type Location, type Organization, type Practitioner, type PractitionerRole,
  type ResourceKind, type Schedule, type SchedulableResource, type ServiceType,
} from "./repository";

const WEEKDAYS = [
  { value: 1, label: "Lun" }, { value: 2, label: "Mar" }, { value: 3, label: "Mié" },
  { value: 4, label: "Jue" }, { value: 5, label: "Vie" }, { value: 6, label: "Sáb" }, { value: 7, label: "Dom" },
];
const KINDS: ResourceKind[] = ["professional", "device", "location", "service", "composite"];
type Block = Omit<Schedule, "id" | "resourceId">;
const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

export function ResourceWizard({ onCreated }: { onCreated?: () => void }) {
  const [step, setStep] = useState(1);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [services, setServices] = useState<HealthcareService[]>([]);
  const [roles, setRoles] = useState<PractitionerRole[]>([]);
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [resources, setResources] = useState<SchedulableResource[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);

  const [organizationId, setOrganizationId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [healthcareServiceId, setHealthcareServiceId] = useState("");
  const [kind, setKind] = useState<ResourceKind>("professional");
  const [name, setName] = useState("");
  const [practitionerRoleId, setPractitionerRoleId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [serviceTypeIds, setServiceTypeIds] = useState<string[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([{ weekday: 1, startTime: "08:00", endTime: "18:00", slotDurationMin: 30, slotCapacity: 1, validFrom: today(), validTo: null }]);
  const [range, setRange] = useState({ from: today(), to: inDays(30) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  useEffect(() => {
    Promise.all([fetchOrganizations(), fetchLocations(), fetchServices(), fetchPractitionerRoles(), fetchPractitioners(), fetchDevices(), fetchResources(), fetchServiceTypes()])
      .then(([o, l, s, r, p, d, res, st]) => { setOrgs(o); setOrganizationId(o[0]?.id ?? ""); setLocations(l); setServices(s); setRoles(r); setPractitioners(p); setDevices(d); setResources(res); setServiceTypes(st); })
      .catch(() => setError("No fue posible cargar la parametría. Crea sedes y servicios primero."));
  }, []);

  const practitionerName = useMemo(() => Object.fromEntries(practitioners.map((p) => [p.id, p.fullName])), [practitioners]);
  const orgLocations = locations.filter((l) => l.organizationId === organizationId && l.active);
  const orgServices = services.filter((s) => s.organizationId === organizationId && s.active);
  const orgRoles = roles.filter((r) => r.organizationId === organizationId && r.active);
  const orgDevices = devices.filter((d) => d.organizationId === organizationId && d.active);
  const composableMembers = resources.filter((r) => r.kind !== "composite" && r.active);

  // Nombre por defecto según el actor elegido.
  useEffect(() => {
    if (name) return;
    if (kind === "professional" && practitionerRoleId) { const role = roles.find((r) => r.id === practitionerRoleId); if (role) setName(practitionerName[role.practitionerId] ?? ""); }
    if (kind === "device" && deviceId) setName(devices.find((d) => d.id === deviceId)?.name ?? "");
    if (kind === "location" && locationId) setName(locations.find((l) => l.id === locationId)?.name ?? "");
    if (kind === "service" && healthcareServiceId) setName(services.find((s) => s.id === healthcareServiceId)?.name ?? "");
  }, [kind, practitionerRoleId, deviceId, locationId, healthcareServiceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (list: string[], value: string) => list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  function actorValid() {
    if (kind === "professional") return Boolean(practitionerRoleId);
    if (kind === "device") return Boolean(deviceId);
    if (kind === "location") return Boolean(locationId);
    if (kind === "service") return Boolean(healthcareServiceId);
    return memberIds.length >= 2; // composite: al menos dos recursos
  }

  async function finish() {
    setBusy(true); setError(""); setResult("");
    try {
      const id = await createResource({
        organizationId, locationId: locationId || null, healthcareServiceId: healthcareServiceId || null, kind, name: name.trim(),
        practitionerRoleId: kind === "professional" ? practitionerRoleId : null,
        deviceId: kind === "device" ? deviceId : null,
        memberIds: kind === "composite" ? memberIds : undefined,
        serviceTypeIds,
      });
      if (kind === "composite") { setResult("Recurso compuesto creado. Su disponibilidad se calcula por intersección de sus miembros."); onCreated?.(); return; }
      await replaceSchedule(id, blocks);
      const created = await generateSlots(id, range.from, range.to);
      setResult(`Recurso creado y ${created} cupos generados entre ${range.from} y ${range.to}.`);
      onCreated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No fue posible crear el recurso agendable.");
    } finally { setBusy(false); }
  }

  const canNext = [
    () => Boolean(organizationId),        // paso 1
    () => true,                            // paso 2
    () => actorValid() && Boolean(name.trim()), // paso 3
    () => true,                            // paso 4 (tipos de atención opcionales)
    () => kind === "composite" || blocks.length > 0, // paso 5
  ];
  const lastStep = kind === "composite" ? 4 : 6; // composite no configura plantilla ni genera cupos

  return (
    <section className="card" aria-label="Crear recurso agendable">
      <div className="card-heading"><h3>Crear recurso agendable</h3><span className="phase-state">Paso {step} de {lastStep}</span></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {result && <p className="notice" role="status">{result}</p>}

      {step === 1 && (
        <div className="clinical-form">
          {orgs.length > 1 && <label>Institución<select value={organizationId} onChange={(e) => { setOrganizationId(e.target.value); setLocationId(""); setHealthcareServiceId(""); }}>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
          <label>Sede<select value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={!organizationId}><option value="">(Sin sede específica)</option>{orgLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <label>Servicio<select value={healthcareServiceId} onChange={(e) => setHealthcareServiceId(e.target.value)} disabled={!organizationId}><option value="">(Sin servicio específico)</option>{orgServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <p className="empty-inline" style={{ margin: 0 }}>Elige dónde vive el recurso. Sede y servicio son opcionales.</p>
        </div>
      )}

      {step === 2 && (
        <div className="booking-tags"><span>Tipo de recurso agendable</span><div>{KINDS.map((k) => <button key={k} type="button" className={`tag ${kind === k ? "active" : ""}`} onClick={() => { setKind(k); setName(""); }}>{KIND_LABELS[k]}</button>)}</div></div>
      )}

      {step === 3 && (
        <div className="clinical-form">
          {kind === "professional" && <label>Rol profesional (PractitionerRole)<select value={practitionerRoleId} onChange={(e) => setPractitionerRoleId(e.target.value)}><option value="">Seleccionar…</option>{orgRoles.map((r) => <option key={r.id} value={r.id}>{practitionerName[r.practitionerId] ?? "—"}{r.specialty ? ` · ${r.specialty}` : ""}</option>)}</select></label>}
          {kind === "device" && <label>Equipo<select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}><option value="">Seleccionar…</option>{orgDevices.map((d) => <option key={d.id} value={d.id}>{d.name}{d.modality ? ` · ${d.modality}` : ""}</option>)}</select></label>}
          {kind === "location" && <label>Sala / box<select value={locationId} onChange={(e) => setLocationId(e.target.value)}><option value="">Seleccionar…</option>{orgLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>}
          {kind === "service" && <label>Servicio (por capacidad)<select value={healthcareServiceId} onChange={(e) => setHealthcareServiceId(e.target.value)}><option value="">Seleccionar…</option>{orgServices.map((s) => <option key={s.id} value={s.id}>{s.name} (cap. {s.capacity})</option>)}</select></label>}
          {kind === "composite" && (
            <div className="booking-tags"><span>Recursos que deben estar libres a la vez (mín. 2)</span><div>{composableMembers.map((r) => <button key={r.id} type="button" className={`tag ${memberIds.includes(r.id) ? "active" : ""}`} onClick={() => setMemberIds((m) => toggle(m, r.id))}>{r.name}</button>)}</div></div>
          )}
          <label>Nombre visible<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Dr. Pepito · Cardiología" /></label>
        </div>
      )}

      {step === 4 && (
        <div className="booking-tags"><span>Tipos de atención permitidos</span><div>{serviceTypes.filter((s) => s.active).map((s) => <button key={s.id} type="button" className={`tag ${serviceTypeIds.includes(s.id) ? "active" : ""}`} onClick={() => setServiceTypeIds((v) => toggle(v, s.id))}>{s.name} ({s.durationMin}′)</button>)}{!serviceTypes.length && <span className="inactive">Crea tipos de atención en Parametría.</span>}</div></div>
      )}

      {step === 5 && kind !== "composite" && (
        <div>
          <p>Plantilla horaria: un bloque por día (permite jornadas partidas). Los cupos se generan según la duración.</p>
          {blocks.map((b, i) => (
            <div className="clinical-form" key={i}>
              <label>Día<select value={b.weekday} onChange={(e) => setBlocks((bs) => bs.map((x, j) => j === i ? { ...x, weekday: Number(e.target.value) } : x))}>{WEEKDAYS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</select></label>
              <label>Abre<input type="time" value={b.startTime} onChange={(e) => setBlocks((bs) => bs.map((x, j) => j === i ? { ...x, startTime: e.target.value } : x))} /></label>
              <label>Cierra<input type="time" value={b.endTime} onChange={(e) => setBlocks((bs) => bs.map((x, j) => j === i ? { ...x, endTime: e.target.value } : x))} /></label>
              <label>Duración cupo (min)<input type="number" min={5} value={b.slotDurationMin} onChange={(e) => setBlocks((bs) => bs.map((x, j) => j === i ? { ...x, slotDurationMin: Number(e.target.value) } : x))} /></label>
              <label>Capacidad<input type="number" min={1} value={b.slotCapacity} onChange={(e) => setBlocks((bs) => bs.map((x, j) => j === i ? { ...x, slotCapacity: Number(e.target.value) } : x))} /></label>
              <button className="text-button" type="button" onClick={() => setBlocks((bs) => bs.filter((_, j) => j !== i))}>Quitar</button>
            </div>
          ))}
          <button className="button secondary" type="button" onClick={() => setBlocks((bs) => [...bs, { weekday: 1, startTime: "08:00", endTime: "18:00", slotDurationMin: 30, slotCapacity: 1, validFrom: today(), validTo: null }])}>Agregar bloque</button>
        </div>
      )}

      {step === 6 && kind !== "composite" && (
        <div className="clinical-form">
          <p>Generar cupos desde la plantilla en el rango:</p>
          <label>Desde<input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
          <label>Hasta<input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
        </div>
      )}

      <div className="wizard-nav" style={{ display: "flex", gap: 8, marginTop: 16 }}>
        {step > 1 && <button className="button secondary" type="button" onClick={() => setStep((s) => s - 1)} disabled={busy}>Atrás</button>}
        {step < lastStep && <button className="button primary" type="button" onClick={() => setStep((s) => s + 1)} disabled={busy || !(canNext[step - 1]?.() ?? true)}>Siguiente</button>}
        {step === lastStep && <button className="button primary" type="button" onClick={finish} disabled={busy || !name.trim()}>{busy ? "Creando…" : "Crear recurso"}</button>}
      </div>
    </section>
  );
}
