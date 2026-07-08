"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { CODE_SYSTEMS, codeHref, codingError } from "@/features/clinical/coding";
import {
  countTestServiceTypes, createMasterServiceType, deleteLocationResource, fetchAssignedServiceTypeIds, fetchBranches,
  fetchBranchServices, fetchLocations, fetchResources, fetchServices, saveLocationResource, searchMasterServiceTypes,
  setBranchService, setResourceServiceType, updateMasterServiceType, type HealthcareService, type Location,
  type PractitionerRequirement, type SchedulableResource, type ServiceCategory, type ServiceType,
} from "./repository";
import { DICOM_MODALITIES } from "./modalities";

type ResourceDraft = { id: string | null; name: string; branchId: string; serviceId: string; active: boolean };
const categoryLabels: Record<ServiceCategory, string> = { consultation: "Consulta", imaging: "Imagenología", laboratory: "Laboratorio", pathology: "Anatomía patológica", procedure: "Procedimiento" };
const practitionerLabels: Record<PractitionerRequirement, string> = { none: "No requiere profesional", optional: "Profesional opcional", required: "Profesional obligatorio" };
const errorMessage = (caught: unknown, fallback: string) => {
  const message = caught instanceof Error ? caught.message
    : caught && typeof caught === "object" && "message" in caught ? String(caught.message) : "";
  return message ? `${fallback} Detalle: ${message}` : fallback;
};

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
  const [editingType, setEditingType] = useState<ServiceType | null>(null);
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
    catch (caught) { setError(errorMessage(caught, "No fue posible cambiar el estado del recurso.")); }
  }

  async function toggle(typeId: string, enabled: boolean) {
    setError("");
    try { await setResourceServiceType(resourceId, typeId, enabled); setAssigned((current) => enabled ? [...current, typeId] : current.filter((id) => id !== typeId)); }
    catch (caught) { setError(errorMessage(caught, "No fue posible actualizar la prestación del recurso.")); }
  }

  async function toggleBranchService(id: string, enabled: boolean) {
    try { await setBranchService(branchId, id, enabled); setServices(await fetchBranchServices(branchId)); }
    catch (caught) { setError(errorMessage(caught, "No fue posible actualizar los servicios de la sucursal.")); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); setError("");
    const standardSystem = String(values.get("standardSystem"));
    const standardCode = String(values.get("standardCode")).trim();
    const standardDisplay = String(values.get("standardDisplay")).trim();
    const validation = codingError(standardSystem, standardCode, standardDisplay, "Prestación");
    if (validation) return setError(validation);
    try {
      const id = await createMasterServiceType(serviceId, {
        code: String(values.get("code")).trim(),
        name: String(values.get("name")).trim(),
        durationMin: Number(values.get("duration")) || 30,
        category: values.get("category") as ServiceCategory,
        modality: String(values.get("modality")),
        practitionerRequirement: values.get("practitioner") as PractitionerRequirement,
        standardCodeSystem: standardSystem,
        standardCode,
        standardDisplay,
      });
      if (resourceId) await setResourceServiceType(resourceId, id, true);
      form.reset(); setTerm(""); setTypes(await searchMasterServiceTypes(serviceId));
      if (resourceId) setAssigned(await fetchAssignedServiceTypeIds(resourceId));
    } catch (caught) { setError(errorMessage(caught, "No fue posible crear la prestación.")); }
  }

  async function saveType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editingType) return;
    const validation = codingError(editingType.standardCodeSystem || "LOCAL", editingType.standardCode, editingType.standardDisplay, "Prestación");
    if (validation) return setError(validation);
    try { await updateMasterServiceType(editingType.id, editingType); setTypes((current) => current.map((item) => item.id === editingType.id ? editingType : item)); setEditingType(null); }
    catch (caught) { setError(errorMessage(caught, "No fue posible actualizar la prestación.")); }
  }

  const branchName = branches.find((branch) => branch.id === branchId)?.name;
  const codeLink = (type: ServiceType) => {
    if (!type.standardCode) return null;
    const label = `${type.standardCodeSystem || "LOCAL"}:${type.standardCode}`;
    const href = codeHref(type.standardCodeSystem || "LOCAL", type.standardCode);
    return href ? <a className="coding-link" href={href} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{label}</a> : label;
  };
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
      return <article className={`resource-card ${resource.active ? "" : "inactive"}`} key={resource.id}><div><strong>{resource.name}</strong><small>{resourceService} · {resource.active ? "Activo" : "Inactivo"}</small></div><div><button className="text-button" type="button" onClick={() => window.dispatchEvent(new CustomEvent("schedule-target", { detail: { kind: "resource", name: resource.name } }))}>Horario semanal</button><button className="text-button" type="button" onClick={() => { setServiceId(resource.healthcareServiceId ?? serviceId); setResourceId(resource.id); }}>Prestaciones</button><button className="text-button" type="button" onClick={() => setDraft({ id: resource.id, name: resource.name, branchId, serviceId: resource.healthcareServiceId ?? serviceId, active: resource.active })}>Editar</button><button className="text-button" type="button" onClick={() => toggleResource(resource)}>{resource.active ? "Desactivar" : "Activar"}</button>{pendingDelete === resource.id ? <><span className="delete-question">¿Eliminar?</span><button className="text-button danger" type="button" onClick={() => removeResource(resource)}>Sí, eliminar</button><button className="text-button" type="button" onClick={() => setPendingDelete("")}>Cancelar</button></> : <button className="text-button danger" type="button" onClick={() => setPendingDelete(resource.id)}>Eliminar</button>}</div></article>;
    })}{!resourcesInBranch.length && <p className="empty-state">Esta sucursal todavía no tiene recursos.</p>}</div>

    <details className="booking-advanced offering-admin"><summary>Servicios habilitados en la sucursal</summary><div className="service-checks">{allServices.filter((service) => service.organizationId === branches.find((branch) => branch.id === branchId)?.organizationId).map((service) => <label key={service.id}><input type="checkbox" checked={services.some((item) => item.id === service.id)} onChange={(event) => toggleBranchService(service.id, event.target.checked)} />{service.name}</label>)}</div></details>

    <div className="offering-context clinical-form">
      <label>Servicio<select value={serviceId} onChange={(event) => setServiceId(event.target.value)}>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
      <label>Recurso<select value={resourceId} onChange={(event) => setResourceId(event.target.value)}><option value="">Seleccionar…</option>{branchResources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select></label>
    </div>
    <div className="offering-search"><label>Buscar en el catálogo maestro<input type="search" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Código, nombre o código estándar" /></label><span>{assigned.length} prestaciones activas</span></div>
    <ul className="offering-list">
      {types.map((type) => <li key={type.id}>
        {editingType?.id === type.id ? <form className="catalog-form service-type-editor" onSubmit={saveType}>
          <label className="wide-field">Nombre<input value={editingType.name} onChange={(event) => setEditingType({ ...editingType, name: event.target.value })} required /></label>
          <label>Duración<input type="number" min={5} step={5} value={editingType.durationMin} onChange={(event) => setEditingType({ ...editingType, durationMin: Number(event.target.value) })} /></label>
          <label>Tipo<select value={editingType.category} onChange={(event) => setEditingType({ ...editingType, category: event.target.value as ServiceCategory })}>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Profesional<select value={editingType.practitionerRequirement} onChange={(event) => setEditingType({ ...editingType, practitionerRequirement: event.target.value as PractitionerRequirement })}>{Object.entries(practitionerLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {editingType.category === "imaging" && <label className="wide-field">Modalidad DICOM<select value={editingType.modality} onChange={(event) => setEditingType({ ...editingType, modality: event.target.value })}><option value="">Sin definir</option>{DICOM_MODALITIES.map(([value, label]) => <option key={value} value={value}>{value} · {label}</option>)}</select></label>}
          <label>Sistema estándar<select value={editingType.standardCodeSystem || "LOCAL"} onChange={(event) => setEditingType({ ...editingType, standardCodeSystem: event.target.value })}>{CODE_SYSTEMS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Código estándar<input value={editingType.standardCode} onChange={(event) => setEditingType({ ...editingType, standardCode: event.target.value })} placeholder="LOINC / SNOMED / CIE" /></label>
          <label className="wide-field">Nombre estándar<input value={editingType.standardDisplay} onChange={(event) => setEditingType({ ...editingType, standardDisplay: event.target.value })} placeholder="Nombre oficial si existe" /></label>
          <div className="form-actions"><button className="button primary" type="submit">Guardar cambios</button><button className="button secondary" type="button" onClick={() => setEditingType(null)}>Cancelar</button></div>
        </form> : <div className="offering-type-row">
          <label><input type="checkbox" checked={assigned.includes(type.id)} disabled={!resourceId} onChange={(event) => toggle(type.id, event.target.checked)} /><span><strong>{type.name}</strong><small>{categoryLabels[type.category]} · {type.durationMin} min{type.modality && ` · ${type.modality}`} · {practitionerLabels[type.practitionerRequirement]}{type.standardCode && <> · {codeLink(type)}</>}</small></span></label>
          <button className="text-button" type="button" onClick={() => setEditingType(type)}>Editar reglas</button>
        </div>}
      </li>)}
      {!types.length && <li className="inactive"><span>{resourceId ? "No hay prestaciones para esta búsqueda." : "Selecciona un recurso para asignarle prestaciones."}</span></li>}
    </ul>
    <details className="booking-advanced offering-create"><summary>Agregar prestación al catálogo maestro</summary><form className="catalog-form service-type-create" onSubmit={create}>
      <label>Código<input name="code" placeholder="Ej: 04.04.001" /></label>
      <label className="wide-field">Nombre<input name="name" required /></label>
      <label>Duración (min)<input name="duration" type="number" min={5} step={5} defaultValue={30} /></label>
      <label>Tipo<select name="category" defaultValue="procedure">{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Profesional<select name="practitioner" defaultValue="optional">{Object.entries(practitionerLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="wide-field">Modalidad DICOM (si aplica)<select name="modality" defaultValue=""><option value="">No aplica</option>{DICOM_MODALITIES.map(([value, label]) => <option key={value} value={value}>{value} · {label}</option>)}</select></label>
      <label>Sistema estándar<select name="standardSystem" defaultValue="LOCAL">{CODE_SYSTEMS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Código estándar<input name="standardCode" placeholder="LOINC / SNOMED / CIE si aplica" /></label>
      <label className="wide-field">Nombre estándar<input name="standardDisplay" placeholder="Nombre oficial si existe" /></label>
      <div className="form-actions"><button className="button primary" type="submit" disabled={!serviceId}>Agregar prestación</button></div>
    </form></details>
  </section>;
}
