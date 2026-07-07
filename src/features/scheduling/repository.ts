import { supabase } from "@/lib/supabase-client";
import { addMinutes, commonStarts } from "./slot-math";

// Nombres internos cercanos a FHIR; la UI usa etiquetas amigables (ver labels.ts).
export type Organization = { id: string; name: string; active: boolean };
export type Location = { id: string; organizationId: string; name: string; address: string; active: boolean };
export type HealthcareService = { id: string; organizationId: string; name: string; specialty: string; capacity: number; active: boolean };
export type Practitioner = { id: string; fullName: string; professionalRegistration: string; active: boolean };
export type PractitionerRole = { id: string; practitionerId: string; organizationId: string; locationId: string | null; healthcareServiceId: string | null; specialty: string; active: boolean };
export type Device = { id: string; organizationId: string; locationId: string | null; name: string; modality: string; active: boolean };
export type ServiceType = { id: string; code: string; name: string; durationMin: number; capacity: number; requiresContrast: boolean; requiresAnesthesia: boolean; prepInstructions: string; active: boolean };

export type ResourceKind = "professional" | "device" | "location" | "service" | "composite";
// Etiquetas amigables para la UI (los nombres internos siguen a FHIR).
export const KIND_LABELS: Record<ResourceKind, string> = {
  professional: "Profesional (agenda médica)",
  device: "Equipo (ej. resonador, scanner)",
  location: "Sala / box",
  service: "Servicio (por capacidad)",
  composite: "Compuesto (varios recursos a la vez)",
};
export type SchedulableResource = {
  id: string; organizationId: string; locationId: string | null; healthcareServiceId: string | null;
  kind: ResourceKind; name: string; practitionerRoleId: string | null; deviceId: string | null; active: boolean;
};
export type Schedule = { id: string; resourceId: string; weekday: number; startTime: string; endTime: string; slotDurationMin: number; slotCapacity: number; validFrom: string; validTo: string | null };
export type Slot = { id: string; resourceId: string; startsAt: string; endsAt: string; capacity: number; bookedCount: number; status: "free" | "busy" | "held" };

// --- Lecturas simples (todas quedan filtradas por tenant vía RLS) ---
const rows = async <T>(table: string, cols: string, map: (r: Record<string, unknown>) => T, order = "name") => {
  const { data, error } = await supabase.from(table).select(cols).order(order);
  if (error) throw error;
  return (data as unknown as Record<string, unknown>[]).map(map);
};

export const fetchOrganizations = () => rows<Organization>("organizations", "id, name, active", (r) => r as Organization);
export const fetchLocations = () => rows<Location>("locations", "id, organization_id, name, address, active", (r) => ({ id: r.id, organizationId: r.organization_id, name: r.name, address: r.address, active: r.active } as Location));
export const fetchServices = () => rows<HealthcareService>("healthcare_services", "id, organization_id, name, specialty, capacity, active", (r) => ({ id: r.id, organizationId: r.organization_id, name: r.name, specialty: r.specialty, capacity: r.capacity, active: r.active } as HealthcareService));
export const fetchPractitioners = () => rows<Practitioner>("practitioners", "id, full_name, professional_registration, active", (r) => ({ id: r.id, fullName: r.full_name, professionalRegistration: r.professional_registration, active: r.active } as Practitioner), "full_name");
export const fetchPractitionerRoles = () => rows<PractitionerRole>("practitioner_roles", "id, practitioner_id, organization_id, location_id, healthcare_service_id, specialty, active", (r) => ({ id: r.id, practitionerId: r.practitioner_id, organizationId: r.organization_id, locationId: r.location_id, healthcareServiceId: r.healthcare_service_id, specialty: r.specialty, active: r.active } as PractitionerRole), "created_at");
export const fetchDevices = () => rows<Device>("devices", "id, organization_id, location_id, name, modality, active", (r) => ({ id: r.id, organizationId: r.organization_id, locationId: r.location_id, name: r.name, modality: r.modality, active: r.active } as Device));
export const fetchServiceTypes = () => rows<ServiceType>("service_types", "id, code, name, duration_min, capacity, requires_contrast, requires_anesthesia, prep_instructions, active", (r) => ({ id: r.id, code: r.code, name: r.name, durationMin: r.duration_min, capacity: r.capacity, requiresContrast: r.requires_contrast, requiresAnesthesia: r.requires_anesthesia, prepInstructions: r.prep_instructions, active: r.active } as ServiceType));
export const fetchResources = () => rows<SchedulableResource>("schedulable_resources", "id, organization_id, location_id, healthcare_service_id, kind, name, practitioner_role_id, device_id, active", (r) => ({ id: r.id, organizationId: r.organization_id, locationId: r.location_id, healthcareServiceId: r.healthcare_service_id, kind: r.kind, name: r.name, practitionerRoleId: r.practitioner_role_id, deviceId: r.device_id, active: r.active } as SchedulableResource));

