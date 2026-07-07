-- Agenda inspirada en FHIR: recursos agendables genéricos (no toda agenda es por médico).
-- Jerarquía: Tenant → Organization → Location → HealthcareService → SchedulableResource
--            → Schedule (plantilla) → Slot (cupo materializado) → Appointment.
-- Nombres internos cercanos a FHIR; el frontend usa etiquetas amigables.
-- Convive como MODELO AUTORITATIVO nuevo: appointments referencia schedulable_resource + slot,
-- y conserva sus columnas de texto (practitioner_name/location_name/modality) como sombra derivada
-- para no romper informes/PACS/worklist que hoy las leen.

create type public.schedulable_resource_kind as enum ('professional', 'device', 'location', 'service', 'composite');
create type public.slot_status as enum ('free', 'busy', 'held');

-- === Entidades base (Organization / Location / HealthcareService) ===
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  address text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, organization_id, name)
);

create table public.healthcare_services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  specialty text not null default '',
  capacity integer not null default 1 check (capacity >= 1),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, organization_id, name)
);

-- === Personas y equipos (Practitioner / PractitionerRole / Device) ===
create table public.practitioners (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  -- Opcional: un profesional puede no tener login (no todo Practitioner es un usuario del sistema).
  profile_id uuid references public.profiles(id),
  full_name text not null,
  professional_registration text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, full_name)
);

-- PractitionerRole = profesional + organización + sede + servicio/especialidad.
create table public.practitioner_roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  practitioner_id uuid not null references public.practitioners(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  healthcare_service_id uuid references public.healthcare_services(id) on delete set null,
  specialty text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  name text not null,
  -- Modalidad DICOM cuando aplica (RM, CT…); vacío para equipos no imagenológicos.
  modality text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, organization_id, name)
);

-- === Tipos de atención / prestaciones (duración, capacidad, reglas) ===
create table public.service_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  code text not null default '',
  name text not null,
  duration_min integer not null default 30 check (duration_min > 0),
  capacity integer not null default 1 check (capacity >= 1),
  requires_contrast boolean not null default false,
  requires_anesthesia boolean not null default false,
  prep_instructions text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

-- === Recurso agendable genérico (professional/device/location/service/composite) ===
create table public.schedulable_resources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  healthcare_service_id uuid references public.healthcare_services(id) on delete set null,
  kind public.schedulable_resource_kind not null,
  name text not null,
  -- Actor concreto según kind; composite no usa ninguno (se resuelve por componentes).
  practitioner_role_id uuid references public.practitioner_roles(id) on delete cascade,
  device_id uuid references public.devices(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name),
  -- El actor debe corresponder al tipo declarado.
  constraint resource_actor_matches_kind check (
    (kind = 'professional' and practitioner_role_id is not null and device_id is null) or
    (kind = 'device'       and device_id is not null and practitioner_role_id is null) or
    (kind = 'location'     and location_id is not null and practitioner_role_id is null and device_id is null) or
    (kind = 'service'      and healthcare_service_id is not null and practitioner_role_id is null and device_id is null) or
    (kind = 'composite'    and practitioner_role_id is null and device_id is null)
  )
);

-- Composite: requiere que varios recursos (professional/device/location) estén libres a la vez.
-- ponytail: el composite NO materializa slots propios; su disponibilidad = intersección de los
-- slots libres de sus miembros, calculada al reservar. Sube a slots materializados solo si algún
-- día necesitas publicar cupos compuestos a un portal de pacientes.
create table public.schedulable_resource_components (
  composite_id uuid not null references public.schedulable_resources(id) on delete cascade,
  member_id uuid not null references public.schedulable_resources(id) on delete cascade,
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  primary key (composite_id, member_id),
  check (composite_id <> member_id)
);

-- Tipos de atención permitidos por recurso agendable.
create table public.resource_service_types (
  resource_id uuid not null references public.schedulable_resources(id) on delete cascade,
  service_type_id uuid not null references public.service_types(id) on delete cascade,
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  primary key (resource_id, service_type_id)
);

-- === Plantilla horaria (Schedule): una fila por bloque (permite jornadas partidas y horas por día) ===
create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  resource_id uuid not null references public.schedulable_resources(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7), -- 1 = lunes … 7 = domingo (ISO)
  start_time time not null,
  end_time time not null,
  slot_duration_min integer not null default 30 check (slot_duration_min > 0),
  slot_capacity integer not null default 1 check (slot_capacity >= 1),
  valid_from date not null default current_date,
  valid_to date,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index schedules_resource_idx on public.schedules (resource_id, weekday);

-- === Slot materializado (Cupo) ===
create table public.slots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  resource_id uuid not null references public.schedulable_resources(id) on delete cascade,
  schedule_id uuid references public.schedules(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null default 1 check (capacity >= 1),
  booked_count integer not null default 0 check (booked_count >= 0),
  status public.slot_status not null default 'free',
  created_at timestamptz not null default now(),
  unique (resource_id, starts_at),
  check (ends_at > starts_at)
);
create index slots_resource_time_idx on public.slots (resource_id, starts_at);

