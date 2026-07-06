-- Seguridad clínica del informe: firma, comunicación cerrada, adendas y seguimiento.
alter table public.profiles
  add column professional_registration text not null default '';

alter table public.radiology_reports
  add column identity_confirmed boolean not null default false,
  add column clinical_question_answered boolean not null default false,
  add column signed_by uuid,
  add column signed_at timestamptz,
  add column signer_name text not null default '',
  add column signer_registration text not null default '',
  add constraint radiology_reports_signed_by_fkey foreign key (signed_by) references public.profiles(id);

-- Conserva como firmante histórico al creador de informes que ya eran definitivos.
update public.radiology_reports r
set signed_by = r.created_by,
    signed_at = r.updated_at,
    signer_name = p.full_name,
    signer_registration = p.professional_registration,
    identity_confirmed = true,
    clinical_question_answered = true
from public.profiles p
where r.status = 'final' and p.id = r.created_by;

create table public.report_communications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  appointment_id uuid not null references public.appointments(id),
  urgency text not null default 'critical' check (urgency in ('critical', 'urgent', 'unexpected')),
  recipient text not null check (length(trim(recipient)) > 0),
  channel text not null check (channel in ('phone', 'in_person', 'secure_message', 'email', 'other')),
  communicated_at timestamptz not null,
  acknowledged boolean not null default false,
  notes text not null default '',
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.report_addenda (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  appointment_id uuid not null references public.appointments(id),
  text text not null check (length(trim(text)) > 0),
  signed_by uuid not null default auth.uid(),
  signed_at timestamptz not null default now(),
  signer_name text not null default '',
  signer_registration text not null default '',
  constraint report_addenda_signed_by_fkey foreign key (signed_by) references public.profiles(id)
);

create table public.report_follow_ups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  appointment_id uuid not null references public.appointments(id),
  recommendation text not null check (length(trim(recommendation)) > 0),
  due_date date not null,
  responsible text not null check (length(trim(responsible)) > 0),
  status text not null default 'pending' check (status in ('pending', 'acknowledged', 'completed')),
  acknowledged_at timestamptz,
  completed_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);

create index report_communications_appointment_idx on public.report_communications (appointment_id, communicated_at);
create index report_addenda_appointment_idx on public.report_addenda (appointment_id, signed_at);
create index report_follow_ups_pending_idx on public.report_follow_ups (tenant_id, status, due_date);

alter table public.report_communications enable row level security;
alter table public.report_addenda enable row level security;
alter table public.report_follow_ups enable row level security;

create policy "clinical users read report communications" on public.report_communications for select to authenticated
using (tenant_id = (select private.current_tenant()));
create policy "radiologists record report communications" on public.report_communications for insert to authenticated
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) = 'radiologist'
  and exists (select 1 from public.appointments a where a.id = appointment_id and a.tenant_id = (select private.current_tenant())));

create policy "clinical users read report addenda" on public.report_addenda for select to authenticated
using (tenant_id = (select private.current_tenant()));
create policy "radiologists sign report addenda" on public.report_addenda for insert to authenticated
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) = 'radiologist'
  and exists (select 1 from public.appointments a where a.id = appointment_id and a.tenant_id = (select private.current_tenant())));

create policy "clinical users read report follow ups" on public.report_follow_ups for select to authenticated
using (tenant_id = (select private.current_tenant()));
create policy "radiologists create report follow ups" on public.report_follow_ups for insert to authenticated
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) = 'radiologist'
  and exists (select 1 from public.appointments a where a.id = appointment_id and a.tenant_id = (select private.current_tenant())));
create policy "clinical users update report follow ups" on public.report_follow_ups for update to authenticated
using (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'operator', 'radiologist'))
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'operator', 'radiologist'));

create function private.protect_final_report() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'final' then
    raise exception 'El informe definitivo es inmutable; agregue una adenda';
  end if;

  if new.status = 'final' then
    if (select private.current_role()) is distinct from 'radiologist' then
      raise exception 'Solo un radiólogo puede firmar el informe';
    end if;
    select p.full_name, p.professional_registration
      into new.signer_name, new.signer_registration
      from public.profiles p where p.id = (select auth.uid());
    if length(trim(new.signer_registration)) = 0 then
      raise exception 'Configure el registro profesional antes de firmar';
    end if;
    if length(trim(new.findings)) = 0 or length(trim(new.impression)) = 0 then
      raise exception 'Hallazgos e impresión son obligatorios';
    end if;
    if not new.identity_confirmed or not new.clinical_question_answered then
      raise exception 'Faltan las confirmaciones clínicas';
    end if;
    if new.critical_finding and (
      length(trim(new.critical_finding_type)) = 0 or not exists (
        select 1 from public.report_communications c
        where c.appointment_id = new.appointment_id
          and c.tenant_id = new.tenant_id
          and c.urgency = 'critical'
          and c.acknowledged
      )
    ) then
      raise exception 'El hallazgo crítico requiere comunicación confirmada';
    end if;
    new.signed_by := (select auth.uid());
    new.signed_at := now();
  end if;
  return new;
end;
$$;

create trigger protect_final_report before insert or update on public.radiology_reports
for each row execute function private.protect_final_report();

create function private.validate_report_addendum() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select private.current_role()) is distinct from 'radiologist'
     or not exists (
       select 1 from public.radiology_reports r
       where r.appointment_id = new.appointment_id
         and r.tenant_id = new.tenant_id
         and r.status = 'final'
     ) then
    raise exception 'La adenda requiere un informe definitivo y firma de radiólogo';
  end if;
  new.signed_by := (select auth.uid());
  new.signed_at := now();
  select p.full_name, p.professional_registration
    into new.signer_name, new.signer_registration
    from public.profiles p where p.id = (select auth.uid());
  if length(trim(new.signer_registration)) = 0 then
    raise exception 'Configure el registro profesional antes de firmar';
  end if;
  return new;
end;
$$;

create trigger validate_report_addendum before insert on public.report_addenda
for each row execute function private.validate_report_addendum();

create function private.timestamp_follow_up() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.appointment_id is distinct from old.appointment_id
     or new.recommendation is distinct from old.recommendation
     or new.due_date is distinct from old.due_date
     or new.responsible is distinct from old.responsible
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Solo puede actualizarse el estado del seguimiento';
  end if;
  if new.status = 'acknowledged' and old.status <> 'acknowledged' then new.acknowledged_at := now(); end if;
  if new.status = 'completed' and old.status <> 'completed' then new.completed_at := now(); end if;
  return new;
end;
$$;

create trigger timestamp_follow_up before update on public.report_follow_ups
for each row execute function private.timestamp_follow_up();

create trigger audit_report_communications after insert or update or delete on public.report_communications
for each row execute function private.audit_change();
create trigger audit_report_addenda after insert or update or delete on public.report_addenda
for each row execute function private.audit_change();
create trigger audit_report_follow_ups after insert or update or delete on public.report_follow_ups
for each row execute function private.audit_change();

revoke all on function private.protect_final_report() from public, anon, authenticated;
revoke all on function private.validate_report_addendum() from public, anon, authenticated;
revoke all on function private.timestamp_follow_up() from public, anon, authenticated;