// --- Altas de parametría (admin) ---
const insert1 = async (table: string, row: Record<string, unknown>) => {
  const { data, error } = await supabase.from(table).insert(row).select("id").single();
  if (error) throw error;
  return (data as { id: string }).id;
};
export const createOrganization = (name: string) => insert1("organizations", { name });
export const createLocation = (organizationId: string, name: string, address = "") => insert1("locations", { organization_id: organizationId, name, address });
export const createService = (organizationId: string, name: string, specialty = "", capacity = 1) => insert1("healthcare_services", { organization_id: organizationId, name, specialty, capacity });
export const createPractitioner = (fullName: string, professionalRegistration = "") => insert1("practitioners", { full_name: fullName, professional_registration: professionalRegistration });
export const createPractitionerRole = (r: { practitionerId: string; organizationId: string; locationId?: string | null; healthcareServiceId?: string | null; specialty?: string }) =>
  insert1("practitioner_roles", { practitioner_id: r.practitionerId, organization_id: r.organizationId, location_id: r.locationId ?? null, healthcare_service_id: r.healthcareServiceId ?? null, specialty: r.specialty ?? "" });
export const createDevice = (r: { organizationId: string; locationId?: string | null; name: string; modality?: string }) =>
  insert1("devices", { organization_id: r.organizationId, location_id: r.locationId ?? null, name: r.name, modality: r.modality ?? "" });
export const createServiceType = (r: Omit<ServiceType, "id" | "active">) =>
  insert1("service_types", { code: r.code, name: r.name, duration_min: r.durationMin, capacity: r.capacity, requires_contrast: r.requiresContrast, requires_anesthesia: r.requiresAnesthesia, prep_instructions: r.prepInstructions });

// --- Recurso agendable: crea el recurso + componentes (composite) + tipos de atención permitidos ---
export async function createResource(input: {
  organizationId: string; locationId?: string | null; healthcareServiceId?: string | null; kind: ResourceKind; name: string;
  practitionerRoleId?: string | null; deviceId?: string | null; memberIds?: string[]; serviceTypeIds?: string[];
}) {
  const id = await insert1("schedulable_resources", {
    organization_id: input.organizationId, location_id: input.locationId ?? null, healthcare_service_id: input.healthcareServiceId ?? null,
    kind: input.kind, name: input.name, practitioner_role_id: input.practitionerRoleId ?? null, device_id: input.deviceId ?? null,
  });
  if (input.kind === "composite" && input.memberIds?.length) {
    const { error } = await supabase.from("schedulable_resource_components").insert(input.memberIds.map((memberId) => ({ composite_id: id, member_id: memberId })));
    if (error) throw error;
  }
  if (input.serviceTypeIds?.length) {
    const { error } = await supabase.from("resource_service_types").insert(input.serviceTypeIds.map((serviceTypeId) => ({ resource_id: id, service_type_id: serviceTypeId })));
    if (error) throw error;
  }
  return id;
}