-- === Enlace de la cita al modelo nuevo (columnas de texto quedan como sombra derivada) ===
alter table public.appointments
  add column schedulable_resource_id uuid references public.schedulable_resources(id),
  add column slot_id uuid references public.slots(id),
  add column service_type_id uuid references public.service_types(id);

-- La agenda deja de ser solo imagenológica: 'OT' (otro) cubre consultas, endoscopía, etc.
alter table public.appointments drop constraint appointments_modality_check;
alter table public.appointments add constraint appointments_modality_check
  check (modality in ('US', 'DX', 'CT', 'MR', 'MG', 'OT'));

-- ===================== RLS =====================
-- Parametría (config): lectura para miembros del tenant; escritura solo admin (igual que /configuracion).
-- Slots y componentes de reserva: se detallan aparte.
do $$
declare t text;
begin
  foreach t in array array[
    'organizations','locations','healthcare_services','practitioners','practitioner_roles',
    'devices','service_types','schedulable_resources','schedulable_resource_components',
    'resource_service_types','schedules'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('create policy "tenant reads %1$s" on public.%1$I for select to authenticated using (tenant_id = (select private.current_tenant()));', t);
    execute format('create policy "admins manage %1$s" on public.%1$I for all to authenticated using (tenant_id = (select private.current_tenant()) and (select private.current_role()) = ''admin'') with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) = ''admin'');', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function private.audit_change();', t);
  end loop;
end $$;

-- Slots: lectura para todo el equipo (para reservar); alta/regeneración vía función; el staff clínico
-- actualiza booked_count/status al reservar.
alter table public.slots enable row level security;
create policy "tenant reads slots" on public.slots for select to authenticated
  using (tenant_id = (select private.current_tenant()));
create policy "staff book slots" on public.slots for update to authenticated
  using (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'operator', 'radiologist'))
  with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'operator', 'radiologist'));
create policy "admins manage slots" on public.slots for all to authenticated
  using (tenant_id = (select private.current_tenant()) and (select private.current_role()) = 'admin')
  with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) = 'admin');
create trigger audit_slots after insert or update or delete on public.slots for each row execute function private.audit_change();

-- ===================== Generación de slots =====================
-- Regenera los cupos LIBRES futuros de un recurso a partir de sus plantillas horarias.
-- No toca cupos ya reservados. Solo admin (frontera de confianza; la función es security definer).
create or replace function private.generate_slots(p_resource uuid, p_from date, p_to date)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_kind public.schedulable_resource_kind;
  v_day date;
  v_created integer := 0;
  r record;
  v_start integer; v_end integer; v_m integer;
begin
  if (select private.current_role()) <> 'admin' then
    raise exception 'Solo un administrador puede generar cupos';
  end if;
  select tenant_id, kind into v_tenant, v_kind from public.schedulable_resources where id = p_resource;
  if v_tenant is null or v_tenant <> (select private.current_tenant()) then
    raise exception 'Recurso agendable inexistente en la institución';
  end if;
  if v_kind = 'composite' then
    raise exception 'Un recurso compuesto no genera cupos propios; su disponibilidad se calcula por intersección';
  end if;

  -- Limpia cupos libres futuros en el rango antes de regenerar (los reservados se conservan).
  delete from public.slots
   where resource_id = p_resource and status = 'free' and booked_count = 0
     and starts_at::date between p_from and p_to;

  v_day := p_from;
  while v_day <= p_to loop
    for r in
      select * from public.schedules
       where resource_id = p_resource
         and weekday = extract(isodow from v_day)
         and valid_from <= v_day and (valid_to is null or valid_to >= v_day)
    loop
      -- En minutos enteros: evita el envolvimiento a medianoche de time + interval (posible cuelgue).
      v_start := extract(hour from r.start_time) * 60 + extract(minute from r.start_time);
      v_end := extract(hour from r.end_time) * 60 + extract(minute from r.end_time);
      v_m := v_start;
      while v_m + r.slot_duration_min <= v_end loop
        insert into public.slots (tenant_id, resource_id, schedule_id, starts_at, ends_at, capacity, status)
        values (v_tenant, p_resource, r.id, v_day + make_interval(mins => v_m),
                v_day + make_interval(mins => v_m + r.slot_duration_min), r.slot_capacity, 'free')
        on conflict (resource_id, starts_at) do nothing;
        if found then v_created := v_created + 1; end if;
        v_m := v_m + r.slot_duration_min;
      end loop;
    end loop;
    v_day := v_day + 1;
  end loop;
  return v_created;
end $$;

grant execute on function private.generate_slots(uuid, date, date) to authenticated;
revoke all on function private.generate_slots(uuid, date, date) from public, anon;

create index organizations_tenant_idx on public.organizations (tenant_id);
create index locations_org_idx on public.locations (organization_id);
create index resources_tenant_kind_idx on public.schedulable_resources (tenant_id, kind);
