"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  countTestServiceTypes, createMasterServiceType, deleteLocationResource, fetchAssignedServiceTypeIds, fetchBranches,
  fetchBranchServices, fetchLocations, fetchResources, fetchServices, saveLocationResource, searchMasterServiceTypes,
  setBranchService, setResourceServiceType, type HealthcareService, type Location, type SchedulableResource, type ServiceType,
} from "./repository";

type ResourceDraft = { id: string | null; name: string; branchId: string; serviceId: string; active: boolean };

export function OfferingManager() {
  const [branches, setBranches] = useState<Location[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [resources, setResources] = useState<SchedulableResource[]>([]);
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  const [allServices, setAllServices] = useState<HealthcareService[]>([]);
  const [types, setTypes] = useState<ServiceType[]>([]);
  const [assigned, setAssigned] = useState<string[]>([]);
  const [branchId, setBranchId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [term, setTerm] = useState("");
  const [draft, setDraft] = useState<ResourceDraft | null>(null);
  const [pendingDelete, setPendingDelete] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [testCount, setTestCount] = useState(0);

  async function reloadResources() {
    const [nextLocations, nextResources] = await Promise.all([fetchLocations(), fetchResources()]);
    setLocations(nextLocations); setResources(nextResources);
  }

  useEffect(() => {
    Promise.all([fetchBranches(), fetchLocations(), fetchResources(), fetchServices(), countTestServiceTypes()])
      .then(([b, l, r, s, count]) => { setBranches(b); setBranchId(b[0]?.id ?? ""); setLocations(l); setResources(r); setAllServices(s); setTestCount(count); })
      .catch(() => setError("No fue posible cargar la oferta de prestaciones."));
  }, []);

  useEffect(() => {
    if (!branchId) return;
    fetchBranchServices(branchId).then((items) => { setServices(items); setServiceId((current) => items.some((item) => item.id === current) ? current : items[0]?.id ?? ""); }).catch(() => setServices([]));
    setResourceId("");
  }, [branchId]);

  const resourcesInBranch = useMemo(() => resources.filter((resource) => {
    const location = locations.find((item) => item.id === resource.locationId);
    return (location?.kind === "room" ? location.parentId : location?.id) === branchId;
  }), [resources, locations, branchId]);
  const branchResources = resourcesInBranch.filter((resource) => resource.active && resource.healthcareServiceId === serviceId);

  useEffect(() => { setResourceId((current) => branchResources.some((item) => item.id === current) ? current : branchResources[0]?.id ?? ""); }, [serviceId, branchId, branchResources.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!serviceId || term.trim().length === 1) { setTypes([]); return; }
    searchMasterServiceTypes(serviceId, term).then(setTypes).catch(() => setTypes([]));
  }, [serviceId, term]);
  useEffect(() => {
    if (!resourceId) { setAssigned([]); return; }
    fetchAssignedServiceTypeIds(resourceId).then(setAssigned).catch(() => setAssigned([]));
  }, [resourceId]);

  async function saveResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!draft) return;
    setError(""); setMessage("");
    try {
      const id = await saveLocationResource(draft);
      await reloadResources(); setBranchId(draft.branchId); setServiceId(draft.serviceId); setResourceId(id); setDraft(null);
      setMessage("Recurso guardado correctamente.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible guardar el recurso."); }
  }

  async function removeResource(resource: SchedulableResource) {
    setError(""); setMessage("");
    try { await deleteLocationResource(resource.id); await reloadResources(); setPendingDelete(""); setMessage("Recurso eliminado."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible eliminar el recurso."); }
  }

  async function toggleResource(resource: SchedulableResource) {
    const location = locations.find((item) => item.id === resource.locationId);
    const currentBranch = location?.kind === "room" ? location.parentId : location?.id;
    if (!currentBranch || !resource.healthcareServiceId) return;
    try { await saveLocationResource({ id: resource.id, branchId: currentBranch, serviceId: resource.healthcareServiceId, name: resource.name, active: !resource.active }); await reloadResources(); }
    catch { setError("No fue posible cambiar el estado del recurso."); }
  }

  async function toggle(typeId: string, enabled: boolean) {
    setError("");
    try { await setResourceServiceType(resourceId, typeId, enabled); setAssigned((current) => enabled ? [...current, typeId] : current.filter((id) => id !== typeId)); }
    catch { setError("No fue posible actualizar la prestación del recurso."); }
  }

  async function toggleBranchService(id: string, enabled: boolean) {
    try { await setBranchService(branchId, id, enabled); setServices(await fetchBranchServices(branchId)); }
    catch { setError("No fue posible actualizar los servicios de la sucursal."); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); setError("");
    try {
      const id = await createMasterServiceType(serviceId, String(values.get("code")).trim(), String(values.get("name")).trim(), Number(values.get("duration")) || 30);
      if (resourceId) await setResourceServiceType(resourceId, id, true);
      form.reset(); setTerm(""); setTypes(await searchMasterServiceTypes(serviceId));
      if (resourceId) setAssigned(await fetchAssignedServiceTypeIds(resourceId));
    } catch { setError("No fue posible crear la prestación. Revisa que el nombre no esté repetido."); }
  }

  const branchName = branches.find((branch) => branch.id === branchId)?.name;
  return <section className="card" aria-label="Oferta de prestaciones">
    <div className="card-heading"><div><h3>Recursos y prestaciones</h3><p>Configura qué ofrece cada sucursal sin cargar las 600 prestaciones en la agenda.</p></div><span className="phase-state">{testCount} prestaciones de prueba</span></div>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}
    <label className="offering-branch">Sucursal<select value={branchId} onChange={(event) => setBranchId(event.target.value)}>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>

    <div className="resource-section-heading"><div><h4>Salas, equipos y agendas de {branchName}</h4><p>Crea el recurso y asígnalo a un servicio.</p></div><button className="button primary" type="button" disabled={!services.length} onClick={() => setDraft({ id: null, name: "", branchId, serviceId: services[0]?.id ?? "", active: true })}>+ Nuevo recurso</button></div>
    {draft && <form className="clinical-form resource-editor" onSubmit={saveResource}>
      <label>Nombre<input autoFocus required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ej: Resonador 1, Box 3" /></label>
      <label>Sucursal<select value={draft.branchId} onChange={(event) => setDraft({ ...draft, branchId: event.target.value })}>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <label>Servicio<select required value={draft.serviceId} onChange={(event) => setDraft({ ...draft, serviceId: event.target.value })}>{allServices.filter((service) => services.some((item) => item.id === service.id)).map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
      <label className="checkbox-label"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />Activo</label>
      <div className="form-actions"><button className="button primary" type="submit">Guardar recurso</button><button className="button secondary" type="button" onClick={() => setDraft(null)}>Cancelar</button></div>
    </form>}
    <div className="resource-grid">{resourcesInBranch.map((resource) => {
      const resourceService = allServices.find((service) => service.id === resource.healthcareServiceId)?.name ?? "Sin servicio";
      return <article className={`resource-card ${resource.active ? "" : "inactive"}`} key={resource.id}><div><strong>{resource.name}</strong><small>{resourceService} · {resource.active ? "Activo" : "Inactivo"}</small></div><div><button className="text-button" type="button" onClick={() => { setServiceId(resource.healthcareServiceId ?? serviceId); setResourceId(resource.id); }}>Prestaciones</button><button className="text-button" type="button" onClick={() => setDraft({ id: resource.id, name: resource.name, branchId, serviceId: resource.healthcareServiceId ?? serviceId, active: resource.active })}>Editar</button><button className="text-button" type="button" onClick={() => toggleResource(resource)}>{resource.active ? "Desactivar" : "Activar"}</button>{pendingDelete === resource.id ? <><span className="delete-question">¿Eliminar?</span><button className="text-button danger" type="button" onClick={() => removeResource(resource)}>Sí, eliminar</button><button className="text-button" type="button" onClick={() => setPendingDelete("")}>Cancelar</button></> : <button className="text-button danger" type="button" onClick={() => setPendingDelete(resource.id)}>Eliminar</button>}</div></article>;
    })}{!resourcesInBranch.length && <p className="empty-state">Esta sucursal todavía no tiene recursos.</p>}</div>

    <details className="booking-advanced offering-admin"><summary>Servicios habilitados en la sucursal</summary><div className="service-checks">{allServices.filter((service) => service.organizationId === branches.find((branch) => branch.id === branchId)?.organizationId).map((service) => <label key={service.id}><input type="checkbox" checked={services.some((item) => item.id === service.id)} onChange={(event) => toggleBranchService(service.id, event.target.checked)} />{service.name}</label>)}</div></details>

    <div className="offering-context clinical-form"><label>Servicio<select value={serviceId} onChange={(event) => setServiceId(event.target.value)}>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label><label>Recurso<select value={resourceId} onChange={(event) => setResourceId(event.target.value)}><option value="">Seleccionar…</option>{branchResources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select></label></div>
    <div className="offering-search"><label>Buscar en el catálogo maestro<input type="search" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Código o nombre de prestación" /></label><span>{assigned.length} prestaciones activas</span></div>
    <ul className="offering-list">{types.map((type) => <li key={type.id}><label><input type="checkbox" checked={assigned.includes(type.id)} disabled={!resourceId} onChange={(event) => toggle(type.id, event.target.checked)} /><span><strong>{type.name}</strong><small>{type.code || "Sin código"} · {type.durationMin} min</small></span></label></li>)}{!types.length && <li className="inactive"><span>{resourceId ? "Escribe dos caracteres para buscar." : "Selecciona un recurso para asignarle prestaciones."}</span></li>}</ul>
    <details className="booking-advanced offering-create"><summary>Agregar prestación al catálogo maestro</summary><form className="catalog-form" onSubmit={create}><label>Código<input name="code" placeholder="Ej: 04.04.001" /></label><label>Nombre<input name="name" required /></label><label>Duración (min)<input name="duration" type="number" min={5} step={5} defaultValue={30} /></label><button className="button primary" type="submit" disabled={!serviceId}>Agregar</button></form></details>
  </section>;
}