// --- Edición y borrado de parametría (institución se gestiona aparte, solo superadmin) ---
type EntityTable = "locations" | "healthcare_services" | "practitioners" | "practitioner_roles" | "devices" | "service_types" | "schedulable_resources";
export async function deleteEntity(table: EntityTable, id: string) {
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw error;
}
const patch = async (table: EntityTable, id: string, row: Record<string, unknown>) => {
  const { error } = await supabase.from(table).update(row).eq("id", id);
  if (error) throw error;
};
export const updateLocation = (id: string, p: { name: string; address: string; active: boolean }) => patch("locations", id, p);
export const updateService = (id: string, p: { name: string; specialty: string; capacity: number; active: boolean }) => patch("healthcare_services", id, p);
export const updatePractitioner = (id: string, p: { fullName: string; professionalRegistration: string; active: boolean }) => patch("practitioners", id, { full_name: p.fullName, professional_registration: p.professionalRegistration, active: p.active });
export const updateRole = (id: string, p: { specialty: string; locationId: string | null; healthcareServiceId: string | null; active: boolean }) => patch("practitioner_roles", id, { specialty: p.specialty, location_id: p.locationId, healthcare_service_id: p.healthcareServiceId, active: p.active });
export const updateDevice = (id: string, p: { name: string; modality: string; locationId: string | null; active: boolean }) => patch("devices", id, { name: p.name, modality: p.modality, location_id: p.locationId, active: p.active });
export const updateServiceType = (id: string, p: Omit<ServiceType, "id">) => patch("service_types", id, { code: p.code, name: p.name, duration_min: p.durationMin, capacity: p.capacity, requires_contrast: p.requiresContrast, requires_anesthesia: p.requiresAnesthesia, prep_instructions: p.prepInstructions, active: p.active });

export const fetchResourceComponents = async (compositeId: string) => {
  const { data, error } = await supabase.from("schedulable_resource_components").select("member_id").eq("composite_id", compositeId);
  if (error) throw error;
  return (data as { member_id: string }[]).map((r) => r.member_id);
};

export const fetchResourceServiceTypeIds = async (serviceTypeId: string) => {
  const { data, error } = await supabase.from("resource_service_types").select("resource_id").eq("service_type_id", serviceTypeId);
  if (error) throw error;
  return (data as { resource_id: string }[]).map((r) => r.resource_id);
};

// --- Plantilla horaria y generación de cupos ---
export async function replaceSchedule(resourceId: string, blocks: Omit<Schedule, "id" | "resourceId">[]) {
  await supabase.from("schedules").delete().eq("resource_id", resourceId);
  if (!blocks.length) return;
  const { error } = await supabase.from("schedules").insert(blocks.map((b) => ({
    resource_id: resourceId, weekday: b.weekday, start_time: b.startTime, end_time: b.endTime,
    slot_duration_min: b.slotDurationMin, slot_capacity: b.slotCapacity, valid_from: b.validFrom, valid_to: b.validTo,
  })));
  if (error) throw error;
}

export async function generateSlots(resourceId: string, from: string, to: string) {
  const { data, error } = await supabase.rpc("generate_slots", { p_resource: resourceId, p_from: from, p_to: to });
  if (error) throw error;
  return data as number; // cupos creados
}

// --- Disponibilidad para el calendario ---
async function freeSlots(resourceId: string, from: string, to: string) {
  const { data, error } = await supabase.from("slots").select("id, resource_id, starts_at, ends_at, capacity, booked_count, status")
    .eq("resource_id", resourceId).eq("status", "free").gte("starts_at", from).lte("starts_at", to).order("starts_at");
  if (error) throw error;
  return (data as Record<string, unknown>[]).map((r) => ({ id: r.id, resourceId: r.resource_id, startsAt: r.starts_at, endsAt: r.ends_at, capacity: r.capacity, bookedCount: r.booked_count, status: r.status } as Slot))
    .filter((s) => s.bookedCount < s.capacity);
}

