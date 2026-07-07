"use client";

import { useEffect, useMemo, useState } from "react";
import {
  availableSlots, bookAppointment, fetchDevices, fetchLocations, fetchPractitioners, fetchPractitionerRoles,
  fetchResources, fetchResourceServiceTypeIds, fetchServices, fetchServiceTypes, searchPatients,
  type Device, type Location, type Practitioner, type PractitionerRole, type SchedulableResource,
  type ServiceType, type Slot,
} from "./repository";

const todayStr = () => new Date().toISOString().slice(0, 10);

export function BookingCalendar() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [services, setServices] = useState<{ id: string; organizationId: string; name: string }[]>([]);
  const [resources, setResources] = useState<SchedulableResource[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [roles, setRoles] = useState<PractitionerRole[]>([]);
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);

  const [locId, setLocId] = useState("");
  const [svcId, setSvcId] = useState("");
  const [serviceTypeId, setServiceTypeId] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [compatibleIds, setCompatibleIds] = useState<string[] | null>(null);
  const [date, setDate] = useState(todayStr());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [term, setTerm] = useState("");
  const [patients, setPatients] = useState<{ id: string; full_name: string; identifier: string }[]>([]);
  const [patientId, setPatientId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([fetchLocations(), fetchServices(), fetchResources(), fetchServiceTypes(), fetchPractitionerRoles(), fetchPractitioners(), fetchDevices()])
      .then(([l, s, r, st, ro, p, d]) => { setLocations(l); setServices(s); setResources(r); setServiceTypes(st); setRoles(ro); setPractitioners(p); setDevices(d); })
      .catch(() => setError("No fue posible cargar la agenda."));
  }, []);

  // Al elegir tipo de atención, restringe a los recursos compatibles.
  useEffect(() => {
    if (!serviceTypeId) { setCompatibleIds(null); return; }
    fetchResourceServiceTypeIds(serviceTypeId).then(setCompatibleIds).catch(() => setCompatibleIds([]));
  }, [serviceTypeId]);

  const practName = useMemo(() => Object.fromEntries(practitioners.map((p) => [p.id, p.fullName])), [practitioners]);
  const locName = useMemo(() => Object.fromEntries(locations.map((l) => [l.id, l.name])), [locations]);

  const filtered = resources.filter((r) => r.active
    && (!locId || r.locationId === locId)
    && (!svcId || r.healthcareServiceId === svcId)
    && (!compatibleIds || compatibleIds.includes(r.id)));
  const resource = resources.find((r) => r.id === resourceId) ?? null;
  const serviceType = serviceTypes.find((s) => s.id === serviceTypeId) ?? null;

  // Metadatos derivados para las columnas sombra de la cita.
  function derive(r: SchedulableResource) {
    if (r.kind === "professional") { const role = roles.find((x) => x.id === r.practitionerRoleId); return { practitionerName: role ? practName[role.practitionerId] ?? r.name : r.name, locationName: r.locationId ? locName[r.locationId] ?? "" : "", modality: "OT" }; }
    if (r.kind === "device") { const dev = devices.find((x) => x.id === r.deviceId); return { practitionerName: "", locationName: dev?.name ?? r.name, modality: dev?.modality || "OT" }; }
    if (r.kind === "location") return { practitionerName: "", locationName: r.locationId ? locName[r.locationId] ?? r.name : r.name, modality: "OT" };
    return { practitionerName: "", locationName: r.name, modality: "OT" }; // service / composite
  }

  async function loadSlots() {
    setError(""); setSlots([]);
    if (!resource) return;
    try {
      setSlots(await availableSlots(resource, `${date}T00:00:00+00:00`, `${date}T23:59:59+00:00`));
    } catch { setError("No fue posible cargar los cupos."); }
  }
  useEffect(() => { loadSlots(); }, [resourceId, date]); // eslint-disable-line react-hooks/exhaustive-deps

  async function book(slot: Slot) {
    if (!resource || !serviceType || !patientId) { setError("Elige tipo de atención, paciente y cupo."); return; }
    setError(""); setNotice("");
    try {
      const meta = derive(resource);
      await bookAppointment({ patientId, resource, startsAt: slot.startsAt, serviceType, ...meta, reason: serviceType.name });
      setNotice(`Cita reservada: ${slot.startsAt.slice(11, 16)} · ${resource.name}.`);
      loadSlots();
    } catch (e) { setError(e instanceof Error ? e.message : "No fue posible reservar."); }
  }

  return (
    <section className="card" aria-label="Agendar cita">
      <div className="card-heading"><h3>Agendar cita</h3></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      <div className="clinical-form">
        <label>Sede<select value={locId} onChange={(e) => { setLocId(e.target.value); setResourceId(""); }}><option value="">Todas</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label>Servicio<select value={svcId} onChange={(e) => { setSvcId(e.target.value); setResourceId(""); }}><option value="">Todos</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Tipo de atención<select value={serviceTypeId} onChange={(e) => { setServiceTypeId(e.target.value); setResourceId(""); }}><option value="">Todos</option>{serviceTypes.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Recurso agendable<select value={resourceId} onChange={(e) => setResourceId(e.target.value)}><option value="">Seleccionar…</option>{filtered.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        <label>Fecha<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>

      <div className="clinical-form" style={{ marginTop: 12 }}>
        <label>Paciente<input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Buscar por nombre…" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); searchPatients(term).then(setPatients).catch(() => setPatients([])); } }} /></label>
        <button className="button secondary" type="button" onClick={() => searchPatients(term).then(setPatients).catch(() => setPatients([]))}>Buscar</button>
        {patients.length > 0 && <label>Seleccionar<select value={patientId} onChange={(e) => setPatientId(e.target.value)}><option value="">…</option>{patients.map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.identifier ? ` · ${p.identifier}` : ""}</option>)}</select></label>}
      </div>

      {resource && (
        <div className="booking-tags" style={{ marginTop: 12 }}>
          <span>Cupos disponibles {resource.kind === "composite" ? "(intersección de componentes)" : ""}</span>
          <div>
            {slots.map((s) => <button key={s.id} type="button" className="tag" onClick={() => book(s)} disabled={!patientId || !serviceTypeId}>{s.startsAt.slice(11, 16)}</button>)}
            {!slots.length && <span className="inactive">Sin cupos ese día. Genera cupos en el recurso o revisa la plantilla.</span>}
          </div>
        </div>
      )}
    </section>
  );
}
