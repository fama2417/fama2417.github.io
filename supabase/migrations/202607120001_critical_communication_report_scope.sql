-- Vincula cada comunicación crítica al informe que la originó.
-- La columna permanece nullable para conservar comunicaciones legacy ambiguas.
alter table public.report_communications
  add column if not exists report_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'report_communications_report_id_fkey'
      and conrelid = 'public.report_communications'::regclass
  ) then
    alter table public.report_communications
      add constraint report_communications_report_id_fkey
      foreign key (report_id) references public.radiology_reports(id) on delete set null;
  end if;
end;
$$;

-- Solo hay un informe actual por cita. El created_at evita atribuir a un informe
-- recreado una comunicación registrada antes de que ese informe existiera.
update public.report_communications c
set report_id = r.id
from public.radiology_reports r
where c.report_id is null
  and r.appointment_id = c.appointment_id
  and r.tenant_id = c.tenant_id
  and c.created_at >= r.created_at
  and 1 = (
    select count(*)
    from public.radiology_reports candidate
    where candidate.appointment_id = c.appointment_id
      and candidate.tenant_id = c.tenant_id
      and c.created_at >= candidate.created_at
  );

create index if not exists report_communications_report_confirmed_idx
  on public.report_communications (report_id, communicated_at desc)
  where urgency = 'critical' and acknowledged;

create or replace function private.validate_report_communication() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.report_id is null then
    if tg_op = 'INSERT' then raise exception 'La comunicación requiere un informe'; end if;
    return new;
  end if;
  if not exists (
    select 1 from public.radiology_reports r
    where r.id = new.report_id
      and r.appointment_id = new.appointment_id
      and r.tenant_id = new.tenant_id
      and r.tenant_id = private.current_tenant()
  ) then
    raise exception 'El informe y el agendamiento de la comunicación no corresponden';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_report_communication on public.report_communications;
create trigger validate_report_communication
before insert or update of report_id, appointment_id, tenant_id on public.report_communications
for each row execute function private.validate_report_communication();

drop policy if exists "radiologists record report communications" on public.report_communications;
drop policy if exists "report staff record report communications" on public.report_communications;
create policy "report staff record report communications" on public.report_communications for insert to authenticated
with check (
  tenant_id = (select private.current_tenant())
  and (select private.current_role()) in ('admin', 'radiologist')
  and report_id is not null
  and exists (
    select 1 from public.radiology_reports r
    where r.id = report_communications.report_id
      and r.appointment_id = report_communications.appointment_id
      and r.tenant_id = report_communications.tenant_id
      and r.tenant_id = (select private.current_tenant())
  )
);

create or replace function private.validate_critical_report_communication() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_report_id uuid;
begin
  -- En un UPSERT, el BEFORE INSERT recibe un UUID nuevo antes de resolver el
  -- conflicto por appointment_id. Usa el informe existente cuando corresponda.
  select r.id into v_report_id
  from public.radiology_reports r
  where r.appointment_id = new.appointment_id
    and r.tenant_id = new.tenant_id;
  v_report_id := coalesce(v_report_id, new.id);

  if new.status = 'final' and new.critical_finding and not exists (
    select 1 from public.report_communications c
    where c.report_id = v_report_id
      and c.appointment_id = new.appointment_id
      and c.tenant_id = new.tenant_id
      and c.urgency = 'critical'
      and c.acknowledged
  ) then
    raise exception 'El hallazgo crítico requiere comunicación confirmada para este informe';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_critical_report_communication on public.radiology_reports;
create trigger validate_critical_report_communication
before insert or update on public.radiology_reports
for each row execute function private.validate_critical_report_communication();

revoke all on function private.validate_report_communication() from public, anon, authenticated;
revoke all on function private.validate_critical_report_communication() from public, anon, authenticated;

notify pgrst, 'reload schema';