/** Cupos disponibles de un recurso. Composite → intersección (por hora de inicio) de sus miembros.
 *  ponytail: la intersección asume que los miembros comparten grilla de inicio; si mezclas duraciones
 *  distintas entre miembros habría que solapar por rango, no por igualdad de starts_at. */
export async function availableSlots(resource: SchedulableResource, from: string, to: string): Promise<Slot[]> {
  if (resource.kind !== "composite") return freeSlots(resource.id, from, to);
  const memberIds = await fetchResourceComponents(resource.id);
  if (!memberIds.length) return [];
  const perMember = await Promise.all(memberIds.map((id) => freeSlots(id, from, to)));
  const common = commonStarts(perMember.map((slots) => slots.map((s) => s.startsAt)));
  return perMember[0].filter((slot) => common.has(slot.startsAt));
}

export async function searchPatients(term: string) {
  const q = supabase.from("patients").select("id, full_name, identifier").order("full_name").limit(20);
  const { data, error } = term.trim() ? await q.ilike("full_name", `%${term.trim()}%`) : await q;
  if (error) throw error;
  return (data as { id: string; full_name: string; identifier: string }[]);
}

/** Marca cupos como reservados (incrementa booked_count; a 'busy' si se llena). */
async function occupy(slotIds: string[]) {
  for (const id of slotIds) {
    const { data, error } = await supabase.from("slots").select("capacity, booked_count").eq("id", id).single();
    if (error) throw error;
    const next = (data as { capacity: number; booked_count: number }).booked_count + 1;
    const status = next >= (data as { capacity: number }).capacity ? "busy" : "free";
    const { error: upd } = await supabase.from("slots").update({ booked_count: next, status }).eq("id", id);
    if (upd) throw upd;
  }
}

/** Reserva una cita validando disponibilidad del recurso (o de TODOS los componentes si es composite). */
export async function bookAppointment(input: {
  patientId: string; resource: SchedulableResource; startsAt: string; serviceType: ServiceType;
  practitionerName: string; locationName: string; modality: string; reason: string;
}) {
  const date = input.startsAt.slice(0, 10);
  const startTime = input.startsAt.slice(11, 16);
  const endTime = addMinutes(startTime, input.serviceType.durationMin);

  // Resuelve los cupos a ocupar y revalida disponibilidad justo antes de reservar (evita choques).
  let slotId: string | null = null;
  let toOccupy: string[] = [];
  if (input.resource.kind === "composite") {
    const memberIds = await fetchResourceComponents(input.resource.id);
    const perMember = await Promise.all(memberIds.map((id) => freeSlots(id, input.startsAt, input.startsAt)));
    if (perMember.some((slots) => !slots.some((s) => s.startsAt === input.startsAt))) {
      throw new Error("Ya no hay disponibilidad simultánea de todos los recursos en ese horario.");
    }
    toOccupy = perMember.map((slots) => slots.find((s) => s.startsAt === input.startsAt)!.id);
  } else {
    const free = await freeSlots(input.resource.id, input.startsAt, input.startsAt);
    const slot = free.find((s) => s.startsAt === input.startsAt);
    if (!slot) throw new Error("El cupo ya no está disponible.");
    slotId = slot.id;
    toOccupy = [slot.id];
  }

  const { data, error } = await supabase.from("appointments").insert({
    patient_id: input.patientId, appointment_date: date, start_time: startTime, end_time: endTime,
    practitioner_name: input.practitionerName, location_name: input.locationName, modality: input.modality,
    reason: input.reason, status: "scheduled",
    schedulable_resource_id: input.resource.id, slot_id: slotId, service_type_id: input.serviceType.id,
  }).select("id").single();
  if (error) throw error;
  await occupy(toOccupy);
  return (data as { id: string }).id;
}
