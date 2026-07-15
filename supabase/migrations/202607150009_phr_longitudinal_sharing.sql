-- Fases 4 y 5 del PHR: favoritos, perfil de emergencia, cuidadores y enlaces temporales.
alter table public.phr_profiles
  add column blood_type text not null default '' check (blood_type in ('', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  add column allergies text not null default '' check (length(allergies) <= 1000),
  add column conditions text not null default '' check (length(conditions) <= 1000),
  add column medications text not null default '' check (length(medications) <= 1000),
  add column emergency_contact_name text not null default '' check (length(emergency_contact_name) <= 120),
  add column emergency_contact_phone text not null default '' check (length(emergency_contact_phone) <= 40),
  add column emergency_notes text not null default '' check (length(emergency_notes) <= 1000);

create table public.phr_caregiver_grants (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  grantee_user_id uuid not null references auth.users(id) on delete cascade,
  relationship text not null check (relationship in ('family', 'caregiver')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (owner_user_id <> grantee_user_id)
);
create unique index phr_caregiver_grants_active_idx
  on public.phr_caregiver_grants (owner_user_id, grantee_user_id) where revoked_at is null;

alter table public.phr_caregiver_grants enable row level security;
grant select on public.phr_caregiver_grants to authenticated;
grant all on public.phr_caregiver_grants to service_role;
create policy "participants read caregiver grants" on public.phr_caregiver_grants for select to authenticated
using (owner_user_id = (select auth.uid()) or grantee_user_id = (select auth.uid()));

create or replace function private.can_read_phr_owner(p_owner_user_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_owner_user_id = (select auth.uid()) or exists (
    select 1 from public.phr_caregiver_grants g
    where g.owner_user_id = p_owner_user_id
      and g.grantee_user_id = (select auth.uid())
      and g.revoked_at is null
  )
$$;
revoke all on function private.can_read_phr_owner(uuid) from public, anon;
grant execute on function private.can_read_phr_owner(uuid) to authenticated;

drop policy if exists "owners read own PHR profile" on public.phr_profiles;
create policy "owners and caregivers read PHR profile" on public.phr_profiles for select to authenticated
using ((select private.can_read_phr_owner(user_id)));

drop policy if exists "owners read personal documents" on public.patient_documents;
create policy "owners and caregivers read personal documents" on public.patient_documents for select to authenticated
using ((select private.can_read_phr_owner(owner_user_id)));

drop policy if exists "owners read own PHR lab imports" on public.phr_lab_imports;
create policy "owners and caregivers read PHR lab imports" on public.phr_lab_imports for select to authenticated
using ((select private.can_read_phr_owner(owner_user_id)));

drop policy if exists "owners read own PHR lab results" on public.phr_lab_results;
create policy "owners and caregivers read PHR lab results" on public.phr_lab_results for select to authenticated
using ((select private.can_read_phr_owner(owner_user_id)));

drop policy if exists "owners read personal document files" on storage.objects;
create policy "owners and caregivers read personal document files" on storage.objects for select to authenticated
using (
  bucket_id = 'patient-documents'
  and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and private.can_read_phr_owner(((storage.foldername(name))[1])::uuid)
);

create table public.phr_biomarker_favorites (
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  trend_key text not null check (length(trim(trend_key)) between 1 and 180),
  label text not null check (length(trim(label)) between 1 and 160),
  created_at timestamptz not null default now(),
  primary key (owner_user_id, trend_key)
);
alter table public.phr_biomarker_favorites enable row level security;
grant select on public.phr_biomarker_favorites to authenticated;
grant all on public.phr_biomarker_favorites to service_role;
create policy "owners and caregivers read favorites" on public.phr_biomarker_favorites for select to authenticated
using ((select private.can_read_phr_owner(owner_user_id)));

alter table public.phr_lab_results
  add constraint phr_lab_results_id_owner_key unique (id, owner_user_id);

create table public.phr_share_links (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  title text not null default 'Resumen de salud' check (length(trim(title)) between 1 and 120),
  include_emergency boolean not null default false,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_accessed_at timestamptz,
  access_count integer not null default 0 check (access_count >= 0),
  unique (id, owner_user_id),
  check (expires_at > created_at)
);

create table public.phr_share_documents (
  share_id uuid not null,
  owner_user_id uuid not null,
  document_id uuid not null,
  primary key (share_id, document_id),
  foreign key (share_id, owner_user_id) references public.phr_share_links(id, owner_user_id) on delete cascade,
  foreign key (document_id, owner_user_id) references public.patient_documents(id, owner_user_id) on delete cascade
);

create table public.phr_share_results (
  share_id uuid not null,
  owner_user_id uuid not null,
  result_id uuid not null,
  primary key (share_id, result_id),
  foreign key (share_id, owner_user_id) references public.phr_share_links(id, owner_user_id) on delete cascade,
  foreign key (result_id, owner_user_id) references public.phr_lab_results(id, owner_user_id) on delete cascade
);

create table public.phr_share_access_log (
  id bigint generated always as identity primary key,
  share_id uuid not null references public.phr_share_links(id) on delete cascade,
  accessed_at timestamptz not null default now(),
  ip_hash text not null default '' check (length(ip_hash) <= 64),
  user_agent text not null default '' check (length(user_agent) <= 500)
);

alter table public.phr_share_links enable row level security;
alter table public.phr_share_documents enable row level security;
alter table public.phr_share_results enable row level security;
alter table public.phr_share_access_log enable row level security;
grant select on public.phr_share_links, public.phr_share_documents, public.phr_share_results, public.phr_share_access_log to authenticated;
grant all on public.phr_share_links, public.phr_share_documents, public.phr_share_results, public.phr_share_access_log to service_role;

create policy "owners read share links" on public.phr_share_links for select to authenticated
using (owner_user_id = (select auth.uid()));
create policy "owners read shared document selections" on public.phr_share_documents for select to authenticated
using (owner_user_id = (select auth.uid()));
create policy "owners read shared result selections" on public.phr_share_results for select to authenticated
using (owner_user_id = (select auth.uid()));
create policy "owners read share access log" on public.phr_share_access_log for select to authenticated
using (exists (
  select 1 from public.phr_share_links s
  where s.id = share_id and s.owner_user_id = (select auth.uid())
));

create function public.log_phr_share_access(p_share_id uuid, p_ip_hash text, p_user_agent text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.phr_share_access_log (share_id, ip_hash, user_agent)
  values (p_share_id, left(p_ip_hash, 64), left(p_user_agent, 500));
  update public.phr_share_links
  set access_count = access_count + 1, last_accessed_at = now()
  where id = p_share_id;
end
$$;
revoke all on function public.log_phr_share_access(uuid, text, text) from public, anon, authenticated;
grant execute on function public.log_phr_share_access(uuid, text, text) to service_role;

notify pgrst, 'reload schema';
